import type { ProjectBackupRepository, ProjectSnapshot } from '../application/projectBackupRepository'
import type { Asset, ImagePlacement, Map, Project } from '../domain/project'
import type { Region } from '../domain/region'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'
import type { Entity, MarkerPlacement } from '../domain/marker'
import { availableCopyNames } from '../domain/copy'
import { documentFromSnapshot } from './backup/document'
import { RevisionConflictError } from '../application/projectRepository'
import { message } from '../i18n/message'
import { appendProject } from './workspaceSettings'

const stores = ['projects', 'maps', 'assets', 'imagePlacements', 'regions', 'entities', 'markerPlacements']

export class IndexedDbProjectBackupRepository implements ProjectBackupRepository {
  private readonly db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) {
    this.db = new IndexedDb(factory, name)
  }
  snapshot(projectId: string): Promise<ProjectSnapshot> {
    return this.db.transaction(stores, 'readonly', (tx) => this.read(tx, projectId))
  }
  private async read(tx: IDBTransaction, projectId: string): Promise<ProjectSnapshot> {
    const [project, maps, assets] = await Promise.all([
      requestResult(tx.objectStore('projects').get(projectId)).then(readProject),
      requestResult(tx.objectStore('maps').index('projectId').getAll(projectId)) as Promise<Map[]>,
      requestResult(tx.objectStore('assets').index('projectId').getAll(projectId)) as Promise<Asset[]>,
    ])
    const placements = await Promise.all(maps.map((map) => requestResult(tx.objectStore('imagePlacements').index('mapId').getAll(map.id)) as Promise<ImagePlacement[]>))
    const regions = await Promise.all(maps.map((map) => requestResult(tx.objectStore('regions').index('mapId').getAll(map.id)) as Promise<Region[]>))
    const entities = await requestResult(tx.objectStore('entities').index('projectId').getAll(projectId)) as Entity[]
    const markerPlacements = await Promise.all(maps.map((map) => requestResult(tx.objectStore('markerPlacements').index('mapId').getAll(map.id)) as Promise<MarkerPlacement[]>))
    return { project, maps, assets, imagePlacements: placements.flat(), regions: regions.flat(), entities, markerPlacements: markerPlacements.flat() }
  }
  insertLevels(project: Project, copy: ProjectSnapshot): Promise<{ project: Project; snapshot: ProjectSnapshot }> {
    return this.db.transaction(stores, 'readwrite', async (tx) => {
      const previous = await this.read(tx, project.id)
      if (previous.project.revision !== project.revision) throw new RevisionConflictError()
      if (!copy.maps.length || copy.maps.some((map) => map.projectId !== project.id)) throw new Error(message('level.notFound'))
      const names = availableCopyNames(copy.maps.map((map) => map.name), previous.maps.map((map) => map.name))
      const order = Math.max(-1, ...previous.maps.map((map) => map.order)) + 1
      const maps = copy.maps.map((map, index) => ({ ...map, name: names[index], order: order + index }))
      const next = { ...previous.project, revision: previous.project.revision + 1, updatedAt: new Date().toISOString() }
      const snapshot = { ...copy, project: next, maps }
      documentFromSnapshot({ project: next, maps: [...previous.maps, ...maps], regions: [...previous.regions, ...copy.regions], entities: [...previous.entities, ...copy.entities], assets: [...previous.assets, ...copy.assets], imagePlacements: [...previous.imagePlacements, ...copy.imagePlacements], markerPlacements: [...previous.markerPlacements, ...copy.markerPlacements] })
      for (const [name, rows] of [['maps', snapshot.maps], ['regions', snapshot.regions], ['assets', snapshot.assets], ['imagePlacements', snapshot.imagePlacements], ['entities', snapshot.entities], ['markerPlacements', snapshot.markerPlacements]] as const) {
        for (const row of rows) await requestResult(tx.objectStore(name).add(row))
      }
      await requestResult(tx.objectStore('projects').put(next))
      return { project: next, snapshot }
    })
  }
  // Only a fully validated snapshot with fresh IDs reaches this boundary.
  insertCopy(snapshot: ProjectSnapshot): Promise<Project> {
    return this.db.transaction([...stores, 'settings'], 'readwrite', async (tx) => {
      await appendProject(tx, snapshot.project.id)
      await requestResult(tx.objectStore('projects').add(snapshot.project))
      for (const map of snapshot.maps) await requestResult(tx.objectStore('maps').add(map))
      for (const asset of snapshot.assets) await requestResult(tx.objectStore('assets').add(asset))
      for (const placement of snapshot.imagePlacements) await requestResult(tx.objectStore('imagePlacements').add(placement))
      for (const region of snapshot.regions) await requestResult(tx.objectStore('regions').add(region))
      for (const entity of snapshot.entities) await requestResult(tx.objectStore('entities').add(entity))
      for (const marker of snapshot.markerPlacements) await requestResult(tx.objectStore('markerPlacements').add(marker))
      await requestResult(tx.objectStore('settings').put(snapshot.project.id, 'activeProjectId'))
      return snapshot.project
    })
  }
}
