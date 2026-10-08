import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { testAsset } from '../storage/testAsset'
import { ProjectSession } from './projectSession'
import { RegionSession } from './regionSession'
import { translateVertices } from '../domain/region'

async function setup() {
  const factory = new IDBFactory()
  const projects = new ProjectSession(new IndexedDbProjectRepository(() => factory))
  await projects.initialize(); await projects.create('Приключение')
  const image = await new IndexedDbMapImageRepository(() => factory).replace(projects.getSnapshot().project!, testAsset(projects.getSnapshot().project!.id))
  await projects.open(image.project.id)
  const repo = new IndexedDbRegionRepository(() => factory)
  const session = new RegionSession(repo, projects)
  await session.load(image.image.map!.id)
  return { session, projects, repo, mapId: image.image.map!.id }
}
async function create(session: RegionSession) {
  session.start(); session.addPoint({ x: 0, y: 0 }); session.addPoint({ x: 10, y: 0 }); session.addPoint({ x: 10, y: 10 }); session.addPoint({ x: 0, y: 10 }); await session.finish()
}
describe('Region commands and saved history', () => {
  it('moves and removes draft vertices without storage/history writes until valid completion', async () => {
    const { session, projects, repo, mapId } = await setup()
    const revision = projects.getSnapshot().project!.revision
    const save = vi.spyOn(repo, 'save')
    session.start()
    for (const point of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]) session.addPoint(point)
    session.moveDraftVertex(0, { x: -2, y: 1 })
    session.removeDraftVertex(1)
    const edited = structuredClone(session.getSnapshot().draft)
    session.moveDraftVertex(-1, { x: 100, y: 100 }); session.removeDraftVertex(99)
    expect(session.getSnapshot().draft).toEqual(edited)
    expect(await repo.load(mapId)).toEqual([])
    expect(save).not.toHaveBeenCalled()
    expect(projects.getSnapshot().project!.revision).toBe(revision)
    expect(session.getSnapshot().canUndo).toBe(false)
    await session.finish()
    expect((await repo.load(mapId))[0].vertices).toEqual([{ x: -2, y: 1 }, { x: 10, y: 10 }, { x: 0, y: 10 }])
    expect(save).toHaveBeenCalledTimes(1)
    await session.undo()
    expect(await repo.load(mapId)).toEqual([])
  })
  it('allows deleting all draft vertices and invalidates a failed creation retry when the draft changes', async () => {
    const { session, repo, mapId } = await setup()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('Нет места'))
    await create(session)
    expect(session.getSnapshot().canRetry).toBe(true)
    session.moveDraftVertex(0, { x: -1, y: 1 })
    expect(session.getSnapshot().canRetry).toBe(false)
    await session.retry()
    expect(await repo.load(mapId)).toEqual([])
    await session.finish()
    expect((await repo.load(mapId))[0].vertices[0]).toEqual({ x: -1, y: 1 })
    session.start(); session.addPoint({ x: 1, y: 2 }); session.removeDraftVertex(0)
    expect(session.getSnapshot().draft).toEqual([])
    await session.finish()
    expect(session.getSnapshot().error).toContain('три')
    session.cancel()
    expect(await repo.load(mapId)).toHaveLength(1)
  })
  it('removes the requested saved vertex as one undoable command, retaining at least three', async () => {
    const { session, repo, mapId } = await setup()
    await create(session)
    const original = structuredClone(session.getSnapshot().regions[0])
    session.setVertexMode(true); session.selectVertex(2)
    await session.removeVertex(0)
    expect((await repo.load(mapId))[0].vertices).toEqual(original.vertices.slice(1))
    await session.removeVertex(1)
    expect(session.getSnapshot().error).toContain('минимум три')
    expect((await repo.load(mapId))[0].vertices).toEqual(original.vertices.slice(1))
    await session.undo()
    expect(await repo.load(mapId)).toEqual([original])
    await session.redo()
    expect((await repo.load(mapId))[0].vertices).toEqual(original.vertices.slice(1))
  })
  it('never writes an unfinished, cancelled or invalid contour; suppresses a repeated last vertex', async () => {
    const { session, repo, mapId } = await setup()
    session.start(); session.addPoint({ x: 0, y: 0 }); session.addPoint({ x: 0, y: 0 }); session.addPoint({ x: 1, y: 1 })
    expect(session.getSnapshot().draft).toHaveLength(2)
    await session.finish()
    expect(session.getSnapshot().error).toContain('три')
    expect(await repo.load(mapId)).toEqual([])
    session.cancel()
    expect(session.getSnapshot().draft).toBeUndefined()
    expect(session.getSnapshot().canUndo).toBe(false)
  })
  it('undoes/redoes creation, one completed drag, vertex edits and deletion; new commands clear redo', async () => {
    const { session, repo, mapId } = await setup()
    await create(session)
    const original = structuredClone(session.getSnapshot().regions[0])
    expect(original.fillOpacity).toBe(0.4)
    const moved = { ...original, vertices: translateVertices(original.vertices, { x: -25, y: 13 }) }
    await session.change(moved)
    await session.undo(); expect(await repo.load(mapId)).toEqual([original])
    await session.redo(); expect(await repo.load(mapId)).toEqual([moved])
    session.setVertexMode(true); session.selectVertex(0); await session.removeVertex()
    expect(session.getSnapshot().regions[0].vertices).toHaveLength(3)
    session.selectVertex(0); await session.removeVertex()
    expect(session.getSnapshot().regions[0].vertices).toHaveLength(3)
    await session.undo(); expect(session.getSnapshot().regions).toEqual([moved])
    await session.remove(); expect(await repo.load(mapId)).toEqual([])
    await session.undo(); expect(session.getSnapshot().regions).toEqual([moved])
    await session.undo(); expect(session.getSnapshot().regions).toEqual([original])
    await session.undo(); expect(session.getSnapshot().regions).toEqual([])
    await session.redo(); expect(session.getSnapshot().regions).toEqual([original])
    await session.change({ ...original, title: 'Новое название' })
    expect(session.getSnapshot().canRedo).toBe(false)
  })
  it('reports saved only after transaction completion; keeps geometry/history on failure and retries', async () => {
    const { session, projects, repo } = await setup()
    await create(session)
    const original = structuredClone(session.getSnapshot().regions)
    const changed = { ...original[0], vertices: translateVertices(original[0].vertices, { x: 2, y: -3 }) }
    const save = repo.save.bind(repo)
    let finish!: () => void
    vi.spyOn(repo, 'save').mockImplementationOnce((...args) => new Promise((resolve, reject) => { finish = () => { void save(...args).then(resolve, reject) } }))
    const writing = session.change(changed)
    expect(session.getSnapshot().phase).toBe('saving')
    expect(projects.getSnapshot().loading).toBe(true)
    await expect(projects.open('other')).rejects.toThrow()
    finish(); await writing
    expect(session.getSnapshot().phase).toBe('saved')
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('Тестовая ошибка записи'))
    await session.undo()
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', regions: [changed], canUndo: true, canRedo: false, canRetry: true })
    await session.retry()
    expect(session.getSnapshot()).toMatchObject({ phase: 'saved', regions: original, canRedo: true })
  })
  it('keeps a failed creation draft and can retry; drops history and selection on switching/reloading', async () => {
    const { session, repo, mapId } = await setup()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('Нет места'))
    await create(session)
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', regions: [], canUndo: false })
    expect(session.getSnapshot().draft).toHaveLength(4)
    await session.retry()
    expect(session.getSnapshot().draft).toBeUndefined()
    await session.load(mapId)
    expect(session.getSnapshot()).toMatchObject({ phase: 'saved', canUndo: false, canRedo: false, selectedId: undefined })
    expect(session.getSnapshot().regions).toHaveLength(1)
  })
  it('ignores stale reads and prevents overwriting regions after a failed read', async () => {
    const { session, repo, mapId } = await setup()
    let resolve!: (regions: never[]) => void
    vi.spyOn(repo, 'load').mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const old = session.load('old-map')
    await session.load(mapId); resolve([]); await old
    expect(session.getSnapshot().mapId).toBe(mapId)
    vi.spyOn(repo, 'load').mockRejectedValueOnce(new Error('Ошибка чтения'))
    await session.load(mapId)
    session.start()
    expect(session.getSnapshot().draft).toBeUndefined()
    await session.retry(); expect(session.ready()).toBe(true)
  })
})
