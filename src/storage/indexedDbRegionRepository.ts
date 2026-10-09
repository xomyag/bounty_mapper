import type { RegionRepository } from '../application/regionRepository'
import { RevisionConflictError } from '../application/projectRepository'
import type { Map, Project } from '../domain/project'
import { MAX_REGIONS, validateRegion } from '../domain/region'
import type { Region } from '../domain/region'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'

export class IndexedDbRegionRepository implements RegionRepository {
  private readonly db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) { this.db = new IndexedDb(factory, name) }
  load(mapId: string): Promise<Region[]> {
    return this.db.transaction(['regions'], 'readonly', async (tx) => {
      const regions = await requestResult(tx.objectStore('regions').index('mapId').getAll(mapId)) as Region[]
      regions.forEach(validateRegion)
      return regions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    })
  }
  save(project: Project, mapId: string, regions: Region[]): Promise<Project> {
    return this.db.transaction(['projects', 'maps', 'regions'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const map = await requestResult(tx.objectStore('maps').get(mapId)) as Map | undefined
      if (!map || map.projectId !== project.id) throw new Error('Карта не принадлежит открытому проекту.')
      if (regions.length > MAX_REGIONS || new Set(regions.map((r) => r.id)).size !== regions.length) throw new Error('Некорректный список областей.')
      for (const region of regions) {
        validateRegion(region)
        if (region.mapId !== mapId) throw new Error('Область принадлежит другой карте.')
        const existing = await requestResult(tx.objectStore('regions').get(region.id)) as Region | undefined
        if (existing && existing.mapId !== mapId) throw new Error('ID области занят другой картой.')
      }
      const store = tx.objectStore('regions')
      const previous = await requestResult(store.index('mapId').getAllKeys(mapId))
      for (const id of previous) await requestResult(store.delete(id))
      for (const region of regions) await requestResult(store.add(region))
      const next = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(tx.objectStore('projects').put(next))
      return next
    })
  }
}
