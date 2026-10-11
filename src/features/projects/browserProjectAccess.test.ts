import { legacyContextDocument } from '../../storage/migrateProjectContext'
import { describe, expect, it } from 'vitest'
import { BrowserProjectAccess } from './browserProjectAccess'
import { ProjectSession } from '../../application/projectSession'
import { IndexedDbProjectRepository } from '../../storage/indexedDbProjectRepository'
import { IDBFactory } from 'fake-indexeddb'
import { createProject } from '../../domain/project'

function locks() {
  const held = new Set<string>()
  return { request: async (name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (held.has(name)) return callback(null)
    held.add(name)
    try { return await callback({ name, mode: 'exclusive' } as Lock) } finally { held.delete(name) }
  } } as LockManager
}
describe('Single editor per project', () => {
  it('holds the lock for the tab, allows other projects, and grants editing after release', async () => {
    const manager = locks(); const first = new BrowserProjectAccess(() => manager); const second = new BrowserProjectAccess(() => manager)
    await first.select('a'); await second.select('a')
    expect(first.canEdit('a')).toBe(true); expect(second.canEdit('a')).toBe(false); expect(second.message()).toContain('другой вкладке')
    await second.select('b'); expect(second.canEdit('b')).toBe(true)
    await first.release(); await second.select('a'); expect(second.canEdit('a')).toBe(true)
    await second.release()
  })
  it('does not acquire an obsolete selection and fails safely when permission is denied', async () => {
    const access = new BrowserProjectAccess(() => locks())
    await Promise.all([access.select('old'), access.select('new')]); expect(access.canEdit('old')).toBe(false); expect(access.canEdit('new')).toBe(true)
    await access.release()
    const denied = new BrowserProjectAccess(() => { throw new Error('Запрещено') })
    await denied.select('a'); expect(denied.canEdit('a')).toBe(false); expect(denied.message()).toContain('Запрещено')
  })
  it('protects a reader, exports its saved snapshot, and rereads the revision before editing', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectRepository(() => factory); const project = await repo.save(createProject('Общий'))
    const manager = locks(); const a = new BrowserProjectAccess(() => manager); const b = new BrowserProjectAccess(() => manager)
    const owner = new ProjectSession(repo, a); const reader = new ProjectSession(new IndexedDbProjectRepository(() => factory), b)
    await owner.initialize(); await reader.initialize()
    expect(reader.getSnapshot().readOnly).toBe(true)
    reader.edit({ name: 'Перезапись', context: legacyContextDocument('Чужой') }); expect(reader.getSnapshot().project).toEqual(project)
    await expect(reader.mutateProject(async (p) => p)).rejects.toThrow('только для чтения')
    let inspected = false; await reader.inspectProject(async () => { inspected = true }); expect(inspected).toBe(true)
    owner.edit({ name: project.name, context: legacyContextDocument('Актуальный текст') }); await owner.save(); await owner.releaseEditing()
    let refreshed = false; await reader.requestEditing(async () => { refreshed = true })
    expect(refreshed).toBe(true); expect(reader.canEdit()).toBe(true); expect(reader.getSnapshot().project?.context).toEqual(legacyContextDocument('Актуальный текст'))
    expect(reader.getSnapshot().project?.revision).toBe(2)
    reader.edit({ name: project.name, context: legacyContextDocument('После получения права') }); await reader.save(); expect((await repo.restore())?.revision).toBe(3)
    await reader.releaseEditing()
  })
  it('keeps revision protection when Web Locks is unavailable', async () => {
    const access = new BrowserProjectAccess(() => undefined); await access.select('a')
    expect(access.canEdit('a')).toBe(true); expect(access.message()).toContain('проверкой версии')
  })
  it('does not leave loading stuck or create a project when lock acquisition fails', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectRepository(() => factory)
    const access = new BrowserProjectAccess(() => { throw new Error('Блокировки запрещены') }); const projects = new ProjectSession(repo, access)
    await projects.initialize(); await expect(projects.create('Название в форме')).rejects.toThrow('Блокировки запрещены')
    expect(projects.getSnapshot().loading).toBe(false); expect(projects.getSnapshot().project).toBeUndefined(); expect(await repo.list()).toEqual([])
  })
})
