import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ProjectSession } from './projectSession'
import { ProjectBackupSession } from './projectBackupSession'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { parseArchive, buildArchive } from '../storage/backup/archive'

async function setup() {
  const factory = new IDBFactory()
  const repo = new IndexedDbProjectRepository(() => factory)
  const repository = new IndexedDbProjectBackupRepository(() => factory)
  const projects = new ProjectSession(repo)
  await projects.initialize()
  await projects.create('Текущий проект')
  const backups = new ProjectBackupSession(projects, repository, buildArchive, (blob) => parseArchive(blob, testDecode))
  return { repo, repository, projects, backups }
}

describe('Backup actions', () => {
  it('flushes the latest edits before creating the archive', async () => {
    const { projects, backups } = await setup()
    projects.edit({ name: 'Последнее название', contextMd: 'Самый последний текст' })
    let bytes!: Uint8Array
    await backups.export((archive) => { bytes = archive })
    const restored = await parseArchive(new Blob([new Uint8Array(bytes)]), testDecode)
    expect(restored.project).toMatchObject({ name: 'Последнее название', contextMd: 'Самый последний текст', revision: 2 })
    expect(backups.getSnapshot().phase).toBe('done')
  })
  it('stops export and retains the draft if flushing fails', async () => {
    const { repo, projects, backups } = await setup()
    projects.edit({ name: 'Название', contextMd: 'Несохранённый текст' })
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new Error('Ошибка записи'))
    const download = vi.fn()
    await backups.export(download)
    expect(download).not.toHaveBeenCalled()
    expect(backups.getSnapshot().phase).toBe('error')
    expect(projects.getSnapshot().project?.contextMd).toBe('Несохранённый текст')
  })
  it('validates before any database insertion and keeps the original selection on error', async () => {
    const { projects, repository, backups } = await setup()
    const before = projects.getSnapshot().project
    const insert = vi.spyOn(repository, 'insertCopy')
    await backups.import(new Blob(['not a ZIP']))
    expect(insert).not.toHaveBeenCalled()
    expect(projects.getSnapshot().project).toEqual(before)
    expect(backups.getSnapshot().phase).toBe('error')
    const valid = new Blob([new Uint8Array(await buildArchive(await testSnapshot()))])
    insert.mockRejectedValueOnce(new Error('Квота'))
    await backups.import(valid)
    expect(projects.getSnapshot().project).toEqual(before)
    expect(projects.getSnapshot().loading).toBe(false)
    await backups.import(valid)
    expect(projects.getSnapshot().project?.id).not.toBe(before?.id)
    expect(backups.getSnapshot().phase).toBe('done')
  })
})
