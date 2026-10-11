import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { RegionSession, detailsOf } from './regionSession'
import { ProjectSession } from './projectSession'
import { MapImageSession } from './mapImageSession'
import { NavigationSession } from './navigationSession'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbModeRepository } from '../storage/indexedDbModeRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { IndexedDbNavigationRepository } from '../storage/indexedDbNavigationRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { IndexedDb, requestResult } from '../storage/indexedDb'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive } from '../storage/backup/archive'
import { independentCopy } from './projectBackupRepository'
import { emptyRegionContent } from '../domain/region'
import type { Region } from '../domain/region'
import { markdownToDocument } from '../storage/migrateRegionText'
import type { WorkspaceMode } from '../domain/workspaceMode'

async function setup() {
  const factory = new IDBFactory()
  const backups = new IndexedDbProjectBackupRepository(() => factory)
  const original = await testSnapshot()
  const r: Region = { ...emptyRegionContent(), id: 'r1', mapId: original.maps[0].id, number: 1, title: 'Зал', titleCustomized: true, order: 0, color: '#d7ad62', fillOpacity: .4, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
  original.regions = [r, { ...r, id: 'empty', number: 2, title: 'Область 2', titleCustomized: false }]
  original.entities = [0, 1].map((n) => ({ id: `e${n}`, projectId: original.project.id, kind: 'enemy', name: `Страж ${n}`, description: { type: 'doc', content: [{ type: 'image', attrs: { assetId: original.assets[0].id, alt: 'Портрет' } }] }, status: 'alive', tags: ['бой'] }))
  original.markerPlacements = [0, 1].map((n) => ({ id: `m${n}`, entityId: `e${n}`, mapId: r.mapId, x: 20 + n * 20, y: 5, regionIds: [r.id], color: '#d7ad62', locked: false, order: n }))
  original.markerPlacements.push({ ...original.markerPlacements[0], id: 'shared', mapId: original.maps[1].id, regionIds: [] })
  await backups.insertCopy(original)
  const projects = new ProjectSession(new IndexedDbProjectRepository(() => factory)); await projects.initialize()
  const repo = new IndexedDbRegionRepository(() => factory)
  const modes = new IndexedDbModeRepository(() => factory)
  const session = new RegionSession(repo, projects, modes)
  await session.loadMode(original.project.id); await session.load(r.mapId)
  const snapshot = () => backups.snapshot(original.project.id)
  return { factory, backups, projects, repo, modes, session, snapshot, original, r }
}
async function mode(session: RegionSession, value: WorkspaceMode) {
  session.requestMode(value)
  await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ mode: value, modePhase: 'saved' }))
}
function failPut(store: string) {
  const put = IDBObjectStore.prototype.put
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === store) throw new DOMException('Нет места', 'QuotaExceededError')
    return put.apply(this, args)
  })
}

