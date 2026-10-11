import type { ProjectBackupRepository, ProjectSnapshot } from '../application/projectBackupRepository'
import type { Asset, ImagePlacement, Map, Project } from '../domain/project'
import type { Region } from '../domain/region'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'
import type { Entity, MarkerPlacement } from '../domain/marker'

const stores = ['projects', 'maps', 'assets', 'imagePlacements', 'regions', 'entities', 'markerPlacements']

export class IndexedDbProjectBackupRepository implements ProjectBackupRepository {
  private readonly db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) {
    this.db = new IndexedDb(factory, name)
  }
  snapshot(projectId: string): Promise<ProjectSnapshot> {
    return this.db.transaction(stores, 'readonly', async (tx) => {
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
    })
  }
  // Only a fully validated snapshot with fresh IDs reaches this boundary.
  insertCopy(snapshot: ProjectSnapshot): Promise<Project> {
    return this.db.transaction([...stores, 'settings'], 'readwrite', async (tx) => {
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
