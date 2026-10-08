import type { ProjectRepository } from '../application/projectRepository'
import { RevisionConflictError } from '../application/projectRepository'
import { PROJECT_SCHEMA_VERSION } from '../domain/project'
import type { Project } from '../domain/project'

import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'

export function readProject(value: unknown): Project {
  if (typeof value !== 'object' || value === null) throw new Error('Повреждённая запись проекта.')
  const p = value as Partial<Project>
  if (p.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается.')
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() ||
      typeof p.contextMd !== 'string' || !Number.isInteger(p.revision) || (p.revision ?? 0) < 1 ||
      typeof p.createdAt !== 'string' || typeof p.updatedAt !== 'string') {
    throw new Error('Повреждённая запись проекта.')
  }
  return p as Project
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
      if (value === undefined) throw new Error('Проект не найден.')
      const project = readProject(value)
      await requestResult(tx.objectStore('settings').put(id, 'activeProjectId'))
      return project
    })
  }

  save(project: Project): Promise<Project> {
    return this.db.transaction(['projects', 'settings'], 'readwrite', async (tx) => {
      if (!project.name.trim()) throw new Error('Укажите название проекта.')
      if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается.')
      const store = tx.objectStore('projects')
      const value: unknown = await requestResult(store.get(project.id))
      const existing = value === undefined ? undefined : readProject(value)
      if ((existing?.revision ?? 0) !== project.revision) throw new RevisionConflictError()
      const saved = { ...project, name: project.name.trim(), revision: project.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(store.put(saved))
      await requestResult(tx.objectStore('settings').put(saved.id, 'activeProjectId'))
      return saved
    })
  }
}
