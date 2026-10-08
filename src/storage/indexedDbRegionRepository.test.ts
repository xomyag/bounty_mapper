import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { independentCopy } from '../application/projectBackupRepository'
import { translateVertices } from '../domain/region'
import type { Region } from '../domain/region'
import { IndexedDbRegionRepository } from './indexedDbRegionRepository'
import { IndexedDbProjectBackupRepository } from './indexedDbProjectBackupRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
import { testSnapshot, testDecode } from './backup/testSnapshot'
import { buildArchive, parseArchive, sha256 } from './backup/archive'
import { unzipSync, zipSync } from 'fflate'

const vertices = [{ x: -10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 50 }, { x: -10, y: 50 }]
function region(mapId: string): Region { return { id: crypto.randomUUID(), mapId, number: 7, title: 'Сокровищница', order: 0, color: '#ef6543', fillOpacity: 0.4, vertices: structuredClone(vertices) } }

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
    await backups.insertCopy(snapshot)
    const bytes = await buildArchive(await backups.snapshot(snapshot.project.id))
    const restored = await parseArchive(new Blob([new Uint8Array(bytes)]), testDecode)
    expect(restored.regions).toEqual(snapshot.regions)
    const copy = independentCopy(restored); await backups.insertCopy(copy)
    expect(copy.regions.every((r) => copy.maps.some((m) => m.id === r.mapId))).toBe(true)
    expect(copy.regions.some((r) => snapshot.regions.some((s) => s.id === r.id))).toBe(false)
    await new IndexedDbRegionRepository(() => factory).save(copy.project, copy.regions[0].mapId, [{ ...copy.regions[0], title: 'Только копия', vertices: translateVertices(vertices, { x: 5, y: 10 }) }])
    expect((await backups.snapshot(snapshot.project.id)).regions).toEqual(snapshot.regions)
  })
  it('imports a checksum-valid BM-004 archive v1 as an empty region collection', async () => {
    const snapshot = await testSnapshot()
    const files = unzipSync(await buildArchive(snapshot))
    const document = JSON.parse(new TextDecoder().decode(files['project.json'])) as Record<string, unknown>
    delete document.regions
    files['project.json'] = new TextEncoder().encode(JSON.stringify(document))
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as { formatVersion: number; files: { path: string; byteSize: number; sha256: string }[] }
    manifest.formatVersion = 1
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
