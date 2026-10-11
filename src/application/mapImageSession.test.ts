import { legacyContextDocument } from '../storage/migrateProjectContext'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { testAsset } from '../storage/testAsset'
import type { MapImage } from './mapImageRepository'
import { ProjectSession } from './projectSession'
import { MapImageSession } from './mapImageSession'

async function setup() {
  const factory = new IDBFactory()
  const repo = new IndexedDbProjectRepository(() => factory)
  const projects = new ProjectSession(repo)
  await projects.initialize()
  await projects.create('Приключение')
  const maps = new IndexedDbMapImageRepository(() => factory)
  const prepare = vi.fn(async (_file: Blob, id: string) => testAsset(id))
  const session = new MapImageSession(maps, projects, prepare)
  await session.load(projects.getSnapshot().project!.id)
  return { repo, projects, maps, prepare, session }
}

describe('Map image session', () => {
  it('keeps the existing image on decoding failure and on failed storage, then retries', async () => {
    const { session, maps, prepare, projects } = await setup()
    await session.upload(new Blob(['first']))
    const original = session.getSnapshot().image.background!.asset.id
    prepare.mockRejectedValueOnce(new Error('Ошибка декодирования'))
    await session.upload(new Blob(['corrupt']))
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: expect.stringContaining('декодирования') })
    expect(session.getSnapshot().image.background!.asset.id).toBe(original)
    vi.spyOn(maps, 'replace').mockRejectedValueOnce(new Error('Нет места'))
    await session.upload(new Blob(['replacement']))
    expect(session.getSnapshot().error).toContain('Ошибка записи')
    expect(session.getSnapshot().image.background!.asset.id).toBe(original)
    expect(projects.getSnapshot().status).toBe('saved')
    await session.retry()
    expect(session.getSnapshot().phase).toBe('saved')
    expect(session.getSnapshot().image.background!.asset.id).not.toBe(original)
  })
  it('locks project switching while loading a new file and updates the shared revision', async () => {
    const { session, prepare, projects } = await setup()
    let finish!: () => void
    prepare.mockImplementationOnce((_file, id) => new Promise((resolve) => { finish = () => resolve(testAsset(id)) }))
    const uploading = session.upload(new Blob(['first']))
    expect(session.getSnapshot().phase).toBe('uploading')
    await expect(projects.open('other')).rejects.toThrow()
    projects.edit({ name: 'Unexpected edit', context: legacyContextDocument('') })
    expect(projects.getSnapshot().project?.name).toBe('Приключение')
    finish()
    await uploading
    expect(projects.getSnapshot().project?.revision).toBe(2)
    projects.edit({ name: 'Новые заметки', context: legacyContextDocument('Контекст') })
    await projects.save()
    expect(projects.getSnapshot().status).toBe('saved')
  })
  it('ignores a slow result for a previously opened project', async () => {
    const { session, maps } = await setup()
    let finish!: (image: MapImage) => void
    vi.spyOn(maps, 'load').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const old = session.load('old')
    await session.load('new')
    finish({ map: { id: 'old-map', projectId: 'old', name: 'Old', description: legacyContextDocument(''), order: 0, coordinateBounds: { x: 0, y: 0, width: 1, height: 1 } } })
    await old
    expect(session.getSnapshot()).toEqual({ projectId: 'new', image: {}, phase: 'idle' })
  })
  it('keeps the original image if removal fails', async () => {
    const { session, maps } = await setup()
    await session.upload(new Blob(['first']))
    const image = session.getSnapshot().image
    vi.spyOn(maps, 'remove').mockRejectedValueOnce(new Error('Ошибка записи'))
    await session.remove()
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', image })
    await session.retry()
    expect(session.getSnapshot().image.background).toBeUndefined()
  })
})
