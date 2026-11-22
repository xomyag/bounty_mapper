import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { availableCopyName, markerCopyPosition } from '../domain/copy'
import { createProject } from '../domain/project'
import { emptyRegionContent } from '../domain/region'
import { documentAssetIds, emptyDocument } from '../domain/richText'
import { markerTypes } from '../domain/marker'
import type { MarkerKind } from '../domain/marker'
import { independentCopy } from './projectBackupRepository'
import type { ProjectSnapshot } from './projectBackupRepository'
import { excludedLevelLinks, levelSubset, LevelImportSession } from './levelImport'
import { RegionSession } from './regionSession'
import { ProjectSession } from './projectSession'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbNavigationRepository } from '../storage/indexedDbNavigationRepository'
import { IndexedDbModeRepository } from '../storage/indexedDbModeRepository'
import { IndexedDb, requestResult } from '../storage/indexedDb'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive } from '../storage/backup/archive'
import { documentFromSnapshot, validateDocument } from '../storage/backup/document'

async function sourceFixture() {
  const source = await testSnapshot()
  const imageDoc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'map-1 unchanged', marks: [{ type: 'link', attrs: { href: 'https://example.com/map-1' } }] }] }, { type: 'image', attrs: { assetId: source.assets[1].id, alt: 'Original picture' } }] }
  source.maps[0].name = 'Level 8'; source.maps[0].description = imageDoc
  source.assets.push({ ...source.assets[0], id: 'unused-context-image' })
  source.project.context = { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'unused-context-image', alt: 'Context only' } }] }
  source.regions = ['r1', 'r2'].map((id, i) => ({ ...emptyRegionContent(), id, mapId: source.maps[0].id, vertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }], number: i+1, title: id, titleCustomized: true, order: i, color: '#abcdef', fillOpacity: .4, gmNotes: imageDoc, tags: ['shared'] }))
  source.entities = [{ id: 'shared-trap', projectId: source.project.id, name: 'Trap', kind: 'trap', status: 'disarmed', tags: ['shared'], description: imageDoc, checks: [{ id: 'c1', condition: 'Find', ability: 'Perception', dc: 15, result: 'Visible' }] }]
  source.markerPlacements = [0, 1, 2].map((n) => ({ id: `m${n}`, mapId: source.maps[n === 2 ? 1 : 0].id, entityId: 'shared-trap', x: 20+n*50, y: 40, color: '#aabbcc', regionIds: n === 2 ? [] : ['r1', 'r2'], locked: true, order: n }))
  return source
}
async function batchFixture() {
  const source = await sourceFixture()
  const [first, second, third] = source.maps
  first.name = ' Level 8 '; second.name = 'level 8'; third.name = 'LEVEL 8 Copy'
  second.description = structuredClone(first.description)
  third.description = structuredClone(source.project.context)
  source.imagePlacements[0] = { ...source.imagePlacements[0], x: 17, y: -22 }
  source.imagePlacements[1] = { ...source.imagePlacements[1], assetId: source.assets[0].id, x: -42, y: 19 }
  source.regions.push({ ...structuredClone(source.regions[0]), id: 'r3', mapId: second.id })
  source.markerPlacements[2].regionIds = ['r3']
  source.markerPlacements.push({ ...source.markerPlacements[2], id: 'other-shared', mapId: third.id, regionIds: [] })
  source.entities.push({ ...structuredClone(source.entities[0]), id: 'third-only' })
  source.markerPlacements.push({ ...source.markerPlacements[3], id: 'other-only', entityId: 'third-only' })
  // Input array and selection order must not override the maps' saved order.
  source.maps.reverse()
  return source
}
async function setup(snapshot?: ProjectSnapshot) {
  const factory = new IDBFactory()
  const backups = new IndexedDbProjectBackupRepository(() => factory)
  const source = snapshot ?? await sourceFixture()
  await backups.insertCopy(source)
  const projects = new ProjectSession(new IndexedDbProjectRepository(() => factory)); await projects.initialize()
  const objects = new IndexedDbRegionRepository(() => factory)
  const regions = new RegionSession(objects, projects, new IndexedDbModeRepository(() => factory)); await regions.load(source.maps[0].id)
  return { factory, backups, source, projects, regions, images: new IndexedDbMapImageRepository(() => factory), objects }
}

