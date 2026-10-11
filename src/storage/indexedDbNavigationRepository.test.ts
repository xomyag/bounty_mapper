import { localizedFailure } from '../localizedTestFailure'
import { legacyContextDocument } from './migrateProjectContext'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { IndexedDbNavigationRepository } from './indexedDbNavigationRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { IndexedDbMapImageRepository } from './indexedDbMapImageRepository'
import { createProject } from '../domain/project'
import { testAsset } from './testAsset'
import { IndexedDb, requestResult } from './indexedDb'
import { MAX_PROJECT_MAPS } from '../domain/project'
import { BACKUP_LIMITS } from './backup/zip'
import { IndexedDbRegionRepository } from './indexedDbRegionRepository'
import { IndexedDbProjectBackupRepository } from './indexedDbProjectBackupRepository'
import { emptyRegionContent } from '../domain/region'
import type { Region } from '../domain/region'
import { emptyDocument } from '../domain/richText'
import type { Entity, MarkerPlacement } from '../domain/marker'
import { independentCopy } from '../application/projectBackupRepository'
import { tagCatalog } from '../domain/tags'

const makeRegion = (mapId: string, id: string): Region => ({ ...emptyRegionContent(), id, mapId, number: 1, title: id, titleCustomized: true, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], order: 0, color: '#d7ad62', fillOpacity: .4 })

