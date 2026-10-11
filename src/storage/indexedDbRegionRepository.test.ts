import { legacyTestMetadata } from './backup/legacyTestMetadata'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { independentCopy } from '../application/projectBackupRepository'
import { emptyRegionContent, translateVertices } from '../domain/region'
import type { Region } from '../domain/region'
import { IndexedDbRegionRepository } from './indexedDbRegionRepository'
import { IndexedDbProjectBackupRepository } from './indexedDbProjectBackupRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
import { testSnapshot, testDecode } from './backup/testSnapshot'
import { buildArchive, parseArchive, sha256 } from './backup/archive'
import { unzipSync, zipSync } from 'fflate'
import { markdownToDocument } from './migrateRegionText'

const vertices = [{ x: -10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }, { x: -10, y: 50 }]
function region(mapId: string): Region { return { ...emptyRegionContent(), titleCustomized: true, id: crypto.randomUUID(), mapId, number: 7, title: 'Сокровищница', order: 0, color: '#ef6543', fillOpacity: 0.4, vertices: structuredClone(vertices) } }

describe('Region persistence, migrations and archives', () => {
  it('migrates a real BM-004 database v2 without losing its project, map or image', async () => {
    const factory = new IDBFactory()
    const snapshot = await testSnapshot()
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(DATABASE_NAME, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('maps', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('imagePlacements', { keyPath: 'id' }).createIndex('mapId', 'mapId', { unique: true })
        db.createObjectStore('settings')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction(['projects', 'maps', 'assets', 'imagePlacements', 'settings'], 'readwrite')
      tx.objectStore('projects').add(snapshot.project)
      snapshot.maps.forEach((m) => tx.objectStore('maps').add(m))
      snapshot.assets.forEach((a) => tx.objectStore('assets').add(a))
      snapshot.imagePlacements.forEach((i) => tx.objectStore('imagePlacements').add(i))
      tx.objectStore('settings').put(snapshot.project.id, 'activeProjectId')
      tx.oncomplete = () => resolve()
    }); db.close()
    const regions = new IndexedDbRegionRepository(() => factory)
    expect(await regions.load(snapshot.maps[0].id)).toEqual([])
    const backup = await new IndexedDbProjectBackupRepository(() => factory).snapshot(snapshot.project.id)
    expect(backup.project).toEqual(snapshot.project)
    expect(backup.maps).toEqual(snapshot.maps)
    expect(backup.imagePlacements).toEqual(snapshot.imagePlacements)
    expect(await backup.assets[0].blob.arrayBuffer()).toEqual(await snapshot.assets[0].blob.arrayBuffer())
    expect(await new IndexedDbProjectRepository(() => factory).restore()).toEqual(snapshot.project)
  })
  it('persists overlaps, rejects stale revisions/foreign maps, and rolls back late write failures', async () => {
    const factory = new IDBFactory()
    const snapshots = new IndexedDbProjectBackupRepository(() => factory)
    const snapshot = await testSnapshot(); await snapshots.insertCopy(snapshot)
    const repo = new IndexedDbRegionRepository(() => factory)
    const first = region(snapshot.maps[0].id); const second = { ...first, id: crypto.randomUUID(), number: 8 }
    const project = await repo.save(snapshot.project, first.mapId, [first, second])
    expect(await new IndexedDbRegionRepository(() => factory).load(first.mapId)).toHaveLength(2)
    await expect(repo.save(snapshot.project, first.mapId, [])).rejects.toThrow('другой вкладке')
    await expect(repo.save(project, 'missing-map', [])).rejects.toThrow('Карта')
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repo.save(project, first.mapId, [{ ...first, vertices: translateVertices(vertices, { x: 10, y: 10 }) }])).rejects.toThrow('Нет места')
    spy.mockRestore()
    expect(await repo.load(first.mapId)).toEqual([first, second].sort((a, b) => a.id.localeCompare(b.id)))
    expect((await snapshots.snapshot(project.id)).project.revision).toBe(project.revision)
  })
  it('round-trips all region fields/map references and edits the copy independently', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const snapshot = await testSnapshot()
    snapshot.regions = [region(snapshot.maps[0].id), region(snapshot.maps[2].id)]
    Object.assign(snapshot.regions[0], { gmNotes: markdownToDocument('# Тайна\n**Золото**'), playerDescription: markdownToDocument('Для игроков'), tags: ['ловушка'], checks: [{ id: 'check-1', condition: 'Открыть дверь', ability: 'Сила', dc: 15, result: 'Дверь открыта' }, { id: 'check-2', condition: '', ability: '', result: '' }] })
    await backups.insertCopy(snapshot)
    const bytes = await buildArchive(await backups.snapshot(snapshot.project.id))
    const restored = await parseArchive(new Blob([new Uint8Array(bytes)]), testDecode)
    expect(restored.regions).toEqual(snapshot.regions)
    const copy = independentCopy(restored); await backups.insertCopy(copy)
    expect(copy.regions.every((r) => copy.maps.some((m) => m.id === r.mapId))).toBe(true)
    expect(copy.regions.some((r) => snapshot.regions.some((s) => s.id === r.id))).toBe(false)
    expect(copy.regions[0].checks[0].id).not.toBe(snapshot.regions[0].checks[0].id)
    expect(copy.regions[0].gmNotes).toEqual(snapshot.regions[0].gmNotes)
    await new IndexedDbRegionRepository(() => factory).save(copy.project, copy.regions[0].mapId, [{ ...copy.regions[0], title: 'Только копия', vertices: translateVertices(vertices, { x: 5, y: 10 }) }])
    expect((await backups.snapshot(snapshot.project.id)).regions).toEqual(snapshot.regions)
  })
  it.each([3, 4, 5])('migrates a real v%s database without changing geometry, notes or project revision', async (version) => {
    const factory = new IDBFactory()
    const snapshot = await testSnapshot()
    const old = region(snapshot.maps[0].id)
    const markdown = '# Старая тайна\n\n- **Золото**\n\n| Навык | СЛ |\n| --- | --- |\n| Сила | 15 |'
    if (version >= 4) old.gmNotes = markdownToDocument(markdown)
    const { gmNotes: _gm, playerDescription: _player, checks: _checks, tags: _tags, titleCustomized: _custom, ...legacy } = old
    void [_gm, _player, _checks, _tags, _custom]
    if (version === 4) {
      old.tags = ['Старый тег']; old.checks = [{ id: 'legacy-check', condition: 'Шум', ability: 'Мудрость', dc: 13, result: 'Слышно стража' }]
      Object.assign(legacy, { gmNotesMd: markdown, playerDescriptionMd: '', checks: old.checks, tags: old.tags })
    }
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(DATABASE_NAME, version)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('maps', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('imagePlacements', { keyPath: 'id' }).createIndex('mapId', 'mapId', { unique: true })
        db.createObjectStore('regions', { keyPath: 'id' }).createIndex('mapId', 'mapId')
        db.createObjectStore('settings')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction(['projects', 'maps', 'regions', 'assets', 'imagePlacements'], 'readwrite')
      tx.objectStore('projects').add(snapshot.project); snapshot.maps.forEach((m) => tx.objectStore('maps').add(m)); tx.objectStore('regions').add(version === 5 ? old : legacy)
      snapshot.assets.forEach((a) => tx.objectStore('assets').add(a)); snapshot.imagePlacements.forEach((p) => tx.objectStore('imagePlacements').add(p))
      tx.oncomplete = () => resolve()
    }); db.close()
    expect(await new IndexedDbRegionRepository(() => factory).load(old.mapId)).toEqual([old])
    expect(await new IndexedDbRegionRepository(() => factory).loadObjects(old.mapId)).toEqual({ entities: [], markers: [] })
    const migrated = await new IndexedDbProjectBackupRepository(() => factory).snapshot(snapshot.project.id)
    expect(migrated.project).toEqual(snapshot.project); expect(migrated.maps).toEqual(snapshot.maps); expect(migrated.imagePlacements).toEqual(snapshot.imagePlacements)
    for (let i = 0; i < snapshot.assets.length; i++) expect(await migrated.assets[i].blob.arrayBuffer()).toEqual(await snapshot.assets[i].blob.arrayBuffer())
  })
  it('rolls back a Markdown migration and its earlier writes when a legacy contour is invalid', async () => {
    const factory = new IDBFactory(); const snapshot = await testSnapshot()
    const { gmNotes, playerDescription, titleCustomized, ...identity } = region(snapshot.maps[0].id); void [gmNotes, playerDescription, titleCustomized]
    const good = { ...identity, id: 'a', gmNotesMd: '# Сохранить', playerDescriptionMd: '', tags: ['старый'] }
    const bad = { ...good, id: 'z', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] }
    const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME, 4); r.onupgradeneeded = () => {
      for (const name of ['projects', 'maps', 'assets', 'imagePlacements', 'regions']) r.result.createObjectStore(name, { keyPath: 'id' })
      for (const name of ['maps', 'assets']) r.transaction!.objectStore(name).createIndex('projectId', 'projectId')
      r.transaction!.objectStore('imagePlacements').createIndex('mapId', 'mapId', { unique: true }); r.transaction!.objectStore('regions').createIndex('mapId', 'mapId'); r.result.createObjectStore('settings')
    }; r.onsuccess = () => resolve(r.result) })
    await new Promise<void>((resolve) => { const tx = db.transaction(['projects', 'maps', 'regions'], 'readwrite'); tx.objectStore('projects').add(snapshot.project); tx.objectStore('maps').add(snapshot.maps[0]); tx.objectStore('regions').add(good); tx.objectStore('regions').add(bad); tx.oncomplete = () => resolve() }); db.close()
    await expect(new IndexedDbRegionRepository(() => factory).load(good.mapId)).rejects.toThrow('Исходные данные не изменены')
    const original = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME); r.onsuccess = () => resolve(r.result) })
    expect(original.version).toBe(4); expect(original.objectStoreNames.contains('entities')).toBe(false)
    expect(await requestResult(original.transaction('regions').objectStore('regions').getAll())).toEqual([good, bad]); original.close()
  })
  it('imports v3 Markdown into one visual document and validates image references in v4', async () => {
    const snapshot = await testSnapshot(); snapshot.regions = [region(snapshot.maps[0].id)]
    const files = unzipSync(await buildArchive(snapshot))
    const document = JSON.parse(new TextDecoder().decode(files['project.json']))
    legacyTestMetadata(document)
    const r = document.regions[0]
    delete r.shortDescription; delete r.gmNotes; delete r.playerDescription; delete r.titleCustomized
    r.gmNotesMd = '# Старый зал\n**Тайна**'; r.playerDescriptionMd = '> Описание'
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    manifest.formatVersion = 3
    delete document.entities; delete document.markerPlacements
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const entry = manifest.files.find((f: { path: string }) => f.path === 'project.json')
    entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json'])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const restored = await parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)
    expect(restored.regions[0].gmNotes).toEqual(markdownToDocument(r.gmNotesMd))
    expect(restored.regions[0]).not.toHaveProperty('gmNotesMd')
    restored.regions[0].gmNotes = { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'missing', alt: '' } }] }
    await expect(buildArchive(restored)).rejects.toThrow('отсутствующее изображение')
  })
  it('saves documents and new assets atomically, retains shared assets on image removal and remaps them in copies', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const snapshot = await testSnapshot(); snapshot.regions = [region(snapshot.maps[0].id)]
    await backups.insertCopy(snapshot)
    const repo = new IndexedDbRegionRepository(() => factory)
    const image = { ...snapshot.assets[0], id: 'text-image' }
    const doc = { type: 'doc' as const, content: [{ type: 'image', attrs: { assetId: image.id, alt: '' } }] }
    const r = { ...snapshot.regions[0], gmNotes: doc, playerDescription: structuredClone(doc) }
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'projects') throw new DOMException('Нет места для картинки', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repo.save(snapshot.project, r.mapId, [r], [image])).rejects.toThrow('Нет места')
    spy.mockRestore()
    expect((await backups.snapshot(snapshot.project.id)).assets).toHaveLength(2)
    expect(await repo.load(r.mapId)).toEqual(snapshot.regions)
    const project = await repo.save(snapshot.project, r.mapId, [r], [image])
    await repo.save(project, r.mapId, [{ ...r, gmNotes: emptyRegionContent().gmNotes }])
    const stored = await backups.snapshot(project.id)
    expect(stored.assets).toHaveLength(3)
    expect(stored.regions[0].playerDescription).toEqual(doc)
    const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(stored))]), testDecode)
    const copy = independentCopy(parsed)
    const copiedId = copy.regions[0].playerDescription.content[0].attrs!.assetId
    expect(copiedId).not.toBe(image.id)
    expect(copy.assets.some((a) => a.id === copiedId)).toBe(true)
    await backups.insertCopy(copy)
  })
  it('imports legacy archive v2 with empty new fields and unchanged contour', async () => {
    const snapshot = await testSnapshot(); snapshot.regions = [region(snapshot.maps[0].id)]
    const files = unzipSync(await buildArchive(snapshot))
    const document = JSON.parse(new TextDecoder().decode(files['project.json']))
    legacyTestMetadata(document)
    for (const region of document.regions) for (const field of ['shortDescription', 'gmNotes', 'playerDescription', 'titleCustomized', 'checks', 'tags']) delete region[field]
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    manifest.formatVersion = 2
    delete document.entities; delete document.markerPlacements
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const entry = manifest.files.find((f: { path: string }) => f.path === 'project.json')
    entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json'])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const restored = await parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)
    expect(restored.regions).toEqual(snapshot.regions)
  })
  it('imports a checksum-valid BM-004 archive v1 as an empty region collection', async () => {
    const snapshot = await testSnapshot()
    const files = unzipSync(await buildArchive(snapshot))
    const document = JSON.parse(new TextDecoder().decode(files['project.json'])) as Record<string, unknown>
    legacyTestMetadata(document)
    delete document.regions
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as { formatVersion: number; files: { path: string; byteSize: number; sha256: string }[] }
    manifest.formatVersion = 1
    delete document.entities; delete document.markerPlacements
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const entry = manifest.files.find((f) => f.path === 'project.json')!
    entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json'])
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const restored = await parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)
    expect(restored.regions).toEqual([])
    expect(restored.maps).toEqual(snapshot.maps)
  })
  it('rejects invalid geometry and broken map references even with valid archive checksums', async () => {
    const snapshot = await testSnapshot(); snapshot.regions = [region(snapshot.maps[0].id)]
    for (const invalid of [ { ...snapshot.regions[0], mapId: 'missing' }, { ...snapshot.regions[0], vertices: [vertices[0], vertices[2], vertices[1], vertices[3]] } ]) {
      const files = unzipSync(await buildArchive(snapshot))
      const document = JSON.parse(new TextDecoder().decode(files['project.json'])) as Record<string, unknown>
      document.regions = [invalid]
      files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
      const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as { files: { path: string; byteSize: number; sha256: string }[] }
      const entry = manifest.files.find((f) => f.path === 'project.json')!
      entry.byteSize = files['project.json'].length; entry.sha256 = await sha256(files['project.json'])
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
      await expect(parseArchive(new Blob([new Uint8Array(zipSync(files))]), testDecode)).rejects.toThrow()
    }
  })
  it('rolls back regions together with the entire import if its final write fails', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const snapshot = await testSnapshot(); snapshot.regions = [region(snapshot.maps[0].id)]
    await backups.insertCopy(snapshot)
    const copy = independentCopy(snapshot)
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'settings') throw new DOMException('Нет места', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(backups.insertCopy(copy)).rejects.toThrow('Нет места'); spy.mockRestore()
    const db = new IndexedDb(() => factory)
    expect(await db.transaction(['regions'], 'readonly', (tx) => requestResult(tx.objectStore('regions').getAll()))).toEqual(snapshot.regions)
    expect(await new IndexedDbProjectRepository(() => factory).restore()).toEqual(snapshot.project)
  })
})
