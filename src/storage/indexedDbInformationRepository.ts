import { message } from '../i18n/message'
import type { InformationRepository } from '../application/informationRepository'
import type { Asset, Map, Project } from '../domain/project'
import type { RichDocument } from '../domain/richText'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'
import { IndexedDbProjectRepository, readProject } from './indexedDbProjectRepository'
import { RevisionConflictError } from '../application/projectRepository'
import { writeDocumentAssets } from './documentAssets'
import { validateRichDocument } from '../domain/richText'

export class IndexedDbInformationRepository implements InformationRepository {
  private db: IndexedDb
  private projects: IndexedDbProjectRepository
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) { this.db = new IndexedDb(factory, name); this.projects = new IndexedDbProjectRepository(factory, name) }
  load(projectId: string, mapId?: string) { return this.db.transaction(['projects', 'maps', 'assets'], 'readonly', async (tx) => {
    readProject(await requestResult(tx.objectStore('projects').get(projectId)))
    const map = mapId ? await requestResult(tx.objectStore('maps').get(mapId)) as Map | undefined : undefined
    if (mapId && (!map || map.projectId !== projectId)) throw new Error(message("ui.map.not.found.in.the.current.project"))
    if (map) validateRichDocument(map.description)
    const assets = await requestResult(tx.objectStore('assets').index('projectId').getAll(projectId)) as Asset[]
    return { map, assets }
  }) }
  create(project: Project, assets: Asset[]) { return this.projects.save(project, assets) }
  save(project: Project, fields: { name: string; document: RichDocument; mapId?: string }, assets: Asset[]) {
    if (!fields.mapId) return this.projects.save({ ...project, name: fields.name, context: fields.document }, assets)
    return this.db.transaction(['projects', 'maps', 'assets'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const map = await requestResult(tx.objectStore('maps').get(fields.mapId!)) as Map | undefined
      if (!map || map.projectId !== project.id) throw new Error(message("ui.map.not.found.in.the.current.project"))
      await writeDocumentAssets(tx, project.id, assets, [fields.document])
      await requestResult(tx.objectStore('maps').put({ ...map, description: fields.document }))
      const next = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(tx.objectStore('projects').put(next)); return next
    })
  }
}
