import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { ProjectSession } from './projectSession'

function setup() {
  const factory = new IDBFactory()
  const repo = new IndexedDbProjectRepository(() => factory)
  const session = new ProjectSession(repo)
  return { repo, session }
}

describe('Project session', () => {
  it('keeps a failed creation draft and retries with the same ID', async () => {
    const { repo, session } = setup()
    await session.initialize()
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('Ошибка записи'))
    await session.create('Черновик')
    const draft = session.getSnapshot().project!
    expect(session.getSnapshot()).toMatchObject({ status: 'error', project: { name: 'Черновик', revision: 0 } })
    expect(await repo.list()).toEqual([])
    await session.retry()
    expect(session.getSnapshot()).toMatchObject({ status: 'saved', project: { id: draft.id, revision: 1 } })
    expect(await repo.list()).toHaveLength(1)
  })

  it('retains edits after a failed save and prevents switching away from them', async () => {
    const { repo, session } = setup()
    await session.initialize()
    await session.create('Проект')
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('Квота исчерпана'))
    session.edit({ name: 'Новое название', contextMd: 'Важный текст' })
    await session.save()
    expect(session.getSnapshot()).toMatchObject({ status: 'error', project: { name: 'Новое название', contextMd: 'Важный текст' } })
    await expect(session.open('other')).rejects.toThrow('Сначала сохраните')
    await expect(session.create('Другой')).rejects.toThrow('Сначала сохраните')
    expect((await repo.restore())?.contextMd).toBe('')
    await session.retry()
    expect(session.getSnapshot().status).toBe('saved')
    expect((await repo.restore())?.contextMd).toBe('Важный текст')
  })

  it('never reports newer edits as saved when an earlier write completes', async () => {
    const { repo, session } = setup()
    await session.initialize()
    await session.create('Проект')
    const originalSave = repo.save.bind(repo)
    let complete!: () => void
    const spy = vi.spyOn(repo, 'save').mockImplementationOnce((project) => new Promise((resolve) => {
      complete = () => { void originalSave(project).then(resolve) }
    }))
    session.edit({ name: 'Проект', contextMd: 'Первый текст' })
    const pending = session.save()
    expect(session.getSnapshot().status).toBe('saving')
    session.edit({ name: 'Проект', contextMd: 'Следующий текст' })
    expect(session.save()).toBe(pending)
    complete()
    await pending
    expect(spy).toHaveBeenCalledTimes(1)
    expect(session.getSnapshot()).toMatchObject({ status: 'dirty', project: { contextMd: 'Следующий текст', revision: 2 } })
    await session.save()
    expect(session.getSnapshot().status).toBe('saved')
    expect((await repo.restore())?.contextMd).toBe('Следующий текст')
  })

  it('can retry a failed initial read', async () => {
    const { repo, session } = setup()
    vi.spyOn(repo, 'restore').mockRejectedValueOnce(new Error('Чтение запрещено'))
    await session.initialize()
    expect(session.getSnapshot()).toMatchObject({ status: 'error', loading: false })
    await session.retry()
    expect(session.getSnapshot()).toEqual({ project: undefined, status: 'idle', loading: false })
  })
})
