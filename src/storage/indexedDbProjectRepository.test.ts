import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createProject } from '../domain/project'
import { RevisionConflictError } from '../application/projectRepository'
import { IndexedDbProjectRepository } from './indexedDbProjectRepository'

describe('IndexedDB projects', () => {
  let factory: IDBFactory
  let repo: IndexedDbProjectRepository
  beforeEach(() => {
    factory = new IDBFactory()
    repo = new IndexedDbProjectRepository(() => factory)
  })

  it('creates, lists, edits and restores the selected project through a new repository', async () => {
    expect(await repo.list()).toEqual([])
    expect(await repo.restore()).toBeUndefined()
    const first = await repo.save(createProject('  Первое приключение  '))
    const second = await repo.save(createProject('Другое приключение'))
    expect(first.revision).toBe(1)
    expect(first.name).toBe('Первое приключение')
    expect(await repo.list()).toHaveLength(2)
    await repo.open(first.id)
    const edited = await repo.save({ ...first, name: 'Новое название', contextMd: '# Контекст\nСекрет ведущего' })
    const reloaded = new IndexedDbProjectRepository(() => factory)
    expect(await reloaded.restore()).toEqual(edited)
    expect(edited.revision).toBe(2)
    expect(await reloaded.open(second.id)).toEqual(second)
    expect(await reloaded.restore()).toEqual(second)
  })

  it('rolls back a project write if another request in its transaction fails', async () => {
    const saved = await repo.save(createProject('Исходное название'))
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'settings') throw new DOMException('Нет места', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repo.save({ ...saved, contextMd: 'Несохранённый текст' })).rejects.toThrow('Нет места')
    expect(await repo.restore()).toEqual(saved)
    expect(await repo.list()).toEqual([saved])
  })

  it('rejects an aborted transaction even if the project put request succeeded', async () => {
    const saved = await repo.save(createProject('Проект'))
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      const request = put.apply(this, args)
      if (this.name === 'settings') request.addEventListener('success', () => this.transaction.abort())
      return request
    })
    await expect(repo.save({ ...saved, name: 'Не должно сохраниться' })).rejects.toThrow()
    expect(await repo.restore()).toEqual(saved)
  })

  it('rejects a failed creation without leaving a project or active selection', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Нет места', 'QuotaExceededError') })
    await expect(repo.save(createProject('Черновик'))).rejects.toThrow('Нет места')
    expect(await repo.list()).toEqual([])
    expect(await repo.restore()).toBeUndefined()
  })

  it('prevents silent overwrite by concurrent sessions', async () => {
    const saved = await repo.save(createProject('Общий проект'))
    const other = new IndexedDbProjectRepository(() => factory)
    const results = await Promise.allSettled([
      repo.save({ ...saved, contextMd: 'Первая вкладка' }),
      other.save({ ...saved, contextMd: 'Вторая вкладка' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(RevisionConflictError) })
    expect((await repo.restore())?.revision).toBe(2)
  })

  it('reports unavailable storage and missing projects', async () => {
    const unavailable = new IndexedDbProjectRepository(() => { throw new DOMException('Запрещено', 'SecurityError') })
    await expect(unavailable.restore()).rejects.toThrow('Запрещено')
    await expect(repo.open('missing')).rejects.toThrow('Проект не найден')
    expect(await repo.restore()).toBeUndefined()
  })

  it('rejects empty names and unknown schema versions without changing data', async () => {
    const saved = await repo.save(createProject('Проект'))
    await expect(repo.save({ ...saved, name: '  ' })).rejects.toThrow('Укажите название')
    await expect(repo.save({ ...saved, schemaVersion: 99 })).rejects.toThrow('Версия проекта')
    expect(await repo.restore()).toEqual(saved)
  })
})
