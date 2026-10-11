import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DATABASE_NAME, DATABASE_VERSION } from './indexedDb'
import { IndexedDbProjectBackupRepository } from './indexedDbProjectBackupRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { migrateMarkerPlacement } from './migrateMarkerPlacements'
import { testSnapshot } from './backup/testSnapshot'
import { emptyRegionContent } from '../domain/region'
import { emptyDocument } from '../domain/richText'

const marker = { id: 'a', mapId: 'map-0', entityId: 'e', x: 17, y: -9, color: '#d7ad62', locked: true, order: 0, regionId: 'r' }
async function legacy(markers: unknown[]) {
  const factory = new IDBFactory(); const snapshot = await testSnapshot()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open(DATABASE_NAME, 6)
    r.onupgradeneeded = () => {
      const db = r.result
      for (const name of ['projects', 'maps', 'assets', 'imagePlacements', 'regions', 'entities', 'markerPlacements']) db.createObjectStore(name, { keyPath: 'id' })
      for (const name of ['maps', 'assets', 'entities']) r.transaction!.objectStore(name).createIndex('projectId', 'projectId')
      r.transaction!.objectStore('imagePlacements').createIndex('mapId', 'mapId', { unique: true })
      r.transaction!.objectStore('regions').createIndex('mapId', 'mapId')
      r.transaction!.objectStore('markerPlacements').createIndex('mapId', 'mapId')
      r.transaction!.objectStore('markerPlacements').createIndex('entityId', 'entityId')
      db.createObjectStore('settings')
    }
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
  })
  const region = { ...emptyRegionContent(), id: 'r', mapId: 'map-0', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], order: 0, number: 1, title: 'Старый зал', titleCustomized: true, color: '#d7ad62', fillOpacity: .4 }
  const entity = { checks: [], id: 'e', projectId: snapshot.project.id, kind: 'enemy' as const, name: 'Страж', status: 'hidden', description: emptyDocument(), tags: ['старый'] }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite')
    tx.objectStore('projects').add(snapshot.project)
    for (const m of snapshot.maps) tx.objectStore('maps').add(m)
    for (const a of snapshot.assets) tx.objectStore('assets').add(a)
    for (const p of snapshot.imagePlacements) tx.objectStore('imagePlacements').add(p)
    const { shortDescription: _description, ...legacyRegion } = region; void _description
    const { checks: _checks, ...legacyEntity } = entity; void _checks
    tx.objectStore('regions').add(legacyRegion); tx.objectStore('entities').add(legacyEntity)
    for (const m of markers) tx.objectStore('markerPlacements').add(m)
    tx.objectStore('settings').put(snapshot.project.id, 'activeProjectId')
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
  }); db.close()
  return { factory, snapshot, region, entity }
}
describe('IndexedDB 6 → 7 marker migration', () => {
  it('keeps single/absent links, geometry, descriptions, project revision and active selection', async () => {
    const { regionId: _region, ...unbound } = marker; void _region
    const old = await legacy([marker, { ...unbound, id: 'b' }])
    const read = await new IndexedDbProjectBackupRepository(() => old.factory).snapshot(old.snapshot.project.id)
    expect(read).toMatchObject({ project: old.snapshot.project, maps: old.snapshot.maps, imagePlacements: old.snapshot.imagePlacements, regions: [old.region], entities: [old.entity] })
    expect(read.assets).toHaveLength(2)
    expect(read.markerPlacements).toEqual([{ ...unbound, regionIds: ['r'] }, { ...unbound, id: 'b', regionIds: [] }])
    expect((await new IndexedDbProjectRepository(() => old.factory).restore())?.id).toBe(old.snapshot.project.id)
    expect(read.markerPlacements.every((m) => !Object.hasOwn(m, 'regionId'))).toBe(true)
  })
  it('rolls back the entire upgrade on malformed legacy data, including earlier cursor updates', async () => {
    const old = await legacy([marker, { ...marker, id: 'z', regionId: 7 }])
    await expect(new IndexedDbProjectBackupRepository(() => old.factory).snapshot(old.snapshot.project.id)).rejects.toThrow()
    const db = await new Promise<IDBDatabase>((resolve) => { const r = old.factory.open(DATABASE_NAME); r.onsuccess = () => resolve(r.result) })
    expect(db.version).toBe(6); expect(db.version).toBeLessThan(DATABASE_VERSION)
    const rows = await new Promise<unknown[]>((resolve) => { const r = db.transaction('markerPlacements').objectStore('markerPlacements').getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
    expect(rows).toEqual([marker, { ...marker, id: 'z', regionId: 7 }])
  })
  it('is idempotent for a valid list and rejects duplicates', () => {
    const migrated = migrateMarkerPlacement(marker)
    expect(migrateMarkerPlacement(migrated)).toEqual(migrated)
    expect(() => migrateMarkerPlacement({ ...migrated, regionIds: ['r', 'r'] })).toThrow()
  })
})