describe('BM-009 play mode', () => {
  it('defaults old/new/imported projects to preparation, persists mode per project outside project revisions and ZIP', async () => {
    const { session, snapshot, original, modes, backups } = await setup()
    const before = await snapshot(); await mode(session, 'play')
    expect(await snapshot()).toEqual(before)
    expect(await modes.load(original.project.id)).toBe('play')
    const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(await snapshot()))]), testDecode)
    const copy = independentCopy(parsed); await backups.insertCopy(copy)
    expect(await modes.load(copy.project.id)).toBe('prepare')
    await modes.save(copy.project.id, 'prepare')
    expect(await modes.load(original.project.id)).toBe('play')
    await session.loadMode(original.project.id); expect(session.getSnapshot().mode).toBe('play')
    await expect(modes.save('missing', 'play')).rejects.toThrow()
  })
  it('keeps dirty text and selection on Stay or failed Save; Save and Discard switch only after confirmation', async () => {
    const { session, r, snapshot } = await setup()
    session.openCard(r.id, true); session.beginEdit()
    const focus = session.getSnapshot().viewFocus
    session.editDetails(r.id, { ...detailsOf(r), title: 'Черновик', gmNotes: markdownToDocument('Не потерять') })
    session.requestMode('play'); expect(session.getSnapshot().pendingIntent).toEqual({ kind: 'mode', mode: 'play' })
    await session.resolveCardIntent('stay')
    expect(session.getSnapshot().details[r.id].fields.title).toBe('Черновик')
    session.requestMode('play')
    const spy = failPut('projects')
    try { await session.resolveCardIntent('save') } finally { spy.mockRestore() }
    expect(session.getSnapshot()).toMatchObject({ mode: 'prepare', cardId: r.id, details: { [r.id]: { phase: 'error', fields: { title: 'Черновик' } } } })
    expect((await snapshot()).regions.find((v) => v.id === r.id)?.title).toBe('Зал')
    await session.resolveCardIntent('save')
    expect(session.getSnapshot()).toMatchObject({ mode: 'play', cardMode: 'view', selectedId: r.id, cardId: r.id, details: {} })
    expect(session.getSnapshot().viewFocus).toBe(focus)
    expect((await snapshot()).regions.find((v) => v.id === r.id)?.title).toBe('Черновик')
    await mode(session, 'prepare'); session.beginEdit()
    session.editDetails(r.id, { ...session.getSnapshot().details[r.id].fields, title: 'Отбросить' })
    session.requestMode('play'); await session.resolveCardIntent('discard')
    expect(session.getSnapshot().details).toEqual({})
    expect((await snapshot()).regions.find((v) => v.id === r.id)?.title).toBe('Черновик')
  })
  it('does not discard drafts or activate the destination when the UI-setting write fails, and allows retry', async () => {
    const { session, modes, r, original, repo, projects } = await setup()
    session.openCard(r.id); session.beginEdit(); session.editDetails(r.id, { ...detailsOf(r), title: 'Целый черновик' })
    session.requestMode('play')
    const spy = failPut('settings')
    try { await session.resolveCardIntent('discard') } finally { spy.mockRestore() }
    expect(session.getSnapshot()).toMatchObject({ mode: 'prepare', modePhase: 'error', cardMode: 'edit', details: { [r.id]: { fields: { title: 'Целый черновик' } } } })
    expect(await modes.load(original.project.id)).toBe('prepare')
    session.retryMode(); await session.resolveCardIntent('discard')
    expect(session.getSnapshot()).toMatchObject({ mode: 'play', modePhase: 'saved', details: {} })
    await mode(session, 'prepare')
    const broken = new RegionSession(repo, projects, { load: async () => { throw new Error('Нет доступа') }, save: modes.save.bind(modes) })
    await broken.loadMode(original.project.id)
    expect(broken.getSnapshot()).toMatchObject({ mode: 'play', modePhase: 'error' }); expect(broken.isPreparation()).toBe(false)
  })
  it('cancels unfinished geometry/vertex tools and keeps empty cards in view, with editing restored on return', async () => {
    const { session, snapshot, r } = await setup(); const before = await snapshot()
    session.start({ x: 2, y: 3 }); session.addPoint({ x: 10, y: 3 })
    await mode(session, 'play'); expect(session.getSnapshot().draft).toBeUndefined()
    expect(await snapshot()).toEqual(before)
    session.openCard('empty'); expect(session.getSnapshot()).toMatchObject({ cardMode: 'view', details: {} })
    await mode(session, 'prepare'); session.beginEdit(); expect(session.getSnapshot().cardMode).toBe('edit')
    session.cancelEdit(); session.closeCard(); session.openCard(r.id); session.setVertexMode(true)
    await mode(session, 'play'); expect(session.getSnapshot().vertexMode).toBe(false)
    await mode(session, 'prepare'); session.startMarker('door')
    await mode(session, 'play'); expect(session.getSnapshot().markerTool).toBeUndefined()
  })
  it('does not persist a cancelled new marker, and saves a confirmed draft with its final position before entering play', async () => {
    const { session, snapshot } = await setup(); const before = await snapshot()
    session.startMarker('enemy'); session.placeMarker({ x: 5, y: 5 })
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, name: 'Новый' })
    session.requestMode('play'); await session.resolveCardIntent('stay')
    expect(session.getSnapshot().markerDraft?.fields.name).toBe('Новый')
    session.requestMode('play'); await session.resolveCardIntent('discard')
    expect(await snapshot()).toEqual(before); expect(session.getSnapshot().markerCardId).toBeUndefined()
    await mode(session, 'prepare'); session.startMarker('enemy'); session.placeMarker({ x: 5, y: 5 })
    const id = session.getSnapshot().markerDraft!.marker.id
    session.moveMarkerDraft(id, { x: 9, y: 11 }); session.requestMode('play'); await session.resolveCardIntent('save')
    expect(session.getSnapshot()).toMatchObject({ mode: 'play', markerCardId: id, selectedMarkerId: id, cardMode: 'view' })
    expect((await snapshot()).markerPlacements.find((m) => m.id === id)).toMatchObject({ x: 9, y: 11 })
  })
  it('rejects direct geometry/content/background/map commands in play while retaining read/navigation commands', async () => {
    const { session, projects, factory, snapshot, original, r } = await setup()
    await session.moveMarker('m0', { x: 99, y: 10 }); await session.undo()
    await mode(session, 'play'); const before = await snapshot()
    session.start(); session.addPoint({ x: 2, y: 2 }); await session.finish()
    session.openCard(r.id); session.setVertexMode(true); session.beginEdit(); session.editDetails(r.id, { ...detailsOf(r), color: '#ffffff', title: 'Нельзя' }); await session.saveDetails()
    await session.change({ ...r, vertices: r.vertices.map((p) => ({ x: p.x + 5, y: p.y })) }); await session.removeVertex(0); await session.remove(); await session.undo(); await session.redo()
    session.startMarker('enemy'); session.placeMarker({ x: 0, y: 0 }); session.openMarkerCard('m0'); session.beginMarkerEdit()
    await session.moveMarker('m0', { x: 99, y: 99 }); await session.removeMarker('m0')
    session.beginImageInsertion(); expect(session.getSnapshot().imagePending).toBe(0)
    const maps = new MapImageSession(new IndexedDbMapImageRepository(() => factory), projects, testDecode, session.isPreparation)
    await maps.load(original.project.id); await maps.remove(); await maps.upload(original.assets[0].blob)
    const navigation = new NavigationSession(new IndexedDbNavigationRepository(() => factory), projects, session.isPreparation)
    expect(await navigation.createMap('Нельзя')).toBeUndefined()
    expect(await navigation.renameMap(r.mapId, 'Нельзя')).toBe(false); expect(await navigation.deleteMap(r.mapId)).toBe(false)
    await navigation.load(); expect(navigation.getSnapshot().data.maps).toHaveLength(3)
    expect(await session.readMap(original.maps[1].id)).toHaveProperty('markers')
    expect(await snapshot()).toEqual(before)
    expect(session.getSnapshot()).toMatchObject({ draft: undefined, markerTool: undefined, markerDraft: undefined, details: {}, vertexMode: false })
    await mode(session, 'prepare'); await session.moveMarker('m0', { x: 99, y: 99 })
    expect((await snapshot()).markerPlacements.find((m) => m.id === 'm0')).toMatchObject({ x: 99, y: 99 })
  })
  it('persists only the entity status after confirmed writes, retaining independent enemies, images and all placements', async () => {
    const { session, repo, snapshot, r } = await setup()
    session.openMarkerCard('m0', true); const focus = session.getSnapshot().viewFocus
    await session.moveMarker('m0', { x: 99, y: 10 }); await mode(session, 'play')
    const before = await snapshot()
    let release!: () => void
    const saved = repo.saveStatus.bind(repo)
    const spy = vi.spyOn(repo, 'saveStatus').mockImplementation(async (...args) => { await new Promise<void>((resolve) => { release = resolve }); return saved(...args) })
    const work = session.changeStatus('e0', 'defeated')
    expect(session.getSnapshot().statusAction?.phase).toBe('saving')
    expect(session.getSnapshot().entities.find((e) => e.id === 'e0')?.status).toBe('alive')
    expect(await snapshot()).toEqual(before)
    session.requestMode('prepare'); session.closeCard(); await session.undoStatus()
    expect(session.getSnapshot().markerCardId).toBe('m0')
    release(); await work; spy.mockRestore()
    const after = await snapshot()
    expect(after.entities.find((e) => e.id === 'e0')?.status).toBe('defeated')
    expect(after.entities.find((e) => e.id === 'e1')?.status).toBe('alive')
    for (const key of ['maps', 'assets', 'regions', 'markerPlacements', 'imagePlacements'] as const) expect(after[key]).toEqual(before[key])
    expect(session.getSnapshot().viewFocus).toBe(focus)
    expect(after.entities[0].description).toEqual(before.entities[0].description)
    await session.undo(); expect((await snapshot()).markerPlacements).toEqual(before.markerPlacements)
    await session.undoStatus(); expect((await snapshot()).entities.find((e) => e.id === 'e0')?.status).toBe('alive')
    await session.redoStatus(); expect((await snapshot()).entities.find((e) => e.id === 'e0')?.status).toBe('defeated')
    await session.load('map-1'); expect(session.getSnapshot().entities.find((e) => e.id === 'e0')?.status).toBe('defeated')
    await session.undoStatus(); expect((await snapshot()).entities.find((e) => e.id === 'e0')?.status).toBe('alive')
    await session.load(r.mapId); await mode(session, 'prepare'); session.beginMarkerEdit()
    expect(session.getSnapshot().canRedoStatus).toBe(true)
  })
  it('rolls back late status-write/undo failures, exposes retry and does not mark unconfirmed statuses saved', async () => {
    const { session, snapshot } = await setup(); await mode(session, 'play')
    const before = await snapshot(); const spy = failPut('projects')
    try { await session.changeStatus('e0', 'hidden') } finally { spy.mockRestore() }
    expect(await snapshot()).toEqual(before)
    expect(session.getSnapshot()).toMatchObject({ statusAction: { phase: 'error', after: 'hidden' }, canUndoStatus: false })
    expect(session.getSnapshot().entities.find((e) => e.id === 'e0')?.status).toBe('alive')
    await session.retryStatus(); expect(session.getSnapshot()).toMatchObject({ statusAction: { phase: 'saved' }, canUndoStatus: true })
    const saved = await snapshot(); const undoFailure = failPut('projects')
    try { await session.undoStatus() } finally { undoFailure.mockRestore() }
    expect(await snapshot()).toEqual(saved); expect(session.getSnapshot().canUndoStatus).toBe(true)
    await session.retryStatus(); expect((await snapshot()).entities.find((e) => e.id === 'e0')?.status).toBe('alive')
    expect(session.getSnapshot()).toMatchObject({ canUndoStatus: false, canRedoStatus: true })
  })
  it('validates status type, entity ownership, expected status and revision without damaging stored data', async () => {
    const { repo, original, snapshot, backups } = await setup(); const before = await snapshot()
    const copy = independentCopy(before); await backups.insertCopy(copy)
    await expect(repo.saveStatus(before.project, copy.entities[0].id, 'alive', 'hidden')).rejects.toThrow('Сущность не найдена')
    expect(await snapshot()).toEqual(before)
    for (const [entityId, expected, status] of [['e0', 'alive', 'open'], ['missing', 'alive', 'hidden'], ['e0', 'hidden', 'defeated']]) {
      await expect(repo.saveStatus(before.project, entityId, expected, status)).rejects.toThrow()
      expect(await snapshot()).toEqual(before)
    }
    await expect(repo.saveStatus({ ...original.project, revision: 0 }, 'e0', 'alive', 'hidden')).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })
  it('keeps geometric and entity histories separate; status undo merges with later content edits and invalidates explicit preparation status edits', async () => {
    const { session, snapshot } = await setup()
    await session.moveMarker('m0', { x: 99, y: 10 })
    await mode(session, 'play'); await session.changeStatus('e0', 'hidden')
    await mode(session, 'prepare'); session.openMarkerCard('m0'); session.beginMarkerEdit()
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, name: 'Новое имя' }); await session.saveMarkerDetails()
    await session.undoStatus()
    expect((await snapshot()).entities.find((e) => e.id === 'e0')).toMatchObject({ name: 'Новое имя', status: 'alive' })
    await session.redoStatus(); await session.undo()
    expect((await snapshot()).markerPlacements.find((m) => m.id === 'm0')).toMatchObject({ x: 20, y: 5 })
    expect((await snapshot()).entities.find((e) => e.id === 'e0')).toMatchObject({ name: 'Новое имя', status: 'hidden' })
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, status: 'defeated' }); await session.saveMarkerDetails()
    expect(session.getSnapshot().canUndoStatus).toBe(false); expect(session.getSnapshot().statusAction).toBeUndefined(); await session.undoStatus()
    expect((await snapshot()).entities.find((e) => e.id === 'e0')?.status).toBe('defeated')
  })
  it('restores statuses and images in independent ZIP copies, with play settings and undo history excluded', async () => {
    const { session, snapshot, modes, backups, original } = await setup()
    await mode(session, 'play'); await session.changeStatus('e0', 'defeated')
    const saved = await snapshot(); const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(saved))]), testDecode)
    expect(parsed.entities).toEqual(saved.entities); expect(parsed.markerPlacements).toEqual(saved.markerPlacements)
    const copy = independentCopy(parsed); await backups.insertCopy(copy)
    expect(copy.entities.find((e) => e.name === 'Страж 0')?.status).toBe('defeated')
    expect(copy.entities[0].description.content[0].attrs!.assetId).toBe(copy.assets[0].id)
    expect(copy.markerPlacements.filter((m) => m.entityId === copy.entities[0].id)).toHaveLength(2)
    expect(await modes.load(copy.project.id)).toBe('prepare')
    await session.loadMode(original.project.id); await session.load(original.maps[0].id)
    expect(session.getSnapshot()).toMatchObject({ mode: 'play', canUndoStatus: false, cardId: undefined, markerCardId: undefined })
    expect(session.getSnapshot().entities.find((e) => e.id === 'e0')?.status).toBe('defeated')
  })
  it('waits for the mode transaction, blocking concurrent commands and duplicate confirmation without losing drafts', async () => {
    const { session, modes, r } = await setup()
    let release!: () => void
    const save = modes.save.bind(modes)
    vi.spyOn(modes, 'save').mockImplementation(async (...args) => { await new Promise<void>((resolve) => { release = resolve }); return save(...args) })
    session.openCard(r.id); session.beginEdit(); session.editDetails(r.id, { ...detailsOf(r), title: 'Черновик' }); session.requestMode('play')
    const work = session.resolveCardIntent('discard')
    expect(session.getSnapshot()).toMatchObject({ mode: 'prepare', modePhase: 'saving', cardMode: 'edit' })
    session.closeCard(); await session.resolveCardIntent('stay'); session.startMarker('enemy')
    expect(session.getSnapshot().pendingIntent).toEqual({ kind: 'mode', mode: 'play' })
    expect(session.getSnapshot().details[r.id].fields.title).toBe('Черновик')
    release(); await work; expect(session.getSnapshot()).toMatchObject({ mode: 'play', details: {}, pendingIntent: undefined })
  })
  it('migrates absent settings without changing IndexedDB/Project/ZIP versions, rejects corrupt mode settings', async () => {
    const { factory, original, modes, session } = await setup()
    const db = new IndexedDb(() => factory)
    await db.transaction(['settings'], 'readwrite', async (tx) => { await requestResult(tx.objectStore('settings').put('unknown', `workspaceMode:${original.project.id}`)) })
    await expect(modes.load(original.project.id)).rejects.toThrow('Некорректная')
    await session.loadMode(original.project.id); expect(session.getSnapshot()).toMatchObject({ mode: 'play', modePhase: 'error' })
    await modes.save(original.project.id, 'prepare'); session.retryMode()
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ mode: 'prepare', modePhase: 'saved' }))
  })
})