describe('Level import, independent duplicates and image alignment', () => {
  it('resolves trimmed/case-insensitive names deterministically in both languages and offsets in screen space', () => {
    expect(availableCopyName('Level 8', [' level 8 ', 'LEVEL 8 COPY', 'Level 8 Copy 2'])).toBe('Level 8 Copy 3')
    expect(availableCopyName('Trap', [], true)).toBe('Trap Copy')
    expect(availableCopyName('x'.repeat(512), [], true)).toHaveLength(512)
    expect(markerCopyPosition({ x: 50, y: 20 }, { x: 10, y: 10, scale: 2 }, { x: 0, y: 0, width: 600, height: 500 })).toEqual({ x: 68, y: 38 })
    expect(markerCopyPosition({ x: 5000, y: 5000 }, { x: 0, y: 0, scale: 1 }, { x: 10, y: 20, width: 200, height: 100 })).toEqual({ x: 186, y: 96 })
  })
  it('imports only one complete level, remaps images/checks/bindings, retains shared entities and repeats independently', async () => {
    const { factory, backups, source, projects } = await setup()
    const target = await new IndexedDbProjectRepository(() => new IDBFactory()).save(createProject('Other'))
    // Use a different project inside the same database; its context is never replaced.
    await backups.insertCopy({ project: target, maps: [], assets: [], entities: [], regions: [], imagePlacements: [], markerPlacements: [] })
    const decoded = await parseArchive(new Blob([new Uint8Array(await buildArchive(source))]), testDecode)
    expect(excludedLevelLinks(decoded, source.maps[0].id)).toBe(1)
    const slice = levelSubset(decoded, source.maps[0].id)
    expect(slice.assets).toHaveLength(2); expect(slice.entities).toHaveLength(1)
    const first = await backups.insertLevels(target, independentCopy(slice, target.id))
    const again = await backups.insertLevels(first.project, independentCopy(slice, target.id))
    const third = await backups.insertLevels(again.project, independentCopy(slice, target.id))
    const result = await backups.snapshot(target.id)
    expect(result.project.context).toEqual(target.context)
    expect(result.maps.sort((a,b) => a.order-b.order).map((m) => m.name)).toEqual(['Level 8', 'Level 8 Copy', 'Level 8 Copy 2'])
    expect(result.regions).toHaveLength(6); expect(result.markerPlacements).toHaveLength(6); expect(result.entities).toHaveLength(3)
    for (const map of result.maps) expect(new Set(result.markerPlacements.filter((m) => m.mapId === map.id).map((m) => m.entityId)).size).toBe(1)
    for (const marker of result.markerPlacements) {
      expect(marker.regionIds).toHaveLength(2)
      expect(marker.regionIds.every((id) => result.regions.some((r) => r.id === id && r.mapId === marker.mapId))).toBe(true)
      expect(source.markerPlacements.some((m) => m.id === marker.id)).toBe(false)
    }
    const remapped = result.entities[0]
    expect(remapped.status).toBe('disarmed'); expect(remapped.checks[0]).toMatchObject({ dc: 15, condition: 'Find' })
    expect(remapped.checks[0].id).not.toBe('c1')
    expect(documentAssetIds(remapped.description).every((id) => result.assets.some((a) => a.id === id))).toBe(true)
    expect(JSON.stringify(remapped.description)).toContain('https://example.com/map-1')
    expect(result.imagePlacements[0]).toMatchObject({ x: source.imagePlacements[0].x, y: source.imagePlacements[0].y, rotation: 15 })
    expect(result.assets.some((a) => a.id === 'unused-context-image')).toBe(false)
    expect((await backups.snapshot(source.project.id))).toEqual(source)
    expect(projects.getSnapshot().project?.id).toBe(source.project.id)
    const roundTrip = independentCopy(await parseArchive(new Blob([new Uint8Array(await buildArchive(result))]), testDecode))
    await backups.insertCopy(roundTrip)
    expect(roundTrip.maps).toHaveLength(3); expect(roundTrip.entities).toHaveLength(3)
    expect(third.project.id).toBe(target.id)
    await new IndexedDbRegionRepository(() => factory).saveStatus(third.project, remapped.id, 'disarmed', 'armed')
    expect((await backups.snapshot(source.project.id)).entities[0].status).toBe('disarmed')
    expect((await backups.snapshot(target.id)).entities.find((e) => e.id === remapped.id)?.status).toBe('armed')
  })
  it('builds an ordered batch subset with shared entities/assets once and warns only about omitted placements', async () => {
    const source = await batchFixture()
    const decoded = await parseArchive(new Blob([new Uint8Array(await buildArchive(source))]), testDecode)
    const slice = levelSubset(decoded, ['map-1', 'map-0', 'map-0'])
    expect(slice.maps.map((map) => map.id)).toEqual(['map-0', 'map-1'])
    expect(slice.entities.map((entity) => entity.id)).toEqual(['shared-trap'])
    expect(slice.assets).toHaveLength(2)
    expect(slice.assets.some((asset) => asset.id === 'unused-context-image')).toBe(false)
    expect(slice.regions).toHaveLength(3); expect(slice.markerPlacements).toHaveLength(3)
    expect(excludedLevelLinks(decoded, ['map-0', 'map-1'])).toBe(1)
    expect(excludedLevelLinks(decoded, ['map-0', 'map-1', 'map-2'])).toBe(0)
    expect(excludedLevelLinks(decoded, [])).toBe(0)
    expect(() => levelSubset(decoded, [])).toThrow()
    expect(() => levelSubset(decoded, ['map-0', 'missing'])).toThrow()
  })
  it('keeps explicit confirmation and a one-map ZIP compatible with the batch workflow', async () => {
    const { backups, source, projects } = await setup()
    const archive = new Blob([new Uint8Array(await buildArchive(levelSubset(source, 'map-0')))])
    const importer = new LevelImportSession(projects, backups, () => true, (file) => parseArchive(file, testDecode))
    await importer.read(archive)
    expect(importer.getSnapshot()).toMatchObject({ phase: 'choosing', selectedIds: ['map-0'] })
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    const open = vi.fn(); await importer.confirm(async () => {}, open)
    expect(importer.getSnapshot()).toMatchObject({ phase: 'idle', importedCount: 1 })
    expect(open).toHaveBeenCalledTimes(1)
    expect((await backups.snapshot(source.project.id)).maps).toHaveLength(4)
  })
  it('previews batch names, prevents empty/repeated writes, preserves selection order and reports the saved count', async () => {
    const { backups, source, projects } = await setup(await batchFixture())
    const insert = vi.spyOn(backups, 'insertLevels')
    const importer = new LevelImportSession(projects, backups, () => true, async () => source)
    await importer.read(new Blob())
    expect(importer.getSnapshot().selectedIds).toEqual(['map-0', 'map-1', 'map-2'])
    expect(importer.choices().map((map) => map.finalName)).toEqual(['Level 8 Copy 2', 'level 8 Copy 3', 'LEVEL 8 Copy Copy'])
    const open = vi.fn(); const prepare = vi.fn(async () => {})
    importer.select([]); await importer.confirm(prepare, open)
    expect(prepare).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled()
    importer.select(['map-1', 'map-0', 'map-1'])
    expect(importer.getSnapshot().selectedIds).toEqual(['map-0', 'map-1'])
    expect(importer.choices().map((map) => map.finalName)).toEqual(['Level 8 Copy 2', 'level 8 Copy 3', undefined])
    let release!: () => void
    const saving = importer.confirm(() => new Promise<void>((resolve) => { release = resolve }), open)
    expect(importer.getSnapshot().phase).toBe('saving')
    importer.select([]); importer.cancel(); await importer.read(new Blob()); await importer.confirm(prepare, open)
    expect(importer.getSnapshot().selectedIds).toEqual(['map-0', 'map-1'])
    expect(insert).not.toHaveBeenCalled()
    release(); await saving
    expect(insert).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1)
    expect(importer.getSnapshot()).toMatchObject({ phase: 'idle', importedCount: 2 })
    const copy = open.mock.calls[0][0] as ProjectSnapshot
    expect(copy.maps.map((map) => map.name)).toEqual(['Level 8 Copy 2', 'level 8 Copy 3'])
    expect((await backups.snapshot(source.project.id)).maps).toHaveLength(5)
  })
  it('copies selected maps together with independent IDs, shared backgrounds/documents and cross-map entity links; repeats and archives safely', async () => {
    const { backups, source, factory } = await setup(await batchFixture())
    const sourceBefore = await backups.snapshot(source.project.id)
    const project = { ...createProject('Destination'), revision: 1 }
    const maps = [' level 8 ', 'LEVEL 8 COPY'].map((name, order) => ({ ...source.maps[0], id: `target-${order}`, projectId: project.id, name, description: emptyDocument(), order }))
    await backups.insertCopy({ project, maps, regions: [], entities: [], assets: [], imagePlacements: [], markerPlacements: [] })
    const subset = levelSubset(source, ['map-1', 'map-0'])
    const first = await backups.insertLevels(project, independentCopy(subset, project.id))
    expect(first.snapshot.maps.map((map) => [map.name, map.order])).toEqual([['Level 8 Copy 2', 2], ['level 8 Copy 3', 3]])
    expect(first.snapshot.entities).toHaveLength(1); expect(first.snapshot.assets).toHaveLength(2)
    const shared = first.snapshot.entities[0]
    expect(new Set(first.snapshot.markerPlacements.map((marker) => marker.entityId))).toEqual(new Set([shared.id]))
    expect(new Set(first.snapshot.markerPlacements.map((marker) => marker.mapId)).size).toBe(2)
    for (const marker of first.snapshot.markerPlacements) expect(marker.regionIds.every((id) => first.snapshot.regions.some((region) => region.id === id && region.mapId === marker.mapId))).toBe(true)
    expect(first.snapshot.imagePlacements.map((image) => [image.x, image.y])).toEqual([[17, -22], [-42, 19]])
    expect(new Set(first.snapshot.imagePlacements.map((image) => image.assetId)).size).toBe(1)
    expect(documentAssetIds(first.snapshot.maps[0].description)).toEqual(documentAssetIds(first.snapshot.maps[1].description))
    expect(documentAssetIds(shared.description)).toEqual(documentAssetIds(first.snapshot.maps[0].description))
    for (const asset of first.snapshot.assets) {
      expect(source.assets.some((original) => original.id === asset.id)).toBe(false)
      expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(new Uint8Array(await source.assets[0].blob.arrayBuffer()))
    }
    const again = await backups.insertLevels(first.project, independentCopy(subset, project.id))
    expect(again.snapshot.maps.map((map) => map.name)).toEqual(['Level 8 Copy 4', 'level 8 Copy 5'])
    expect(again.snapshot.entities[0].id).not.toBe(shared.id)
    expect(again.snapshot.assets.every((asset) => !first.snapshot.assets.some((old) => old.id === asset.id))).toBe(true)
    const result = await backups.snapshot(project.id)
    expect(result.project.context).toEqual(project.context); expect(result.maps).toHaveLength(6)
    expect(result.entities).toHaveLength(2); expect(result.assets).toHaveLength(4)
    expect(result.maps.some((map) => map.name.includes('Copy Copy'))).toBe(false)
    const restored = independentCopy(await parseArchive(new Blob([new Uint8Array(await buildArchive(result))]), testDecode))
    await backups.insertCopy(restored)
    expect(restored.maps).toHaveLength(6); expect(restored.entities).toHaveLength(2); expect(restored.assets).toHaveLength(4)
    for (const entity of restored.entities) expect(restored.markerPlacements.filter((marker) => marker.entityId === entity.id)).toHaveLength(3)
    await new IndexedDbRegionRepository(() => factory).saveStatus(again.project, shared.id, 'disarmed', 'armed')
    expect((await backups.snapshot(project.id)).entities.find((entity) => entity.id === shared.id)?.status).toBe('armed')
    expect((await backups.snapshot(project.id)).entities.find((entity) => entity.id === again.snapshot.entities[0].id)?.status).toBe('disarmed')
    expect(await backups.snapshot(source.project.id)).toEqual(sourceBefore)
  })
  it('does not write after preparation failure or silently change previewed names after a concurrent project edit', async () => {
    const { backups, source, projects } = await setup()
    const importer = new LevelImportSession(projects, backups, () => true, async () => source)
    const open = vi.fn(); await importer.read(new Blob())
    await importer.confirm(async () => { throw new Error('Decode failed') }, open)
    expect(importer.getSnapshot()).toMatchObject({ phase: 'error', error: 'Decode failed' })
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    projects.edit({ name: 'Changed project', context: source.project.context }); await projects.save()
    const before = await backups.snapshot(source.project.id)
    await importer.confirm(async () => {}, open)
    expect(importer.getSnapshot().phase).toBe('error'); expect(open).not.toHaveBeenCalled()
    expect(await backups.snapshot(source.project.id)).toEqual(before)
    importer.cancel(); await importer.read(new Blob()); await importer.confirm(async () => {}, open)
    expect(open).toHaveBeenCalledTimes(1)
  })
  it('rolls back a late write and keeps a retryable selected level without changing the project', async () => {
    const { backups, source, projects } = await setup()
    const importer = new LevelImportSession(projects, backups, () => true, async () => source)
    await importer.read(new Blob()); expect(importer.getSnapshot().phase).toBe('choosing')
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Test quota', 'QuotaExceededError'); return put.apply(this, args) })
    const open = vi.fn()
    await importer.confirm(async () => {}, open)
    expect(importer.getSnapshot()).toMatchObject({ phase: 'error', selectedIds: source.maps.map((map) => map.id) })
    expect(open).not.toHaveBeenCalled(); expect(projects.getSnapshot().project).toEqual(source.project)
    spy.mockRestore()
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    await importer.confirm(async () => {}, open)
    expect(open).toHaveBeenCalledTimes(1); expect(importer.getSnapshot().phase).toBe('idle')
    const after = await backups.snapshot(source.project.id)
    expect(after.maps).toHaveLength(6); expect(after.project.context).toEqual(source.project.context)
  })
  it('rejects invalid ZIP, cancels without writes and prevents duplicate validation/confirmation', async () => {
    const { backups, source, projects } = await setup()
    const invalid = new LevelImportSession(projects, backups, () => true)
    await invalid.read(new Blob(['broken'])); expect(invalid.getSnapshot().phase).toBe('error'); invalid.cancel()
    let release!: (value: typeof source) => void
    const decode = vi.fn(() => new Promise<typeof source>((resolve) => { release = resolve }))
    const importer = new LevelImportSession(projects, backups, () => true, decode)
    const reading = importer.read(new Blob()); await importer.read(new Blob()); expect(decode).toHaveBeenCalledTimes(1)
    release(source); await reading; importer.cancel()
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    const confirming = new LevelImportSession(projects, backups, () => true, async () => source)
    await confirming.read(new Blob())
    let proceed!: () => void
    const prepare = vi.fn(() => new Promise<void>((resolve) => { proceed = resolve }))
    const open = vi.fn(); const saving = confirming.confirm(prepare, open)
    await confirming.confirm(prepare, open); expect(prepare).toHaveBeenCalledTimes(1)
    proceed(); await saving; expect(open).toHaveBeenCalledTimes(1)
    expect((await backups.snapshot(source.project.id)).maps).toHaveLength(6)
  })
  it('duplicates a trap as a movable draft; cancel writes nothing, save makes documents/status independent and retains shared images', async () => {
    const { regions, backups, source, projects, factory } = await setup()
    regions.setMarkerCopyPosition(() => ({ x: 90, y: 90 }))
    regions.duplicateMarker('m0'); await vi.waitFor(() => expect(regions.busy()).toBe(false))
    const draft = regions.getSnapshot().markerDraft!
    expect(draft).toMatchObject({ isNew: true, fields: { name: 'Trap Copy', locked: false, status: 'disarmed', regionIds: ['r1', 'r2'] } })
    expect(draft.entity.id).not.toBe('shared-trap'); expect(draft.entity.description).not.toBe(source.entities[0].description)
    regions.moveMarkerDraft(draft.marker.id, { x: 110, y: 120 })
    expect(regions.getSnapshot().markerDraft!.marker).toMatchObject({ x: 110, y: 120 })
    regions.cancelMarkerEdit(); expect(await backups.snapshot(source.project.id)).toEqual(source)
    regions.duplicateMarker('m0'); await vi.waitFor(() => expect(regions.busy()).toBe(false))
    const copyId = regions.getSnapshot().markerDraft!.marker.id
    await regions.saveMarkerDetails()
    regions.beginMarkerEdit(); regions.editMarkerDetails({ description: emptyDocument(), status: 'armed' }); await regions.saveMarkerDetails()
    let after = await backups.snapshot(source.project.id)
    expect(after.entities.find((e) => e.id === 'shared-trap')).toEqual(source.entities[0])
    expect(after.entities.find((e) => e.id === after.markerPlacements.find((m) => m.id === copyId)!.entityId)?.status).toBe('armed')
    await regions.removeMarker(copyId)
    expect((await backups.snapshot(source.project.id)).assets).toHaveLength(3)
    // Delete a map containing a copy while a different map still uses the original entity/image.
    const nav = new IndexedDbNavigationRepository(() => factory)
    await nav.deleteMap(projects.getSnapshot().project!, source.maps[0].id)
    after = await backups.snapshot(source.project.id)
    expect(after.assets.some((a) => a.id === source.assets[1].id)).toBe(true)
    expect(after.entities.some((e) => e.id === 'shared-trap')).toBe(true)
  })
  it('alignment changes only background position, cancels, retries, guards transitions and survives ZIP/legacy zero offsets', async () => {
    const { regions, images, source, backups, projects, factory } = await setup()
    regions.setImageAligner(async (point) => { await projects.mutateProject(async (project) => (await images.align(project, source.maps[0].id, point)).project) })
    regions.startImageAlignment(source.imagePlacements[0]); await vi.waitFor(() => expect(regions.busy()).toBe(false))
    regions.moveImageAlignment({ x: -75, y: 99 }); expect(regions.ready()).toBe(false)
    regions.cancelImageAlignment(); expect(await backups.snapshot(source.project.id)).toEqual(source)
    regions.startImageAlignment(source.imagePlacements[0]); await vi.waitFor(() => expect(regions.busy()).toBe(false))
    regions.moveImageAlignment({ x: -75, y: 99 })
    const put = IDBObjectStore.prototype.put
    const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Test quota', 'QuotaExceededError'); return put.apply(this,args) })
    await regions.saveImageAlignment(); expect(regions.getSnapshot().imageAlignment).toMatchObject({ phase: 'error', x: -75, y: 99 })
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    fail.mockRestore(); await regions.saveImageAlignment()
    expect(regions.getSnapshot().imageAlignment).toBeUndefined()
    const changed = await backups.snapshot(source.project.id)
    expect(changed.regions).toEqual(source.regions); expect(changed.markerPlacements).toEqual(source.markerPlacements)
    expect((await images.load(source.project.id, source.maps[0].id)).background!.placement).toMatchObject({ x: -75, y: 99, width: 2, height: 2 })
    const decoded = await parseArchive(new Blob([new Uint8Array(await buildArchive(changed))]), testDecode)
    expect(levelSubset(decoded, source.maps[0].id).imagePlacements[0]).toMatchObject({ x: -75, y: 99 })
    const doc = documentFromSnapshot(source); delete (doc.imagePlacements[0] as Partial<typeof doc.imagePlacements[0]>).x; delete (doc.imagePlacements[0] as Partial<typeof doc.imagePlacements[0]>).y
    expect(validateDocument(doc).imagePlacements[0]).toMatchObject({ x: 0, y: 0 })
    const db = new IndexedDb(() => factory)
    await db.transaction(['imagePlacements'], 'readwrite', async (tx) => { const old = { ...source.imagePlacements[0] } as Partial<typeof source.imagePlacements[0]>; delete old.x; delete old.y; await requestResult(tx.objectStore('imagePlacements').put(old)) })
    expect((await images.load(source.project.id, source.maps[0].id)).background!.placement).toMatchObject({ x: 0, y: 0 })
    regions.startImageAlignment(changed.imagePlacements[0]); await vi.waitFor(() => expect(regions.busy()).toBe(false)); regions.moveImageAlignment({ x: 1, y: 2 })
    regions.requestMode('play'); expect(regions.getSnapshot().pendingIntent).toMatchObject({ kind: 'mode' }); await regions.resolveCardIntent('stay')
    expect(regions.getSnapshot().imageAlignment).toMatchObject({ x: 1, y: 2 })
    regions.requestMode('play'); await regions.resolveCardIntent('discard'); expect(regions.getSnapshot().mode).toBe('play')
    regions.startImageAlignment(changed.imagePlacements[0]); expect(regions.getSnapshot().imageAlignment).toBeUndefined()
  })
  it('duplicates every supported marker kind without changing its valid saved status', async () => {
    const { regions } = await setup()
    for (const kind of Object.keys(markerTypes) as MarkerKind[]) {
      regions.startMarker(kind); regions.placeMarker({x:30,y:40}); await regions.saveMarkerDetails()
      const id = regions.getSnapshot().markerCardId!
      const marker = regions.getSnapshot().markers.find((m) => m.id === id)!
      const original = regions.getSnapshot().entities.find((e) => e.id === marker.entityId)!
      regions.duplicateMarker(id); await vi.waitFor(() => expect(regions.busy()).toBe(false))
      expect(regions.getSnapshot().markerDraft?.entity).toMatchObject({kind,status:original.status})
      expect(regions.getSnapshot().markerDraft?.entity.id).not.toBe(original.id)
      regions.cancelMarkerEdit()
    }
  })
  it('resolves existing edits before duplication and copies only the successfully saved source', async () => {
    const { regions } = await setup()
    regions.openMarkerCard('m0'); regions.beginMarkerEdit(); regions.editMarkerDetails({name:'Revised trap'})
    regions.duplicateMarker('m0'); expect(regions.getSnapshot().pendingIntent?.kind).toBe('action')
    await regions.resolveCardIntent('stay'); expect(regions.getSnapshot().markerDraft?.fields.name).toBe('Revised trap')
    regions.duplicateMarker('m0'); await regions.resolveCardIntent('save')
    expect(regions.getSnapshot().markerDraft).toMatchObject({isNew:true,fields:{name:'Revised trap Copy'}})
    expect(regions.getSnapshot().entities.find((e) => e.id === 'shared-trap')?.name).toBe('Revised trap')
  })
})
