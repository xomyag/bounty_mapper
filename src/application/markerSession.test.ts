import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { RegionSession, detailsOf } from './regionSession'
import { ProjectSession } from './projectSession'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive, sha256 } from '../storage/backup/archive'
import { unzipSync, zipSync } from 'fflate'
import { independentCopy } from './projectBackupRepository'
import { markerTypes } from '../domain/marker'
import type { MarkerKind } from '../domain/marker'
import { markdownToDocument } from '../storage/migrateRegionText'

async function setup() {
  const factory = new IDBFactory()
  const backups = new IndexedDbProjectBackupRepository(() => factory)
  const original = await testSnapshot(); await backups.insertCopy(original)
  const projects = new ProjectSession(new IndexedDbProjectRepository(() => factory)); await projects.initialize()
  const repo = new IndexedDbRegionRepository(() => factory)
  const session = new RegionSession(repo, projects); await session.load(original.maps[0].id)
  const snapshot = () => backups.snapshot(original.project.id)
  return { factory, backups, projects, repo, session, snapshot, original }
}
async function add(session: RegionSession, kind: MarkerKind = 'enemy', x = 5) {
  session.startMarker(kind); session.placeMarker({ x, y: 5 })
  const id = session.getSnapshot().markerDraft!.marker.id
  await session.saveMarkerDetails()
  expect(session.getSnapshot().markerDraft).toBeUndefined()
  return id
}
async function area(session: RegionSession) {
  session.start(); for (const p of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]) session.addPoint(p)
  await session.finish(); return session.getSnapshot().regions.at(-1)!
}

