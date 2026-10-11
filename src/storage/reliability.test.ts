import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { unzipSync, zipSync } from 'fflate'
import { testDecode, testSnapshot } from './backup/testSnapshot'
import { buildArchive, parseArchive, sha256 } from './backup/archive'
import { IndexedDbProjectBackupRepository } from './indexedDbProjectBackupRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { IndexedDbRegionRepository } from './indexedDbRegionRepository'
import { independentCopy } from '../application/projectBackupRepository'
import { emptyRegionContent } from '../domain/region'
import { documentAssetIds } from '../domain/richText'
import { markdownToDocument } from './migrateRegionText'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
import { ProjectSession } from '../application/projectSession'
import { RegionSession } from '../application/regionSession'
import { IndexedDbModeRepository } from './indexedDbModeRepository'

async function fullProject() {
  const snapshot = await testSnapshot()
  const document = markdownToDocument('# Тайна\n\n**Страж** и *ключ*\n\n> Подсказка\n\n- Один\n- Два\n\n| Навык | СЛ |\n| --- | --- |\n| Сила | 12 |')
  document.content.push({ type: 'image', attrs: { assetId: snapshot.assets[0].id, alt: 'Схема' } })
  snapshot.regions = [0, 1, 2].map((n) => ({ ...emptyRegionContent(), id: `region-${n}`, mapId: snapshot.maps[n === 2 ? 1 : 0].id, number: n + 1, title: `Зал ${n}`, titleCustomized: true, order: n, color: '#ee3344', fillOpacity: .65, vertices: [{ x: -10, y: 5 }, { x: 50, y: 5 }, { x: 20, y: 50 }], gmNotes: structuredClone(document), playerDescription: markdownToDocument('## Для игроков\n[Ключ](https://example.org/)'), tags: ['Ловушка', 'золото'], checks: [{ id: `check-${n}`, condition: 'Открытие', ability: 'Сила', dc: 12, result: 'Открыто' }] }))
  snapshot.entities = [0, 1].map((n) => ({ id: `entity-${n}`, projectId: snapshot.project.id, kind: 'enemy' as const, name: `Страж ${n}`, status: n ? 'defeated' : 'hidden', tags: ['Ловушка'], description: structuredClone(document) }))
  snapshot.markerPlacements = [0, 1].map((n) => ({ id: `marker-${n}`, entityId: snapshot.entities[n].id, mapId: snapshot.maps[0].id, x: n * 50, y: -25, regionIds: snapshot.regions.slice(0, 2).map((r) => r.id), color: '#44aabb', locked: !!n, order: n }))
  return snapshot
}
describe('Complete local recovery', () => {
  it('blocks geometry, draft placement and status handlers in a reader, allowing them after acquisition', async () => {
    const factory = new IDBFactory(); const backup = new IndexedDbProjectBackupRepository(() => factory); const original = await fullProject(); await backup.insertCopy(original)
    let writable = false
    const projects = new ProjectSession(new IndexedDbProjectRepository(() => factory), { select: async () => {}, release: async () => { writable = false }, canEdit: () => writable, message: () => 'Только просмотр' })
    await projects.initialize(); const session = new RegionSession(new IndexedDbRegionRepository(() => factory), projects, new IndexedDbModeRepository(() => factory)); await session.loadMode(original.project.id); await session.load(original.maps[0].id)
    session.start({ x: 1, y: 1 }); session.startMarker('enemy'); session.placeMarker({ x: 2, y: 2 }); await session.moveMarker('marker-0', { x: 100, y: 100 }); await session.removeMarker('marker-0'); session.openCard('region-0'); await session.remove(); await session.changeStatus('entity-0', 'alive')
    expect(session.getSnapshot().draft).toBeUndefined(); expect(session.getSnapshot().markerTool).toBeUndefined(); expect(session.getSnapshot().markerDraft).toBeUndefined()
    expect(await backup.snapshot(original.project.id)).toMatchObject({ project: original.project, regions: original.regions, markerPlacements: original.markerPlacements, entities: original.entities })
    writable = true; await projects.requestEditing(); await session.changeStatus('entity-0', 'alive'); expect((await backup.snapshot(original.project.id)).entities[0].status).toBe('alive')
  })
  it('restores all documents/images/multi-links, remaps every reference and independently reopens the copy', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectBackupRepository(() => factory); const original = await fullProject(); await repo.insertCopy(original)
    const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(await repo.snapshot(original.project.id)))]), testDecode)
    expect(parsed).toMatchObject({ project: original.project, maps: original.maps, regions: original.regions, imagePlacements: original.imagePlacements, entities: original.entities, markerPlacements: original.markerPlacements })
    const copy = independentCopy(parsed); await repo.insertCopy(copy)
    const reopened = await new IndexedDbProjectBackupRepository(() => factory).snapshot(copy.project.id)
    const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
    expect(sorted(reopened.regions)).toEqual(sorted(copy.regions)); expect(sorted(reopened.entities)).toEqual(sorted(copy.entities)); expect(sorted(reopened.markerPlacements)).toEqual(sorted(copy.markerPlacements))
    for (const doc of [...reopened.regions.flatMap((r) => [r.gmNotes, r.playerDescription]), ...reopened.entities.map((e) => e.description)]) {
      for (const id of documentAssetIds(doc)) { expect(original.assets.some((a) => a.id === id)).toBe(false); expect(reopened.assets.some((a) => a.id === id)).toBe(true) }
    }
    for (let i = 0; i < original.assets.length; i++) expect(await reopened.assets.find((a) => a.id === copy.assets[i].id)!.blob.arrayBuffer()).toEqual(await original.assets[i].blob.arrayBuffer())
    for (const marker of reopened.markerPlacements) { expect(reopened.entities.some((e) => e.id === marker.entityId)).toBe(true); expect(marker.regionIds.every((id) => reopened.regions.some((r) => r.id === id && r.mapId === marker.mapId))).toBe(true) }
    await new IndexedDbRegionRepository(() => factory).saveStatus(copy.project, copy.entities[0].id, copy.entities[0].status, 'alive')
    expect((await repo.snapshot(original.project.id)).entities).toEqual(original.entities)
    expect((await new IndexedDbProjectRepository(() => factory).open(copy.project.id)).id).toBe(copy.project.id)
  })
  it('rolls back all copied object stores and selection when the final import write fails', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectBackupRepository(() => factory); const original = await fullProject(); await repo.insertCopy(original)
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'settings') throw new DOMException('Диск заполнен', 'QuotaExceededError'); return put.apply(this, args) })
    await expect(repo.insertCopy(independentCopy(original))).rejects.toThrow('Недостаточно места'); spy.mockRestore()
    const db = new IndexedDb(() => factory)
    for (const [store, count] of [['projects', 1], ['maps', 3], ['assets', 2], ['imagePlacements', 2], ['regions', 3], ['entities', 2], ['markerPlacements', 2]] as const) expect(await db.transaction([store], 'readonly', (tx) => requestResult(tx.objectStore(store).count()))).toBe(count)
    expect((await new IndexedDbProjectRepository(() => factory).restore())?.id).toBe(original.project.id)
  })
  it('retains a failed context draft, retries it, and rejects a late save with an obsolete revision', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectRepository(() => factory); const session = new ProjectSession(repo); await session.initialize(); await session.create('Проект')
    const stale = session.getSnapshot().project!; session.edit({ name: stale.name, contextMd: 'Последний текст' })
    const put = IDBObjectStore.prototype.put; const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'settings') throw new DOMException('Диск заполнен', 'QuotaExceededError'); return put.apply(this, args) })
    await session.save(); expect(session.getSnapshot()).toMatchObject({ status: 'error', project: { contextMd: 'Последний текст' } }); expect(await repo.restore()).toEqual(stale)
    spy.mockRestore(); await session.retry(); expect(session.getSnapshot().status).toBe('saved')
    await expect(new IndexedDbProjectRepository(() => factory).save({ ...stale, contextMd: 'Старый текст' })).rejects.toThrow('другой вкладке'); expect((await repo.restore())?.contextMd).toBe('Последний текст')
  })
  it('rejects missing images and checksum-valid broken rich-document references before inserting', async () => {
    const snapshot = await fullProject(); const bytes = await buildArchive(snapshot)
    const missing = unzipSync(bytes); delete missing['assets/0.png']; await expect(parseArchive(new Blob([new Uint8Array(zipSync(missing))]), testDecode)).rejects.toThrow()
    const broken = unzipSync(bytes); const doc = JSON.parse(new TextDecoder().decode(broken['project.json'])); doc.entities[0].description.content.push({ type: 'image', attrs: { assetId: 'missing', alt: '' } })
    broken['project.json'] = new TextEncoder().encode(JSON.stringify(doc)); const manifest = JSON.parse(new TextDecoder().decode(broken['manifest.json'])); const file = manifest.files.find((f: { path: string }) => f.path === 'project.json'); file.byteSize = broken['project.json'].length; file.sha256 = await sha256(broken['project.json']); broken['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    await expect(parseArchive(new Blob([new Uint8Array(zipSync(broken))]), testDecode)).rejects.toThrow('отсутствующее изображение')
  })
  it('refuses a newer database without clearing its content or creating an empty project', async () => {
    const factory = new IDBFactory(); const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME, 8); r.onupgradeneeded = () => r.result.createObjectStore('future'); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>((resolve) => { const tx = db.transaction('future', 'readwrite'); tx.objectStore('future').put('Существующие данные', 'data'); tx.oncomplete = () => resolve() }); db.close()
    const session = new ProjectSession(new IndexedDbProjectRepository(() => factory)); await session.initialize(); expect(session.getSnapshot().project).toBeUndefined(); expect(session.getSnapshot().error).toContain('новее')
    const untouched = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME); r.onsuccess = () => resolve(r.result) }); expect(untouched.version).toBe(8); expect(await requestResult(untouched.transaction('future').objectStore('future').get('data'))).toBe('Существующие данные'); untouched.close()
  })
})
