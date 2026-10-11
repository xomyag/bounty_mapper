import type { RegionRepository } from '../application/regionRepository'
import { RevisionConflictError } from '../application/projectRepository'
import type { Asset, Map, Project } from '../domain/project'
import { documentAssetIds } from '../domain/richText'
import { MAX_REGIONS, validateRegion } from '../domain/region'
import type { Region } from '../domain/region'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'
import { MAX_ENTITIES, MAX_MARKERS, validateEntity, validateMarker } from '../domain/marker'
import type { Entity, MapObjects, MarkerPlacement } from '../domain/marker'
import { recentTags } from '../domain/tags'

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
  loadAssets(mapId: string): Promise<Asset[]> {
    return this.db.transaction(['maps', 'assets'], 'readonly', async (tx) => {
      const map = await requestResult(tx.objectStore('maps').get(mapId)) as Map | undefined
      return map ? requestResult(tx.objectStore('assets').index('projectId').getAll(map.projectId)) as Promise<Asset[]> : []
    })
  }
  loadObjects(mapId: string): Promise<MapObjects> {
    return this.db.transaction(['maps', 'entities', 'markerPlacements'], 'readonly', async (tx) => {
      const map = await requestResult(tx.objectStore('maps').get(mapId)) as Map | undefined
      if (!map) throw new Error('Карта не найдена.')
      const entities = await requestResult(tx.objectStore('entities').index('projectId').getAll(map.projectId)) as Entity[]
      const markers = await requestResult(tx.objectStore('markerPlacements').index('mapId').getAll(mapId)) as MarkerPlacement[]
      entities.forEach(validateEntity); markers.forEach(validateMarker)
      if (markers.some((m) => !entities.some((e) => e.id === m.entityId))) throw new Error('Сущность маркера не найдена.')
      return { entities, markers: markers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) }
    })
  }
  saveStatus(project: Project, entityId: string, expectedStatus: string, status: string): Promise<{ project: Project; entity: Entity }> {
    return this.db.transaction(['projects', 'entities'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const previous = await requestResult(tx.objectStore('entities').get(entityId)) as Entity | undefined
      if (!previous || previous.projectId !== project.id) throw new Error('Сущность не найдена в текущем проекте.')
      if (previous.status !== expectedStatus) throw new Error('Статус уже изменился. Откройте сохранённую версию проекта.')
      const entity = { ...previous, status }
      validateEntity(entity)
      const next = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(tx.objectStore('entities').put(entity))
      await requestResult(tx.objectStore('projects').put(next))
      return { project: next, entity }
    })
  }
  save(project: Project, mapId: string, regions: Region[], newAssets: Asset[] = [], objects?: MapObjects, usedTags?: string[]): Promise<Project> {
    return this.db.transaction(['projects', 'maps', 'regions', 'assets', 'entities', 'markerPlacements', 'settings'], 'readwrite', async (tx) => {
      const stored = readProject(await requestResult(tx.objectStore('projects').get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const map = await requestResult(tx.objectStore('maps').get(mapId)) as Map | undefined
      if (!map || map.projectId !== project.id) throw new Error('Карта не принадлежит открытому проекту.')
      if (regions.length > MAX_REGIONS || new Set(regions.map((r) => r.id)).size !== regions.length) throw new Error('Некорректный список областей.')
      for (const asset of newAssets) {
        if (asset.projectId !== project.id || !asset.blob || asset.blob.size !== asset.byteSize || asset.byteSize < 1 || asset.byteSize > 64 * 1024 * 1024 ||
            !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) || !/^[a-f0-9]{64}$/.test(asset.checksum) ||
            !Number.isSafeInteger(asset.pixelWidth) || !Number.isSafeInteger(asset.pixelHeight) || asset.pixelWidth < 1 || asset.pixelHeight < 1 || asset.pixelWidth * asset.pixelHeight > 64 * 1024 * 1024) throw new Error('Некорректное изображение карточки.')
        await requestResult(tx.objectStore('assets').add(asset))
      }
      for (const region of regions) {
        validateRegion(region)
        if (region.mapId !== mapId) throw new Error('Область принадлежит другой карте.')
        const existing = await requestResult(tx.objectStore('regions').get(region.id)) as Region | undefined
        if (existing && existing.mapId !== mapId) throw new Error('ID области занят другой картой.')
        for (const id of [...documentAssetIds(region.gmNotes), ...documentAssetIds(region.playerDescription)]) {
          const asset = await requestResult(tx.objectStore('assets').get(id)) as Asset | undefined
          if (!asset || asset.projectId !== project.id) throw new Error('Изображение текста отсутствует или принадлежит другому проекту.')
        }
      }
      const store = tx.objectStore('regions')
      const previous = await requestResult(store.index('mapId').getAllKeys(mapId))
      for (const id of previous) await requestResult(store.delete(id))
      for (const region of regions) await requestResult(store.add(region))
      const entityStore = tx.objectStore('entities')
      const markerStore = tx.objectStore('markerPlacements')
      const entities = objects?.entities ?? await requestResult(entityStore.index('projectId').getAll(project.id)) as Entity[]
      const previousMarkers = await requestResult(markerStore.index('mapId').getAll(mapId)) as MarkerPlacement[]
      const markers: MarkerPlacement[] = objects?.markers ?? previousMarkers.map((m) => ({ ...m, regionIds: m.regionIds.filter((id) => regions.some((r) => r.id === id)) }))
      if (entities.length > MAX_ENTITIES || markers.length > MAX_MARKERS || new Set(entities.map((e) => e.id)).size !== entities.length || new Set(markers.map((m) => m.id)).size !== markers.length) throw new Error('Превышен лимит или повторяются ID объектов карты.')
      for (const entity of entities) {
        validateEntity(entity)
        const old = await requestResult(entityStore.get(entity.id)) as Entity | undefined
        if (entity.projectId !== project.id || (old && old.projectId !== project.id)) throw new Error('Сущность принадлежит другому проекту.')
        for (const id of documentAssetIds(entity.description)) {
          const asset = await requestResult(tx.objectStore('assets').get(id)) as Asset | undefined
          if (!asset || asset.projectId !== project.id) throw new Error('Изображение описания отсутствует или принадлежит другому проекту.')
        }
        await requestResult(entityStore.put(entity))
      }
      for (const marker of markers) {
        validateMarker(marker)
        const old = await requestResult(markerStore.get(marker.id)) as MarkerPlacement | undefined
        if (marker.mapId !== mapId || (old && old.mapId !== mapId) || !entities.some((e) => e.id === marker.entityId) || marker.regionIds.some((id) => !regions.some((r) => r.id === id))) throw new Error('Некорректная ссылка маркера на карту, сущность или область.')
      }
      for (const marker of previousMarkers) await requestResult(markerStore.delete(marker.id))
      for (const marker of markers) await requestResult(markerStore.add(marker))
      if (usedTags) {
        const key = `tagHistory:${project.id}`
        const history = await requestResult(tx.objectStore('settings').get(key)) as string[] | undefined
        await requestResult(tx.objectStore('settings').put(recentTags(history ?? [], usedTags).slice(0, 512), key))
      }
      const next = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(tx.objectStore('projects').put(next))
      return next
    })
  }
}
