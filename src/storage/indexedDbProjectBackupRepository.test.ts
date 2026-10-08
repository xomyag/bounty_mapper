import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { independentCopy } from '../application/projectBackupRepository'
import { IndexedDbProjectBackupRepository } from './indexedDbProjectBackupRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { IndexedDbMapImageRepository } from './indexedDbMapImageRepository'
import { IndexedDb, requestResult } from './indexedDb'
import { testSnapshot, testDecode } from './backup/testSnapshot'
import { buildArchive, parseArchive } from './backup/archive'

describe('Atomic project backups in IndexedDB', () => {
  it('round-trips all maps/assets into independent IDs and edits only the imported copy', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const projects = new IndexedDbProjectRepository(() => factory)
    const original = await testSnapshot()
    await backups.insertCopy(original)
    const archive = await buildArchive(await backups.snapshot(original.project.id))
    const restored = await parseArchive(new Blob([new Uint8Array(archive)]), testDecode)
    const copy = independentCopy(restored)
    await backups.insertCopy(copy)
    expect(copy.project.id).not.toBe(original.project.id)
    expect(copy.project.name).toBe(`${original.project.name} (копия)`)
    expect(copy.maps.map((m) => m.id).some((id) => original.maps.some((m) => m.id === id))).toBe(false)
    expect(copy.assets.map((a) => a.id).some((id) => original.assets.some((a) => a.id === id))).toBe(false)
    for (const placement of copy.imagePlacements) {
      expect(copy.maps.some((m) => m.id === placement.mapId && m.projectId === copy.project.id)).toBe(true)
      expect(copy.assets.some((a) => a.id === placement.assetId && a.projectId === copy.project.id)).toBe(true)
    }
    const changed = await projects.save({ ...copy.project, name: 'Изменённая копия', contextMd: 'Другой контекст' })
    await new IndexedDbMapImageRepository(() => factory).remove(changed)
    const savedOriginal = await backups.snapshot(original.project.id)
    expect(savedOriginal.project).toEqual(original.project)
    expect(savedOriginal.maps).toEqual(original.maps)
    expect(savedOriginal.imagePlacements).toEqual(original.imagePlacements)
    expect(await savedOriginal.assets[0].blob.arrayBuffer()).toEqual(await original.assets[0].blob.arrayBuffer())
  })

  it('rolls back the entire import and active selection if its last write fails', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const original = await testSnapshot()
    await backups.insertCopy(original)
    const copy = independentCopy(original)
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'settings') throw new DOMException('Нет места', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(backups.insertCopy(copy)).rejects.toThrow('Нет места')
    spy.mockRestore()
    const projects = new IndexedDbProjectRepository(() => factory)
    expect(await projects.list()).toEqual([original.project])
    expect(await projects.restore()).toEqual(original.project)
    const db = new IndexedDb(() => factory)
    for (const [name, count] of [['maps', 3], ['assets', 2], ['imagePlacements', 2]] as const) {
      expect(await db.transaction([name], 'readonly', (tx) => requestResult(tx.objectStore(name).count()))).toBe(count)
    }
  })

  it('reads a coherent snapshot even while another transaction edits the project and maps', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const original = await testSnapshot()
    await backups.insertCopy(original)
    const db = new IndexedDb(() => factory)
    const reading = backups.snapshot(original.project.id)
    const writing = db.transaction(['projects', 'maps'], 'readwrite', async (tx) => {
      await requestResult(tx.objectStore('projects').put({ ...original.project, contextMd: 'new', revision: 2 }))
      await requestResult(tx.objectStore('maps').put({ ...original.maps[0], notesMd: 'new' }))
    })
    const [snapshot] = await Promise.all([reading, writing])
    expect(snapshot.project.contextMd === 'new').toBe(snapshot.maps[0].notesMd === 'new')
    expect((await backups.snapshot(original.project.id)).project.contextMd).toBe('new')
  })

  it('does not delete an image still referenced by another imported map', async () => {
    const factory = new IDBFactory()
    const backups = new IndexedDbProjectBackupRepository(() => factory)
    const snapshot = await testSnapshot()
    snapshot.imagePlacements[1].assetId = snapshot.assets[0].id
    snapshot.assets = [snapshot.assets[0]]
    await backups.insertCopy(snapshot)
    await new IndexedDbMapImageRepository(() => factory).remove(snapshot.project)
    const after = await backups.snapshot(snapshot.project.id)
    expect(after.assets).toHaveLength(1)
    expect(after.imagePlacements[0].assetId).toBe(snapshot.assets[0].id)
  })
})
