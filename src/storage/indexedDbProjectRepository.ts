import { message } from '../i18n/message'
import type { ProjectRepository } from '../application/projectRepository'
import { RevisionConflictError } from '../application/projectRepository'
import { validateProject } from '../domain/project'
import type { Asset, Map, Project } from '../domain/project'

import { writeDocumentAssets } from './documentAssets'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'

export function readProject(value: unknown): Project {
  validateProject(value as Project)
  return value as Project
}

export class IndexedDbProjectRepository implements ProjectRepository {
  private readonly db: IndexedDb

  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) {
    this.db = new IndexedDb(factory, name)
  }

  list(): Promise<Project[]> {
    return this.db.transaction(['projects'], 'readonly', async (tx) => {
      const values: unknown[] = await requestResult(tx.objectStore('projects').getAll())
      return values.map(readProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    })
  }

  restore(): Promise<Project | undefined> {
    return this.db.transaction(['settings', 'projects'], 'readonly', async (tx) => {
      const id: unknown = await requestResult(tx.objectStore('settings').get('activeProjectId'))
      if (typeof id !== 'string') return undefined
      const value: unknown = await requestResult(tx.objectStore('projects').get(id))
      return value === undefined ? undefined : readProject(value)
    })
  }

  open(id: string): Promise<Project> {
    return this.db.transaction(['settings', 'projects'], 'readwrite', async (tx) => {
      const value: unknown = await requestResult(tx.objectStore('projects').get(id))
      if (value === undefined) throw new Error(message("ui.project.not.found"))
      const project = readProject(value)
      await requestResult(tx.objectStore('settings').put(id, 'activeProjectId'))
      return project
    })
  }

  save(project: Project, assets: Asset[] = []): Promise<Project> {
    return this.db.transaction(['projects', 'settings', 'assets'], 'readwrite', async (tx) => {
      if (!project.name.trim()) throw new Error(message("ui.enter.a.project.name"))
      const store = tx.objectStore('projects')
      const value: unknown = await requestResult(store.get(project.id))
      const existing = value === undefined ? undefined : readProject(value)
      if ((existing?.revision ?? 0) !== project.revision) throw new RevisionConflictError()
      const saved = { ...project, name: project.name.trim(), revision: project.revision + 1, updatedAt: new Date().toISOString() }
      validateProject(saved)
      await writeDocumentAssets(tx, project.id, assets, [saved.context])
      await requestResult(store.put(saved))
      await requestResult(tx.objectStore('settings').put(saved.id, 'activeProjectId'))
      return saved
    })
  }
  remove(project: Project): Promise<void> {
    return this.db.transaction(['projects', 'maps', 'regions', 'markerPlacements', 'imagePlacements', 'entities', 'assets', 'settings'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const maps = await requestResult(tx.objectStore('maps').index('projectId').getAll(project.id)) as Map[]
      for (const map of maps) {
        for (const store of ['regions', 'markerPlacements', 'imagePlacements']) {
          const keys = await requestResult(tx.objectStore(store).index('mapId').getAllKeys(map.id))
          for (const key of keys) await requestResult(tx.objectStore(store).delete(key))
        }
        await requestResult(tx.objectStore('maps').delete(map.id))
      }
      for (const store of ['entities', 'assets']) {
        const keys = await requestResult(tx.objectStore(store).index('projectId').getAllKeys(project.id))
        for (const key of keys) await requestResult(tx.objectStore(store).delete(key))
      }
      const settings = tx.objectStore('settings')
      for (const key of [`workspaceMode:${project.id}`, `tagHistory:${project.id}`]) await requestResult(settings.delete(key))
      if (await requestResult(settings.get('activeProjectId')) === project.id) await requestResult(settings.delete('activeProjectId'))
      await requestResult(tx.objectStore('projects').delete(project.id))
    })
  }
}