async function setup() {
  const factory = new IDBFactory(); const projects = new IndexedDbProjectRepository(() => factory)
  const project = await projects.save(createProject('Карты')); const navigation = new IndexedDbNavigationRepository(() => factory)
  return { factory, projects, project, navigation, images: new IndexedDbMapImageRepository(() => factory) }
}
describe('Project maps and navigation storage', () => {
  it('atomically removes only the selected map contents and unused images, retaining shared entities/assets', async () => {
    const { factory, project, navigation, images } = await setup()
    const first = await navigation.createMap(project, 'Башня'); const second = await navigation.createMap(first.project, 'Подвал')
    const backgroundA = await images.replace(second.project, testAsset(project.id), first.map.id)
    const backgroundB = await images.replace(backgroundA.project, testAsset(project.id, 800), second.map.id)
    const repo = new IndexedDbRegionRepository(() => factory)
    const entity: Entity = { checks: [], id: 'shared-entity', projectId: project.id, kind: 'enemy', name: 'Страж', description: { type: 'doc', content: [{ type: 'image', attrs: { assetId: backgroundA.image.background!.asset.id, alt: '' } }] }, status: 'alive', tags: [] }
    const marker = (id: string, mapId: string, regionId: string): MarkerPlacement => ({ id, mapId, entityId: entity.id, x: 10, y: 20, regionIds: [regionId], color: '#d7ad62', locked: false, order: 0 })
    const r1 = makeRegion(first.map.id, 'r1'); const r2 = makeRegion(second.map.id, 'r2')
    let current = await repo.save(backgroundB.project, first.map.id, [r1], [], { entities: [entity], markers: [marker('m1', first.map.id, r1.id)] })
    current = await repo.save(current, second.map.id, [r2], [], { entities: [entity], markers: [marker('m2', second.map.id, r2.id)] })
    const snapshots = new IndexedDbProjectBackupRepository(() => factory)
    const before = await snapshots.snapshot(project.id)
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'projects') throw new Error('Нет места'); return put.apply(this, args) })
    try { await expect(localizedFailure(navigation.deleteMap(current, first.map.id))).rejects.toThrow('Нет места') } finally { spy.mockRestore() }
    expect(await snapshots.snapshot(project.id)).toEqual(before)
    current = await navigation.deleteMap(current, first.map.id)
    const after = await snapshots.snapshot(project.id)
    expect(after.maps).toEqual([backgroundB.image.map]); expect(after.regions).toEqual([r2]); expect(after.markerPlacements).toEqual([marker('m2', second.map.id, r2.id)])
    expect(after.entities).toEqual([entity]); expect(after.assets).toHaveLength(2)
    expect(after.imagePlacements).toEqual([backgroundB.image.background!.placement])
    await expect(localizedFailure(navigation.deleteMap(project, second.map.id))).rejects.toThrow('другой вкладке')
    await expect(localizedFailure(navigation.deleteMap(current, 'missing'))).rejects.toThrow('не найдена')
    current = await navigation.deleteMap(current, second.map.id)
    const empty = await snapshots.snapshot(project.id)
    expect(empty.maps).toEqual([]); expect(empty.regions).toEqual([]); expect(empty.markerPlacements).toEqual([]); expect(empty.imagePlacements).toEqual([])
    expect(empty.entities).toEqual([entity]); expect(empty.assets.map((a) => a.id)).toEqual([backgroundA.image.background!.asset.id])
    expect(empty.project.revision).toBe(current.revision)
  })
  it('persists tag history together with card data, rolls both back on errors, and leaves copies with a deterministic fallback', async () => {
    const { factory, project, navigation } = await setup(); const first = await navigation.createMap(project, 'Башня')
    const repo = new IndexedDbRegionRepository(() => factory)
    const region = { ...makeRegion(first.map.id, 'r1'), tags: ['Ловушка', 'Тайна'] }
    let current = await repo.save(first.project, first.map.id, [region], [], undefined, region.tags)
    expect((await new IndexedDbNavigationRepository(() => factory).load(project.id)).tagHistory).toEqual(['Тайна', 'Ловушка'])
    const entity: Entity = { checks: [], id: 'e1', projectId: project.id, kind: 'enemy', name: 'Страж', description: emptyDocument(), status: 'alive', tags: ['Ловушка', 'Ключ'] }
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'projects') throw new Error('Нет места'); return put.apply(this, args) })
    try { await expect(localizedFailure(repo.save(current, first.map.id, [region], [], { entities: [entity], markers: [] }, entity.tags))).rejects.toThrow('Нет места') } finally { spy.mockRestore() }
    expect((await navigation.load(project.id)).tagHistory).toEqual(['Тайна', 'Ловушка']); expect((await navigation.load(project.id)).entities).toEqual([])
    current = await repo.save(current, first.map.id, [region], [], { entities: [entity], markers: [] }, entity.tags)
    expect((await navigation.load(project.id)).tagHistory).toEqual(['Ключ', 'Ловушка', 'Тайна'])
    await repo.save(current, first.map.id, [region], [], { entities: [entity], markers: [] })
    expect((await navigation.load(project.id)).tagHistory).toEqual(['Ключ', 'Ловушка', 'Тайна']) // geometry saves do not reorder tags
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const copy = independentCopy(await backups.snapshot(project.id)); await backups.insertCopy(copy)
    const data = await navigation.load(copy.project.id)
    expect(data.tagHistory).toEqual([])
    expect(tagCatalog([...data.regions.flatMap((r) => r.tags), ...data.entities.flatMap((e) => e.tags)], data.tagHistory)).toEqual(['Ключ', 'Ловушка', 'Тайна'])
  })
  it('keeps map creation within the existing archive limit, so a project stays exportable', async () => {
    const { factory, project, navigation, projects } = await setup()
    const db = new IndexedDb(() => factory)
    await db.transaction(['maps'], 'readwrite', async (tx) => {
      for (let n = 0; n < MAX_PROJECT_MAPS; n++) await requestResult(tx.objectStore('maps').add({ id: `map-${n}`, projectId: project.id, name: `Карта ${n}`, description: legacyContextDocument(''), order: n, coordinateBounds: { x: 0, y: 0, width: 1000, height: 1000 } }))
    })
    expect(MAX_PROJECT_MAPS).toBe(BACKUP_LIMITS.maps)
    await expect(navigation.createMap(project, 'Лишняя')).rejects.toThrow(String(BACKUP_LIMITS.maps))
    expect((await navigation.load(project.id)).maps).toHaveLength(MAX_PROJECT_MAPS)
    expect((await projects.restore())?.revision).toBe(project.revision)
  })
  it('creates/renames independent maps and targets image changes to the selected map, preserving the others', async () => {
    const { project, navigation, images } = await setup()
    const first = await navigation.createMap(project, 'Башня'); const second = await navigation.createMap(first.project, 'Подвал')
    const backgroundA = await images.replace(second.project, testAsset(project.id), first.map.id)
    const backgroundB = await images.replace(backgroundA.project, testAsset(project.id, 800), second.map.id)
    const renamed = await navigation.renameMap(backgroundB.project, second.map.id, 'Нижний этаж')
    const data = await navigation.load(project.id)
    expect(data.maps.map((m) => m.name)).toEqual(['Башня', 'Нижний этаж']); expect(data.maps[1].coordinateBounds.width).toBe(800)
    expect(await images.load(project.id, first.map.id)).toEqual(backgroundA.image)
    expect((await images.load(project.id, second.map.id)).background?.asset.id).toBe(backgroundB.image.background?.asset.id)
    await images.remove(renamed, second.map.id)
    expect((await images.load(project.id, first.map.id)).background?.asset.id).toBe(backgroundA.image.background?.asset.id)
    expect((await images.load(project.id, second.map.id)).background).toBeUndefined()
    await expect(navigation.renameMap(project, first.map.id, 'Конфликт')).rejects.toThrow()
    await expect(localizedFailure(images.load(project.id, 'foreign'))).rejects.toThrow('не найдена')
  })
  it('rolls back map creation/rename on a late write failure and retains project revision', async () => {
    const { project, navigation, projects } = await setup(); const first = await navigation.createMap(project, 'Башня')
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'projects') throw new Error('Нет места'); return put.apply(this, args) })
    try {
      await expect(localizedFailure(navigation.createMap(first.project, 'Не записана'))).rejects.toThrow('Нет места')
      await expect(localizedFailure(navigation.renameMap(first.project, first.map.id, 'Не записано'))).rejects.toThrow('Нет места')
    } finally { spy.mockRestore() }
    expect((await navigation.load(project.id)).maps).toEqual([first.map])
    expect((await projects.restore())?.revision).toBe(first.project.revision)
  })
  it('isolates project maps and rejects foreign-map writes and blank names', async () => {
    const { project, projects, navigation } = await setup(); const first = await navigation.createMap(project, 'Башня')
    const other = await projects.save(createProject('Другой'))
    expect((await navigation.load(other.id)).maps).toEqual([])
    await expect(localizedFailure(navigation.renameMap(other, first.map.id, 'Чужая карта'))).rejects.toThrow('не найдена')
    await expect(localizedFailure(navigation.createMap(other, '  '))).rejects.toThrow('название')
    expect((await navigation.load(project.id)).maps).toEqual([first.map])
  })
})
