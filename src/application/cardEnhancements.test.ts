import { legacyTestMetadata } from '../storage/backup/legacyTestMetadata'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { unzipSync, zipSync } from 'fflate'
import { ProjectSession } from './projectSession'
import { RegionSession, detailsOf } from './regionSession'
import type { ProjectSnapshot } from './projectBackupRepository'
import { independentCopy } from './projectBackupRepository'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { IndexedDbModeRepository } from '../storage/indexedDbModeRepository'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive, sha256 } from '../storage/backup/archive'
import { DATABASE_NAME, requestResult } from '../storage/indexedDb'
import { statusBadge, validateEntity } from '../domain/marker'

async function setup() {
  const factory = new IDBFactory(); const backups = new IndexedDbProjectBackupRepository(() => factory)
  const original = await testSnapshot(); await backups.insertCopy(original)
  const projects = new ProjectSession(new IndexedDbProjectRepository(() => factory)); await projects.initialize()
  const repository = new IndexedDbRegionRepository(() => factory)
  const session = new RegionSession(repository, projects, new IndexedDbModeRepository(() => factory)); await session.load(original.maps[0].id)
  return { factory, original, backups, repository, session, snapshot: () => backups.snapshot(original.project.id) }
}
async function area(session: RegionSession) {
  session.start(); [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }].forEach(session.addPoint)
  await session.finish(); return session.getSnapshot().regions.at(-1)!
}
async function seedV7(factory: IDBFactory, original: ProjectSnapshot) {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = factory.open(DATABASE_NAME, 7); request.onupgradeneeded = () => {
      const db = request.result; db.createObjectStore('settings'); db.createObjectStore('projects', { keyPath: 'id' })
      for (const name of ['maps', 'assets', 'entities']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('projectId', 'projectId')
      for (const name of ['regions', 'markerPlacements', 'imagePlacements']) db.createObjectStore(name, { keyPath: 'id' }).createIndex('mapId', 'mapId', { unique: name === 'imagePlacements' })
      request.transaction!.objectStore('markerPlacements').createIndex('entityId', 'entityId')
    }; request.onsuccess = () => resolve(request.result) })
    const legacy = structuredClone(original); legacyTestMetadata(legacy as unknown as Record<string, unknown>)
    const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite'); tx.objectStore('projects').add(legacy.project)
    for (const name of ['maps', 'regions', 'entities', 'imagePlacements', 'markerPlacements'] as const) for (const value of legacy[name]) { const row = { ...value } as Record<string, unknown>; if (name === 'regions') delete row.shortDescription; if (name === 'entities') delete row.checks; tx.objectStore(name).add(row) }
    original.assets.forEach((asset) => tx.objectStore('assets').add(asset)); await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() }); db.close()
}
const check = { id: 'detect', condition: 'Обнаружить', ability: 'Внимательность', dc: '15', result: 'Тайное пояснение' }
async function trap(session: RegionSession) {
  session.startMarker('trap'); session.placeMarker({ x: 25, y: 25 })
  session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, checks: [check] }); await session.saveMarkerDetails()
  return session.getSnapshot().markers.at(-1)!
}
describe('UI-02 persisted card content', () => {
  it('saves short description with the whole draft; cancels and treats short description alone as filled content', async () => {
    const { session, repository, snapshot } = await setup(); const r = await area(session)
    session.openCard(r.id); session.editDetails(r.id, { ...detailsOf(r), shortDescription: 'Кратко\nВторая строка' })
    session.closeCard(); expect(session.getSnapshot().pendingIntent).toBeDefined()
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('Нет места'))
    await session.resolveCardIntent('save'); expect((await snapshot()).regions[0].shortDescription).toBe('')
    expect(session.getSnapshot().details[r.id].fields.shortDescription).toBe('Кратко\nВторая строка')
    await session.resolveCardIntent('save'); session.openCard(r.id); expect(session.getSnapshot().cardMode).toBe('view')
    session.beginEdit(); session.editDetails(r.id, { ...session.getSnapshot().details[r.id].fields, shortDescription: 'Отбросить' }); session.cancelEdit()
    expect((await snapshot()).regions[0].shortDescription).toBe('Кратко\nВторая строка')
  })
  it('retains invalid DC and check text in new draft, never writes partial entities, retries a failed save and cancels edits', async () => {
    const { session, repository, snapshot } = await setup()
    session.startMarker('trap'); session.placeMarker({ x: 1, y: 2 }); const draft = session.getSnapshot().markerDraft!
    for (const dc of ['', '0', '-2', '1.5', 'abc', 'Infinity', '9007199254740992']) {
      session.editMarkerDetails({ ...draft.fields, checks: [{ ...check, dc }] }); await session.saveMarkerDetails()
      expect(session.getSnapshot().markerDraft).toMatchObject({ phase: 'error', fields: { checks: [{ dc }] } })
      expect((await snapshot()).entities).toEqual([])
    }
    session.editMarkerDetails({ ...draft.fields, checks: [{ ...check, condition: ' ' }] }); await session.saveMarkerDetails()
    expect(session.getSnapshot().markerDraft!.error).toContain('назначение')
    session.editMarkerDetails({ ...draft.fields, checks: [check] })
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('Нет места')); await session.saveMarkerDetails()
    expect((await snapshot()).markerPlacements).toEqual([]); expect(session.getSnapshot().markerDraft!.fields.checks).toEqual([check])
    await session.saveMarkerDetails(); const saved = await snapshot()
    expect(saved.entities[0]).toMatchObject({ kind: 'trap', status: 'armed', checks: [{ ...check, dc: 15 }] })
    session.beginMarkerEdit(); session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, checks: [] }); session.cancelMarkerEdit()
    expect((await snapshot()).entities).toEqual(saved.entities)
    session.closeCard(); session.startMarker('trap'); session.placeMarker({ x: 5, y: 5 }); session.cancelMarkerEdit()
    expect((await snapshot()).entities).toEqual(saved.entities)
  })
  it('allows only trap statuses and saves/undoes them in play without changing checks', async () => {
    const { session, snapshot } = await setup(); const marker = await trap(session); const entity = (await snapshot()).entities[0]
    expect(statusBadge('armed')).not.toBe(statusBadge('disarmed'))
    expect(() => validateEntity({ ...entity, status: 'hidden' })).toThrow()
    session.requestMode('play'); await vi.waitFor(() => expect(session.getSnapshot().mode).toBe('play'))
    await session.changeStatus(marker.entityId, 'disarmed'); expect((await snapshot()).entities[0].status).toBe('disarmed')
    await session.undoStatus(); expect((await snapshot()).entities[0]).toMatchObject({ status: 'armed', checks: entity.checks })
    await session.redoStatus(); expect((await snapshot()).entities[0].status).toBe('disarmed')
    session.beginMarkerEdit(); expect(session.getSnapshot().markerDraft).toBeUndefined()
  })
  it('round-trips rich images, descriptions, checks and multiple bindings with independent IDs', async () => {
    const { session, backups, snapshot } = await setup(); const a = await area(session); const b = await area(session)
    session.openCard(a.id); session.editDetails(a.id, { ...detailsOf(a), shortDescription: 'Краткое описание' }); await session.saveDetails(); session.closeCard()
    await trap(session); session.beginMarkerEdit()
    const before = await snapshot(); const description = { type: 'doc' as const, content: [{ type: 'image', attrs: { assetId: before.assets[0].id, alt: 'Схема' } }] }
    session.editMarkerDetails({ ...session.getSnapshot().markerDraft!.fields, regionIds: [a.id, b.id], description }); await session.saveMarkerDetails()
    const original = await snapshot(); const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(original))]), testDecode)
    expect(parsed).toEqual(original); const copy = independentCopy(parsed); await backups.insertCopy(copy)
    expect(copy.regions.find((r) => r.number === a.number)!.shortDescription).toBe('Краткое описание'); expect(copy.entities[0].checks[0]).toMatchObject({ condition: check.condition, dc: 15 })
    expect(copy.entities[0].checks[0].id).not.toBe(check.id)
    expect(new Set(copy.markerPlacements[0].regionIds)).toEqual(new Set(copy.regions.map((r) => r.id)))
    expect(copy.entities[0].description.content[0].attrs!.assetId).toBe(copy.assets[0].id)
    copy.entities[0].checks[0].result = 'Изменено'; expect(original.entities[0].checks[0].result).toBe(check.result)
    expect(await snapshot()).toEqual(original)
  })
  it('migrates a real ZIP v6 and DB v7 without copying secret notes or changing existing data', async () => {
    const { session, snapshot } = await setup(); const r = await area(session); session.openCard(r.id)
    const oldContent = { ...detailsOf(r), gmNotes: { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Секрет' }] }] } }
    session.editDetails(r.id, oldContent); await session.saveDetails(); session.closeCard(); session.startMarker('enemy'); session.placeMarker({ x: 10, y: 20 }); await session.saveMarkerDetails()
    const original = await snapshot(); const files = unzipSync(await buildArchive(original))
    const doc = JSON.parse(new TextDecoder().decode(files['project.json']))
    legacyTestMetadata(doc)
    for (const r of doc.regions) delete r.shortDescription; for (const e of doc.entities) delete e.checks
    files['project.json'] = new TextEncoder().encode(JSON.stringify(doc)); const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])); manifest.formatVersion = 6
    const entry = manifest.files.find((f: { path: string }) => f.path === 'project.json'); entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json']); files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    expect(await parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)).toEqual(original)
    const factory = new IDBFactory()
    await seedV7(factory, original)
    expect(await new IndexedDbProjectBackupRepository(() => factory).snapshot(original.project.id)).toEqual(original)
    const upgraded = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME); r.onsuccess = () => resolve(r.result) }); expect(upgraded.version).toBe(9)
    expect((await requestResult(upgraded.transaction('regions').objectStore('regions').get(r.id))).shortDescription).toBe(''); upgraded.close()
  })
  it('rolls back a v7 upgrade when an entity is invalid, retaining original region rows and version', async () => {
    const { session, snapshot } = await setup(); await area(session); session.startMarker('enemy'); session.placeMarker({ x: 5, y: 5 }); await session.saveMarkerDetails()
    const old = await snapshot(); old.entities[0].name = ''; const factory = new IDBFactory(); await seedV7(factory, old)
    await expect(new IndexedDbProjectBackupRepository(() => factory).snapshot(old.project.id)).rejects.toThrow('перенести сущности')
    const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME); r.onsuccess = () => resolve(r.result) })
    expect(db.version).toBe(7); const tx = db.transaction(['regions', 'entities', 'projects'])
    const region = await requestResult(tx.objectStore('regions').get(old.regions[0].id))
    expect(region).not.toHaveProperty('shortDescription'); expect(region.gmNotes).toEqual(old.regions[0].gmNotes)
    const legacy = structuredClone(old); legacyTestMetadata(legacy as unknown as Record<string, unknown>)
    expect(await requestResult(tx.objectStore('projects').get(old.project.id))).toEqual(legacy.project)
    expect(await requestResult(tx.objectStore('entities').get(old.entities[0].id))).not.toHaveProperty('checks'); db.close()
  })
})
