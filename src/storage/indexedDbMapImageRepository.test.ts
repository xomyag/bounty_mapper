import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createProject } from '../domain/project'
import type { Project } from '../domain/project'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'
import { IndexedDbMapImageRepository } from './indexedDbMapImageRepository'
import { testAsset } from './testAsset'

describe('Map image storage', () => {
  let factory: IDBFactory
  let projects: IndexedDbProjectRepository
  let maps: IndexedDbMapImageRepository
  let project: Project
  beforeEach(async () => {
    factory = new IDBFactory()
    projects = new IndexedDbProjectRepository(() => factory)
    maps = new IndexedDbMapImageRepository(() => factory)
    project = await projects.save(createProject('Приключение'))
  })

  it('persists the original blob, metadata, first map and placement through reload', async () => {
    expect(await maps.load(project.id)).toEqual({})
    const asset = testAsset(project.id)
    const saved = await maps.replace(project, asset)
    expect(saved.project.revision).toBe(project.revision + 1)
    const reloaded = await new IndexedDbMapImageRepository(() => factory).load(project.id)
    expect(reloaded.map?.projectId).toBe(project.id)
    expect(reloaded.background?.placement).toMatchObject({ mapId: reloaded.map?.id, assetId: asset.id, x: 0, y: 0, width: 640, height: 320 })
    expect(reloaded.background?.asset).toMatchObject({ checksum: asset.checksum, pixelWidth: 640, pixelHeight: 320 })
    expect(await reloaded.background!.asset.blob.arrayBuffer()).toEqual(await asset.blob.arrayBuffer())
    expect((await projects.restore())?.revision).toBe(saved.project.revision)
  })

  it('replaces the background without creating a second map and removes the old asset', async () => {
    const first = await maps.replace(project, testAsset(project.id))
    const second = await maps.replace(first.project, testAsset(project.id, 800))
    expect(second.image.map?.id).toBe(first.image.map?.id)
    expect(second.image.background?.placement.id).toBe(first.image.background?.placement.id)
    expect(second.image.background?.placement.width).toBe(800)
    const db = new IndexedDb(() => factory)
    const assets = await db.transaction(['assets'], 'readonly', (tx) => requestResult(tx.objectStore('assets').getAll()))
    expect(assets).toHaveLength(1)
    expect(assets[0].id).toBe(second.image.background?.asset.id)
    const removed = await maps.remove(second.project)
    expect(removed.image).toEqual({ map: second.image.map })
    expect(await maps.load(project.id)).toEqual(removed.image)
    const restored = await maps.replace(removed.project, testAsset(project.id))
    expect(restored.image.map?.id).toBe(first.image.map?.id)
  })

  it('preserves the old image, asset and revision when replacement or removal fails', async () => {
    const saved = await maps.replace(project, testAsset(project.id))
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(maps.replace(saved.project, testAsset(project.id, 900))).rejects.toThrow('Нет места')
    await expect(maps.remove(saved.project)).rejects.toThrow('Нет места')
    expect((await maps.load(project.id)).background?.asset.id).toBe(saved.image.background?.asset.id)
    expect((await projects.restore())?.revision).toBe(saved.project.revision)
    const db = new IndexedDb(() => factory)
    expect(await db.transaction(['assets'], 'readonly', (tx) => requestResult(tx.objectStore('assets').count()))).toBe(1)
  })

  it('does not leave a map or orphan asset after failed first upload', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Ошибка записи') })
    await expect(maps.replace(project, testAsset(project.id))).rejects.toThrow('Ошибка записи')
    expect(await maps.load(project.id)).toEqual({})
    const db = new IndexedDb(() => factory)
    expect(await db.transaction(['assets'], 'readonly', (tx) => requestResult(tx.objectStore('assets').count()))).toBe(0)
  })

  it('keeps each project image separate when projects are switched', async () => {
    const other = await projects.save(createProject('Другой проект'))
    const first = await maps.replace(project, testAsset(project.id))
    const second = await maps.replace(other, testAsset(other.id, 1200))
    await projects.open(project.id)
    expect((await maps.load(project.id)).background?.asset.id).toBe(first.image.background?.asset.id)
    await projects.open(other.id)
    expect((await maps.load(other.id)).background?.asset.id).toBe(second.image.background?.asset.id)
  })

  it('rejects stale image changes after another tab saves the project', async () => {
    const saved = await maps.replace(project, testAsset(project.id))
    await projects.save({ ...saved.project, contextMd: 'Новые заметки' })
    await expect(maps.replace(saved.project, testAsset(project.id, 800))).rejects.toThrow('другой вкладке')
    await expect(maps.remove(saved.project)).rejects.toThrow('другой вкладке')
    expect((await maps.load(project.id)).background?.asset.id).toBe(saved.image.background?.asset.id)
  })

  it('migrates an actual version 1 database without losing BM-002 projects or selection', async () => {
    const legacy = new IDBFactory()
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = legacy.open(DATABASE_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' })
        req.result.createObjectStore('maps', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        req.result.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        req.result.createObjectStore('settings')
      }
      req.onsuccess = () => resolve(req.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction(['projects', 'settings'], 'readwrite')
      tx.objectStore('projects').put(project)
      tx.objectStore('settings').put(project.id, 'activeProjectId')
      tx.oncomplete = () => resolve()
    })
    db.close()
    const upgradedProjects = new IndexedDbProjectRepository(() => legacy)
    expect(await upgradedProjects.restore()).toEqual(project)
    const result = await new IndexedDbMapImageRepository(() => legacy).replace(project, testAsset(project.id))
    expect(result.image.background).toBeDefined()
    expect((await upgradedProjects.restore())?.name).toBe(project.name)
  })
})
