import type { NavigationRepository } from '../application/navigationRepository'
import type { NavigationData } from '../domain/navigation'
import type { Map, Project, ImagePlacement, Asset } from '../domain/project'
import { MAX_PROJECT_MAPS } from '../domain/project'
import type { Region } from '../domain/region'
import { validateRegion } from '../domain/region'
import type { Entity, MarkerPlacement } from '../domain/marker'
import { validateEntity, validateMarker } from '../domain/marker'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'
import { RevisionConflictError } from '../application/projectRepository'
import { documentAssetIds } from '../domain/richText'

export class IndexedDbNavigationRepository implements NavigationRepository {
  private readonly db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) { this.db = new IndexedDb(factory, name) }
  load(projectId: string): Promise<NavigationData> {
    return this.db.transaction(['maps', 'regions', 'entities', 'markerPlacements', 'settings'], 'readonly', async (tx) => {
      const maps = await requestResult(tx.objectStore('maps').index('projectId').getAll(projectId)) as Map[]
      const [regions, entities, markers] = await Promise.all([
        Promise.all(maps.map((m) => requestResult(tx.objectStore('regions').index('mapId').getAll(m.id)) as Promise<Region[]>)),
        requestResult(tx.objectStore('entities').index('projectId').getAll(projectId)) as Promise<Entity[]>,
        Promise.all(maps.map((m) => requestResult(tx.objectStore('markerPlacements').index('mapId').getAll(m.id)) as Promise<MarkerPlacement[]>)),
      ])
      for (const region of regions.flat()) validateRegion(region)
      for (const entity of entities) validateEntity(entity)
      for (const marker of markers.flat()) {
        validateMarker(marker)
        if (!entities.some((e) => e.id === marker.entityId) || marker.regionIds.some((id) => !regions.flat().some((r) => r.id === id && r.mapId === marker.mapId))) throw new Error('Некорректные ссылки маркера в навигации.')
      }
      const tagHistory = await requestResult(tx.objectStore('settings').get(`tagHistory:${projectId}`)) as string[] | undefined
      return { maps: maps.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), regions: regions.flat(), entities, markers: markers.flat(), tagHistory: tagHistory ?? [] }
    })
  }
  private mutate(project: Project, name: string, mapId?: string) {
    if (!name.trim() || name.length > 512) return Promise.reject(new Error('Укажите название карты длиной от 1 до 512 символов.'))
    return this.db.transaction(['projects', 'maps'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const maps = await requestResult(tx.objectStore('maps').index('projectId').getAll(project.id)) as Map[]
      const previous = mapId ? maps.find((m) => m.id === mapId) : undefined
      if (mapId && !previous) throw new Error('Карта не найдена в текущем проекте.')
      if (!mapId && maps.length >= MAX_PROJECT_MAPS) throw new Error(`Допустимо не более ${MAX_PROJECT_MAPS} карт проекта.`)
      const map: Map = previous ? { ...previous, name: name.trim() } : { id: crypto.randomUUID(), projectId: project.id, name: name.trim(), notesMd: '', order: Math.max(-1, ...maps.map((m) => m.order)) + 1, coordinateBounds: { x: 0, y: 0, width: 1000, height: 1000 } }
      const next = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(tx.objectStore('maps').put(map)); await requestResult(tx.objectStore('projects').put(next))
      return { project: next, map }
    })
  }
  createMap(project: Project, name: string) { return this.mutate(project, name) }
  async renameMap(project: Project, mapId: string, name: string) { return (await this.mutate(project, name, mapId)).project }
  deleteMap(project: Project, mapId: string): Promise<Project> {
    return this.db.transaction(['projects', 'maps', 'regions', 'entities', 'markerPlacements', 'imagePlacements', 'assets'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const maps = await requestResult(tx.objectStore('maps').index('projectId').getAll(project.id)) as Map[]
      if (!maps.some((map) => map.id === mapId)) throw new Error('Карта не найдена в текущем проекте.')
      const regions = (await Promise.all(maps.map((map) => requestResult(tx.objectStore('regions').index('mapId').getAll(map.id)) as Promise<Region[]>))).flat()
      const placements = (await Promise.all(maps.map((map) => requestResult(tx.objectStore('imagePlacements').index('mapId').getAll(map.id)) as Promise<ImagePlacement[]>))).flat()
      const markers = await requestResult(tx.objectStore('markerPlacements').index('mapId').getAll(mapId)) as MarkerPlacement[]
      const entities = await requestResult(tx.objectStore('entities').index('projectId').getAll(project.id)) as Entity[]
      const regionAssets = (region: Region) => [...documentAssetIds(region.gmNotes), ...documentAssetIds(region.playerDescription)]
      const candidates = new Set([...placements.filter((p) => p.mapId === mapId).map((p) => p.assetId), ...regions.filter((r) => r.mapId === mapId).flatMap(regionAssets)])
      const retained = new Set([...placements.filter((p) => p.mapId !== mapId).map((p) => p.assetId), ...regions.filter((r) => r.mapId !== mapId).flatMap(regionAssets), ...entities.flatMap((e) => documentAssetIds(e.description))])
      for (const region of regions.filter((r) => r.mapId === mapId)) await requestResult(tx.objectStore('regions').delete(region.id))
      for (const marker of markers) await requestResult(tx.objectStore('markerPlacements').delete(marker.id))
      for (const placement of placements.filter((p) => p.mapId === mapId)) await requestResult(tx.objectStore('imagePlacements').delete(placement.id))
      for (const id of candidates) if (!retained.has(id)) {
        const asset = await requestResult(tx.objectStore('assets').get(id)) as Asset | undefined
        if (asset?.projectId === project.id) await requestResult(tx.objectStore('assets').delete(id))
      }
      // Entities survive placement/map deletion, including their rich-text assets.
      await requestResult(tx.objectStore('maps').delete(mapId))
      const next = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(tx.objectStore('projects').put(next))
      return next
    })
  }
}