describe('BM-007 markers and entities', () => {
  it('focuses card links in both directions only after a confirmed transition, without changing project data', async () => {
    const { session, snapshot } = await setup(); const r = await area(session); const id = await add(session, 'npc', 40)
    const before = await snapshot()
    session.openCard(r.id, true)
    const regionFocus = session.getSnapshot().viewFocus
    expect(regionFocus?.point).toEqual({ x: 5, y: 5 })
    session.editDetails(r.id, { ...detailsOf(r), title: 'Несохранённое название' })
    session.openMarkerCard(id, true)
    expect(session.getSnapshot().viewFocus).toBe(regionFocus)
    await session.resolveCardIntent('stay')
    expect(session.getSnapshot().cardId).toBe(r.id)
    expect(session.getSnapshot().details[r.id].fields.title).toBe('Несохранённое название')
    session.openMarkerCard(id, true); await session.resolveCardIntent('discard')
    const markerFocus = session.getSnapshot().viewFocus
    expect(markerFocus?.point).toEqual({ x: 40, y: 5 })
    expect(session.getSnapshot().markerCardId).toBe(id)
    expect(await snapshot()).toEqual(before)
    session.closeCard(); session.openCard(r.id)
    expect(session.getSnapshot().viewFocus).toBe(markerFocus)
    session.closeCard(); session.openMarkerCard(id)
    expect(session.getSnapshot().viewFocus).toBe(markerFocus)
    await session.load(r.mapId)
    expect(session.getSnapshot().viewFocus).toBeUndefined()
  })
  it('keeps a new placement/entity entirely in memory until Save; Cancel leaves no empty rows', async () => {
    const { session, snapshot } = await setup(); const before = await snapshot()
    session.startMarker('enemy'); session.placeMarker({ x: 5, y: 5 })
    expect(session.getSnapshot()).toMatchObject({ cardMode: 'edit', markerDraft: { isNew: true } })
    expect(session.hasUnsavedDetails()).toBe(true)
    expect(await snapshot()).toEqual(before)
    session.cancelMarkerEdit()
    expect(session.getSnapshot().markerCardId).toBeUndefined()
    expect(session.hasUnsavedDetails()).toBe(false)
    expect(await snapshot()).toEqual(before)
  })
  it('moves a new marker entirely in memory, retaining edited fields and only saving the final position', async () => {
    const { session, snapshot } = await setup(); const before = await snapshot()
    session.startMarker('enemy'); session.placeMarker({ x: 5, y: 5 })
    const id = session.getSnapshot().markerDraft!.marker.id
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, name: 'Перемещённый черновик', tags: ['страж'] })
    session.moveMarkerDraft(id, { x: 20, y: -7 }); session.moveMarkerDraft(id, { x: 40, y: 10 })
    expect(await snapshot()).toEqual(before)
    expect(session.getSnapshot().markerDraft?.fields.name).toBe('Перемещённый черновик')
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, locked: true })
    session.moveMarkerDraft(id, { x: 99, y: 99 })
    expect(session.getSnapshot().markerDraft?.marker).toMatchObject({ x: 40, y: 10 })
    await session.saveMarkerDetails()
    expect((await snapshot()).markerPlacements[0]).toMatchObject({ x: 40, y: 10, locked: true })
    await session.undo(); expect((await snapshot()).markerPlacements).toEqual([])
    session.startMarker('npc'); session.placeMarker({ x: 2, y: 3 }); session.moveMarkerDraft(session.getSnapshot().markerDraft!.marker.id, { x: 7, y: 8 }); session.cancelMarkerEdit()
    expect((await snapshot()).entities).toHaveLength(1)
  })
  it('binds to multiple regions, preserves other links on deletion, restores them on undo and remaps all archive links', async () => {
    const { session, snapshot } = await setup(); const a = await area(session); const b = await area(session); const id = await add(session)
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [a.id, b.id] }); await session.saveMarkerDetails()
    const before = await snapshot()
    const copy = independentCopy(await parseArchive(new Blob([new Uint8Array(await buildArchive(before))]), testDecode))
    expect(new Set(copy.markerPlacements[0].regionIds)).toEqual(new Set(copy.regions.map((r) => r.id)))
    expect(copy.markerPlacements[0].regionIds).not.toContain(a.id)
    session.closeCard(); session.select(a.id); await session.remove()
    expect((await snapshot()).markerPlacements[0].regionIds).toEqual([b.id])
    session.openMarkerCard(id); session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, status: 'hidden' }); await session.saveMarkerDetails()
    await session.undo(); expect((await snapshot()).markerPlacements[0].regionIds).toEqual([a.id, b.id]); expect((await snapshot()).entities[0].status).toBe('hidden')
    await session.redo(); expect((await snapshot()).markerPlacements[0].regionIds).toEqual([b.id])
    await session.load(a.mapId); expect(session.getSnapshot().markers[0].regionIds).toEqual([b.id])
  })
  it('migrates ZIP v5 single/absent bindings and rejects invalid v6 lists without losing data', async () => {
    const { session, snapshot } = await setup(); const r = await area(session); await add(session)
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [r.id] }); await session.saveMarkerDetails(); await add(session, 'npc')
    const saved = await snapshot(); const files = unzipSync(await buildArchive(saved))
    const document = JSON.parse(new TextDecoder().decode(files['project.json']))
    for (const marker of document.markerPlacements) { if (marker.regionIds.length) marker.regionId = marker.regionIds[0]; delete marker.regionIds }
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    manifest.formatVersion = 5
    const entry = manifest.files.find((f: { path: string }) => f.path === 'project.json')
    entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json'])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const restored = await parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)
    expect(restored).toMatchObject({ entities: saved.entities, regions: saved.regions, markerPlacements: saved.markerPlacements })
    expect(restored.markerPlacements[0]).not.toHaveProperty('regionId')
    await expect(buildArchive({ ...saved, markerPlacements: [{ ...saved.markerPlacements[0], regionIds: [r.id, r.id] }] })).rejects.toThrow()
    await expect(buildArchive({ ...saved, markerPlacements: [{ ...saved.markerPlacements[0], regionIds: [r.id, 'missing'] }] })).rejects.toThrow()
    expect(await snapshot()).toEqual(saved)
  })
  it('creates independent enemies with valid statuses for every type and no content in placements', async () => {
    const { session, snapshot } = await setup()
    const a = await add(session); const b = await add(session)
    session.openMarkerCard(a); session.beginMarkerEdit()
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, status: 'defeated', name: 'Первый', description: markdownToDocument('Описание первого'), tags: ['бой'] })
    await session.saveMarkerDetails()
    const saved = await snapshot()
    expect(saved.entities).toHaveLength(2)
    const ma = saved.markerPlacements.find((m) => m.id === a)!
    const mb = saved.markerPlacements.find((m) => m.id === b)!
    expect(ma.entityId).not.toBe(mb.entityId)
    expect(saved.entities.find((e) => e.id === ma.entityId)?.status).toBe('defeated')
    expect(saved.entities.find((e) => e.id === mb.entityId)?.status).toBe('alive')
    expect(ma).not.toHaveProperty('description'); expect(ma).not.toHaveProperty('status')
    for (const kind of Object.keys(markerTypes) as MarkerKind[]) await add(session, kind)
    const id = session.getSnapshot().markers.at(-1)!.id
    session.openMarkerCard(id); session.beginMarkerEdit()
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, status: 'defeated' })
    await session.saveMarkerDetails()
    expect(session.getSnapshot().markerDraft?.error).toContain('статус')
  })
  it('chooses bindings explicitly, retains them through moves, respects locks and treats each move as one undo', async () => {
    const { session, snapshot } = await setup(); const r = await area(session); const id = await add(session)
    expect((await snapshot()).markerPlacements[0].regionIds).toEqual([])
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [r.id], locked: true })
    await session.saveMarkerDetails(); session.closeCard()
    const before = (await snapshot()).markerPlacements[0]
    await session.moveMarker(id, { x: 100, y: -5 }); expect((await snapshot()).markerPlacements[0]).toEqual(before)
    session.openMarkerCard(id); session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, locked: false }); await session.saveMarkerDetails(); session.closeCard()
    await session.moveMarker(id, { x: 100, y: -5 })
    expect(session.getSnapshot().markerCardId).toBeUndefined()
    expect((await snapshot()).markerPlacements[0]).toMatchObject({ x: 100, y: -5, regionIds: [r.id] })
    await session.undo(); expect((await snapshot()).markerPlacements[0]).toMatchObject({ x: 5, y: 5, regionIds: [r.id] })
    await session.redo(); expect((await snapshot()).markerPlacements[0].x).toBe(100)
    await session.removeMarker(id); const removed = await snapshot()
    expect(removed.markerPlacements).toEqual([]); expect(removed.entities).toHaveLength(1)
    await session.undo(); expect((await snapshot()).markerPlacements[0]).toMatchObject({ id, x: 100 })
  })
  it('clears region bindings atomically and restores them on region undo, retaining entities and markers', async () => {
    const { session, snapshot } = await setup(); const r = await area(session); await add(session)
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [r.id] }); await session.saveMarkerDetails()
    const before = await snapshot()
    session.closeCard(); session.select(r.id); await session.remove()
    const deleted = await snapshot(); expect(deleted.regions).toEqual([])
    expect(deleted.markerPlacements[0].regionIds).toEqual([]); expect(deleted.entities).toEqual(before.entities)
    session.openMarkerCard(deleted.markerPlacements[0].id); session.beginMarkerEdit()
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, status: 'hidden' }); await session.saveMarkerDetails()
    await session.undo(); const restored = await snapshot()
    expect(restored.regions).toEqual(before.regions); expect(restored.markerPlacements).toEqual(before.markerPlacements)
    expect(restored.entities[0].status).toBe('hidden')
    await session.redo(); expect((await snapshot()).markerPlacements[0].regionIds).toEqual([])
  })
  it('rebases a clean open form after undo/move and closes it when its placement is removed', async () => {
    const { session, snapshot } = await setup(); const id = await add(session)
    session.closeCard(); await session.moveMarker(id, { x: 25, y: 30 })
    session.openMarkerCard(id); session.beginMarkerEdit(); await session.undo()
    expect(session.getSnapshot().markerDraft?.marker).toMatchObject({ x: 5, y: 5 })
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, name: 'Текст после отмены' }); await session.saveMarkerDetails()
    expect((await snapshot()).markerPlacements[0]).toMatchObject({ x: 5, y: 5 })
    session.beginMarkerEdit(); await session.moveMarker(id, { x: 40, y: 50 })
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, status: 'hidden' }); await session.saveMarkerDetails()
    expect((await snapshot()).markerPlacements[0]).toMatchObject({ x: 40, y: 50 })
    session.beginMarkerEdit(); await session.removeMarker(id)
    expect(session.getSnapshot().markerDraft).toBeUndefined(); expect(session.getSnapshot().markerCardId).toBeUndefined()
    await session.undo(); expect((await snapshot()).entities[0].status).toBe('hidden')
  })
  it('prompts across marker/region cards and preserves the draft after an atomic late write failure', async () => {
    const { session, snapshot, original } = await setup(); const r = await area(session)
    session.startMarker('door'); session.placeMarker({ x: 2, y: 3 })
    const draft = session.getSnapshot().markerDraft!
    session.editMarkerDetails({ ...draft.fields, name: 'Дверь с текстом', description: markdownToDocument('Не потерять'), regionIds: [r.id] })
    const asset = { ...original.assets[0], id: 'inline-marker' }; session.addMarkerDraftAsset(asset)
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Не потерять' }] }, { type: 'image', attrs: { assetId: asset.id, alt: 'Снимок' } }] } })
    session.openCard(r.id, true)
    expect(session.getSnapshot().pendingIntent).toEqual({ kind: 'open', id: r.id, center: true })
    expect(session.getSnapshot().viewFocus).toBeUndefined()
    const before = await snapshot()
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError'); return put.apply(this, args) })
    try { await session.resolveCardIntent('save') } finally { spy.mockRestore() }
    expect(await snapshot()).toEqual(before)
    expect(session.getSnapshot().markerDraft?.error).toBe('Нет места')
    expect(session.getSnapshot().markerDraft?.fields.name).toBe('Дверь с текстом')
    expect(session.getSnapshot().viewFocus).toBeUndefined()
    await expect(session.flushDetails()).rejects.toThrow('Сначала сохраните')
    await session.resolveCardIntent('stay'); session.openCard(r.id, true); await session.resolveCardIntent('save')
    expect(session.getSnapshot().cardId).toBe(r.id); expect(session.getSnapshot().markerCardId).toBeUndefined()
    expect(session.getSnapshot().viewFocus?.point).toEqual({ x: 5, y: 5 })
    expect((await snapshot()).assets).toHaveLength(3)
  })
  it('reloads and restores an independent archive copy with every ID/reference and inline image remapped', async () => {
    const { session, snapshot, original, backups, repo, projects } = await setup(); const r = await area(session); const id = await add(session, 'npc')
    session.beginMarkerEdit()
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [r.id], name: 'Проводник', status: 'gone', locked: true, description: { type: 'doc', content: [{ type: 'image', attrs: { assetId: original.assets[0].id, alt: 'Портрет' } }] } })
    await session.saveMarkerDetails(); const saved = await snapshot()
    await session.load(r.mapId); expect(session.getSnapshot().markers).toEqual(saved.markerPlacements); expect(session.getSnapshot().markerCardId).toBeUndefined()
    const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(saved))]), testDecode)
    expect(parsed.entities).toEqual(saved.entities); expect(parsed.markerPlacements).toEqual(saved.markerPlacements)
    const copy = independentCopy(parsed); await backups.insertCopy(copy)
    const m = copy.markerPlacements[0]; const e = copy.entities[0]
    expect(m.id).not.toBe(id); expect(m.entityId).toBe(e.id); expect(m.mapId).toBe(copy.regions[0].mapId); expect(m.regionIds).toEqual([copy.regions[0].id])
    expect(e.description.content[0].attrs!.assetId).toBe(copy.assets[0].id)
    await repo.save(copy.project, m.mapId, copy.regions, [], { markers: copy.markerPlacements, entities: [{ ...e, name: 'Копия' }] })
    expect(await snapshot()).toEqual(saved); expect(projects.getSnapshot().project!.id).toBe(original.project.id)
  })
  it('retains an image shared by a background and an entity description when the background is removed', async () => {
    const { session, snapshot, factory, projects, original } = await setup(); await add(session, 'npc')
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, description: { type: 'doc', content: [{ type: 'image', attrs: { assetId: original.assets[0].id, alt: 'Общий рисунок' } }] } }); await session.saveMarkerDetails()
    const images = new IndexedDbMapImageRepository(() => factory)
    await images.remove(projects.getSnapshot().project!)
    const saved = await snapshot()
    expect(saved.imagePlacements.some((p) => p.assetId === original.assets[0].id)).toBe(false)
    expect(saved.assets.find((a) => a.id === original.assets[0].id)?.blob.size).toBe(original.assets[0].blob.size)
    await expect(buildArchive(saved)).resolves.toBeInstanceOf(Uint8Array)
  })
  it('rolls back an imported copy including markers, entities and assets after a late write error', async () => {
    const { session, snapshot, backups, original } = await setup(); const r = await area(session); await add(session)
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [r.id] }); await session.saveMarkerDetails()
    const saved = await snapshot(); const copy = independentCopy(saved)
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'settings') throw new Error('Ошибка завершения импорта'); return put.apply(this, args) })
    try { await expect(backups.insertCopy(copy)).rejects.toThrow('Ошибка завершения импорта') } finally { spy.mockRestore() }
    expect(await snapshot()).toEqual(saved)
    await expect(backups.snapshot(copy.project.id)).rejects.toThrow()
    // A retry with the exact same IDs proves that no orphan rows survived.
    await backups.insertCopy(copy); const reread = await backups.snapshot(copy.project.id)
    expect(reread.project).toEqual(copy.project)
    for (const key of ['maps', 'assets', 'imagePlacements', 'regions', 'entities', 'markerPlacements'] as const) {
      expect(reread[key]).toHaveLength(copy[key].length)
      for (const row of copy[key]) expect(reread[key].find((r) => r.id === row.id)).toEqual(row)
    }
    expect((await snapshot()).project.id).toBe(original.project.id)
  })
  it('imports BM-006 ZIP v4 with unchanged rich notes and empty object collections', async () => {
    const { session, snapshot, original } = await setup(); const r = await area(session)
    session.openCard(r.id); session.editDetails(r.id, { ...detailsOf(r), gmNotes: { type: 'doc', content: [...markdownToDocument('# Старая тайна').content, { type: 'image', attrs: { assetId: original.assets[0].id, alt: 'План' } }] } }); await session.saveDetails()
    const saved = await snapshot(); const files = unzipSync(await buildArchive(saved))
    const document = JSON.parse(new TextDecoder().decode(files['project.json']))
    delete document.entities; delete document.markerPlacements
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    manifest.formatVersion = 4
    const entry = manifest.files.find((f: { path: string }) => f.path === 'project.json')
    entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json'])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const restored = await parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)
    expect(restored.regions).toEqual(saved.regions); expect(restored.entities).toEqual([]); expect(restored.markerPlacements).toEqual([])
    expect(restored.assets.map((a) => a.id)).toEqual(saved.assets.map((a) => a.id))
  })
  it('rejects invalid statuses, foreign region bindings and missing entity/image references in archives', async () => {
    const { session, snapshot } = await setup(); await area(session); await add(session, 'door')
    const saved = await snapshot()
    for (const invalid of [
      { ...saved, entities: [{ ...saved.entities[0], status: 'defeated' }] },
      { ...saved, markerPlacements: [{ ...saved.markerPlacements[0], entityId: 'missing' }] },
      { ...saved, markerPlacements: [{ ...saved.markerPlacements[0], mapId: saved.maps[1].id, regionIds: [saved.regions[0].id] }] },
      { ...saved, entities: [{ ...saved.entities[0], description: { type: 'doc' as const, content: [{ type: 'image', attrs: { assetId: 'missing', alt: '' } }] } }] },
    ]) await expect(buildArchive(invalid)).rejects.toThrow()
  })
})
