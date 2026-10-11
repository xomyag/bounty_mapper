import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { ProjectSession } from './projectSession'
import { RegionSession } from './regionSession'
import { independentCopy } from './projectBackupRepository'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbInformationRepository } from '../storage/indexedDbInformationRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbModeRepository } from '../storage/indexedDbModeRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { IndexedDbNavigationRepository } from '../storage/indexedDbNavigationRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { IndexedDb, DATABASE_NAME, requestResult } from '../storage/indexedDb'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive } from '../storage/backup/archive'
import { legacyTestMetadata } from '../storage/backup/legacyTestMetadata'
import { legacyContextDocument, migrateProjectContext, migrateMapDescription } from '../storage/migrateProjectContext'
import { createProject } from '../domain/project'
import { documentAssetIds, documentText, emptyDocument } from '../domain/richText'
import { emptyRegionContent } from '../domain/region'

async function setup() {
  const factory = new IDBFactory(); const backups = new IndexedDbProjectBackupRepository(() => factory)
  const original = await testSnapshot()
  original.regions = [{ ...emptyRegionContent(), id: 'region-setup', mapId: original.maps[0].id, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], number: 1, title: 'Зал', titleCustomized: true, color: '#aa5566', fillOpacity: .4, order: 0, shortDescription: 'Заполненная область' }]
  original.entities = [{ id: 'entity-setup', projectId: original.project.id, kind: 'enemy', name: 'Страж', status: 'alive', tags: [], description: emptyDocument(), checks: [] }]
  original.markerPlacements = [{ id: 'marker-setup', entityId: 'entity-setup', mapId: original.maps[0].id, x: 1, y: 1, regionIds: ['region-setup'], color: '#aa5566', locked: false, order: 0 }]
  await backups.insertCopy(original)
  const repository = new IndexedDbProjectRepository(() => factory)
  const projects = new ProjectSession(repository); await projects.initialize()
  const information = new IndexedDbInformationRepository(() => factory)
  const session = new RegionSession(new IndexedDbRegionRepository(() => factory), projects, new IndexedDbModeRepository(() => factory), information)
  await session.loadMode(original.project.id); await session.load(original.maps[0].id)
  const open = async (mapId?: string) => { session.openInformation(mapId); await vi.waitFor(() => expect(session.getSnapshot().information?.mapId).toBe(mapId)); await vi.waitFor(() => expect(session.busy()).toBe(false)) }
  return { factory, original, backups, repository, projects, information, session, open, snapshot: () => backups.snapshot(original.project.id) }
}
function failStore(method: 'put' | 'delete', name: string) {
  const original = IDBObjectStore.prototype[method]
  return vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
    if (this.name === name) throw new DOMException('Тест: диск заполнен', 'QuotaExceededError')
    return Reflect.apply(original, this, args)
  })
}
describe('UI-03 shared information and storage', () => {
  it('migrates the shipped Markdown, literal HTML and all ordinary line breaks; is idempotent', () => {
    const original = { ...createProject('Старый'), revision: 1 }
    const plain = '  Первая строка\nВторая\n\n\nПоследняя\n'
    expect(documentText(legacyContextDocument(plain))).toBe(plain)
    const markdown = legacyContextDocument('# Заголовок\n\n**Жирный** и *курсив*\nВторая строка\n\n- Один\n- Два\n\n| Навык | СЛ |\n| --- | --- |\n| Сила | 12 |\n\n<script>alert(1)</script>')
    expect(markdown.content.some((n) => n.type === 'heading')).toBe(true)
    expect(markdown.content.some((n) => n.type === 'table')).toBe(true)
    expect(JSON.stringify(markdown)).toContain('bold'); expect(documentText(markdown)).toContain('<script>alert(1)</script>')
    const migrated = migrateProjectContext({ ...original, schemaVersion: 1, contextMd: '# Заголовок\nТекст' })
    expect(migrated).not.toHaveProperty('contextMd'); expect(migrateProjectContext(migrated as unknown as Record<string, unknown>)).toEqual(migrated)
    expect(migrateMapDescription({ id: 'map', notesMd: '' }).description).toEqual(emptyDocument())
  })
  it('saves only explicitly, cancels cleanly, retains a failed draft and retries', async () => {
    const { session, open, information, original, snapshot } = await setup(); await open()
    expect(session.getSnapshot().cardMode).toBe('view'); session.beginInformationEdit()
    session.editInformation({ document: legacyContextDocument('Отмена') }); session.cancelInformationEdit()
    expect((await snapshot()).project.context).toEqual(original.project.context)
    session.beginInformationEdit(); session.editInformation({ document: legacyContextDocument('Черновик') })
    vi.spyOn(information, 'save').mockRejectedValueOnce(new Error('Нет места'))
    await session.saveInformation(); expect(session.getSnapshot().information?.draft).toMatchObject({ phase: 'error' })
    expect(documentText(session.getSnapshot().information!.draft!.document)).toBe('Черновик')
    expect((await snapshot()).project.context).toEqual(original.project.context)
    await session.saveInformation(); expect(documentText((await snapshot()).project.context)).toBe('Черновик'); expect(session.hasUnsavedDetails()).toBe(false)
  })
  it('protects close, object, map, project and mode transitions with the same draft', async () => {
    const { session, open, information, original } = await setup(); await open(); session.beginInformationEdit(); session.editInformation({ document: legacyContextDocument('Сохранить перед переходом') })
    session.closeCard(); expect(session.getSnapshot().pendingIntent?.kind).toBe('close'); await session.resolveCardIntent('stay')
    expect(session.getSnapshot().information?.draft).toBeDefined()
    const navigator = vi.fn(async () => {}); session.setMapNavigator(navigator); session.navigate({ mapId: original.maps[1].id })
    expect(navigator).not.toHaveBeenCalled(); await session.resolveCardIntent('stay')
    const next = vi.fn(async () => {}); session.afterDetails(next); await session.resolveCardIntent('stay'); expect(next).not.toHaveBeenCalled()
    session.requestMode('play'); expect(session.getSnapshot().mode).toBe('prepare')
    vi.spyOn(information, 'save').mockRejectedValueOnce(new Error('Ошибка записи')); await session.resolveCardIntent('save')
    expect(session.getSnapshot().mode).toBe('prepare'); expect(session.getSnapshot().pendingIntent).toBeDefined()
    await session.resolveCardIntent('save'); expect(session.getSnapshot().mode).toBe('play'); expect(session.getSnapshot().information?.draft).toBeUndefined()
    session.beginInformationEdit(); expect(session.getSnapshot().information?.draft).toBeUndefined()
  })
  it('keeps two map descriptions independent and replaces the visible document on map navigation', async () => {
    const { session, open, original, snapshot } = await setup(); await open(original.maps[0].id)
    session.beginInformationEdit(); session.editInformation({ document: legacyContextDocument('Первый этаж') }); await session.saveInformation()
    await open(original.maps[1].id); session.beginInformationEdit(); session.editInformation({ document: legacyContextDocument('Второй этаж') }); await session.saveInformation()
    const saved = await snapshot(); expect(saved.maps.map((m) => documentText(m.description))).toEqual(['Первый этаж', 'Второй этаж', 'Заметки карты 2'])
    session.adoptMap({ mapId: saved.maps[0].id }, { ...await session.readMap(saved.maps[0].id), map: saved.maps[0] })
    expect(documentText(session.getSnapshot().information!.document)).toBe('Первый этаж')
    expect(session.getSnapshot().information?.mapId).toBe(saved.maps[0].id)
    const before = session.getSnapshot()
    expect(() => session.adoptMap({ mapId: saved.maps[1].id, kind: 'region', id: 'missing' }, { ...before, assets: [], map: saved.maps[1] })).toThrow('больше не существует')
    expect(session.getSnapshot()).toBe(before)
  })
  it('cancels staged creation without records or orphan images; failed final write is atomic', async () => {
    const { session, projects, original, repository, backups } = await setup()
    session.createInformation('Новый'); await vi.waitFor(() => expect(session.getSnapshot().information?.kind).toBe('new-project'))
    const id = session.getSnapshot().information!.projectId
    const asset = { ...original.assets[0], id: 'draft-image', projectId: id }
    session.addInformationDraftAsset(asset); session.editInformation({ document: { type: 'doc', content: [{ type: 'image', attrs: { assetId: asset.id, alt: '' } }] } }); session.cancelInformationEdit()
    expect(await repository.list()).toHaveLength(1); expect((await backups.snapshot(original.project.id)).assets).toHaveLength(2)
    session.createInformation('Новый'); await vi.waitFor(() => expect(session.getSnapshot().information?.kind).toBe('new-project'))
    const nextId = session.getSnapshot().information!.projectId; const nextAsset = { ...asset, projectId: nextId }
    session.addInformationDraftAsset(nextAsset); session.editInformation({ document: { type: 'doc', content: [{ type: 'image', attrs: { assetId: asset.id, alt: '' } }] } })
    const spy = failStore('put', 'settings'); await session.saveInformation(); spy.mockRestore()
    expect(await repository.list()).toHaveLength(1); expect(projects.getSnapshot().project?.id).toBe(original.project.id)
    expect(session.getSnapshot().information?.draft?.phase).toBe('error')
    await session.saveInformation(); expect(await repository.list()).toHaveLength(2)
    expect((await backups.snapshot(nextId)).assets.map((a) => a.id)).toEqual([asset.id])
  })
  it('round-trips both information documents and original images, remapping every reference', async () => {
    const { original, backups, snapshot } = await setup()
    const image = { type: 'image', attrs: { assetId: original.assets[0].id, alt: 'Контекст' } }
    original.project.context.content.push(image); original.maps[1].description.content.push(structuredClone(image))
    const copy = independentCopy(original); await backups.insertCopy(copy)
    const storedCopy = await backups.snapshot(copy.project.id)
    const parsed = await parseArchive(new Blob([new Uint8Array(await buildArchive(storedCopy))]), testDecode)
    expect(parsed.project.context).toEqual(copy.project.context); expect(parsed.maps).toEqual(storedCopy.maps)
    for (const doc of [parsed.project.context, ...parsed.maps.map((m) => m.description)]) for (const id of documentAssetIds(doc)) { expect(copy.assets.some((a) => a.id === id)).toBe(true); expect(original.assets.some((a) => a.id === id)).toBe(false) }
    expect(await parsed.assets[0].blob.arrayBuffer()).toEqual(await original.assets[0].blob.arrayBuffer())
    expect((await snapshot()).project.context).not.toEqual(copy.project.context)
  })
  it('keeps images referenced by context or another map description when backgrounds/maps are removed', async () => {
    const { factory, original, projects, information, backups } = await setup()
    const doc = { type: 'doc' as const, content: [{ type: 'image', attrs: { assetId: original.assets[0].id, alt: '' } }] }
    let project = await information.save(projects.getSnapshot().project!, { name: original.project.name, document: doc }, [])
    project = (await new IndexedDbMapImageRepository(() => factory).remove(project, original.maps[0].id)).project
    expect((await backups.snapshot(project.id)).assets.some((a) => a.id === original.assets[0].id)).toBe(true)
    project = await information.save(project, { name: 'ignored', mapId: original.maps[1].id, document: doc }, [])
    project = await new IndexedDbNavigationRepository(() => factory).deleteMap(project, original.maps[0].id)
    expect((await backups.snapshot(project.id)).assets.some((a) => a.id === original.assets[0].id)).toBe(true)
  })
  it('deletes all project-owned data/settings, preserving another project and global panel width', async () => {
    const { factory, original, repository, backups } = await setup(); const other = independentCopy(original); await backups.insertCopy(other)
    original.regions = [{ ...emptyRegionContent(), id: 'region', mapId: original.maps[0].id, vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], number: 1, title: 'Зал', titleCustomized: true, color: '#aa5566', fillOpacity: .4, order: 0 }]
    const db = new IndexedDb(() => factory)
    await db.transaction(['settings', 'regions', 'entities', 'markerPlacements'], 'readwrite', async (tx) => {
      await requestResult(tx.objectStore('regions').add(original.regions[0]))
      await requestResult(tx.objectStore('entities').add({ id: 'entity', projectId: original.project.id, kind: 'enemy', name: 'Страж', status: 'alive', tags: [], description: emptyDocument(), checks: [] }))
      await requestResult(tx.objectStore('markerPlacements').add({ id: 'marker', entityId: 'entity', mapId: original.maps[0].id, x: 1, y: 1, regionIds: ['region'], color: '#aa5566', locked: false, order: 0 }))
      for (const key of [`workspaceMode:${original.project.id}`, `tagHistory:${original.project.id}`, 'ui:cardWidth']) await requestResult(tx.objectStore('settings').put(500, key))
    })
    const otherBefore = await backups.snapshot(other.project.id)
    await repository.remove(original.project); expect(await repository.list()).toEqual([other.project]); expect(await backups.snapshot(other.project.id)).toEqual(otherBefore)
    await db.transaction(['settings', 'regions', 'entities', 'markerPlacements'], 'readonly', async (tx) => {
      for (const store of ['regions', 'entities', 'markerPlacements']) expect(await requestResult(tx.objectStore(store).count())).toBe(1)
      expect(await requestResult(tx.objectStore('settings').get(`workspaceMode:${original.project.id}`))).toBeUndefined()
      expect(await requestResult(tx.objectStore('settings').get(`tagHistory:${original.project.id}`))).toBeUndefined()
      expect(await requestResult(tx.objectStore('settings').get('ui:cardWidth'))).toBe(500)
    })
    expect((await repository.restore())?.id).toBe(other.project.id)
  })
  it('rolls back a late deletion failure, including assets and project selection', async () => {
    const { repository, projects, original, snapshot } = await setup(); const before = await snapshot()
    const spy = failStore('delete', 'projects'); await expect(projects.remove(original.project)).rejects.toThrow('Недостаточно места'); spy.mockRestore()
    expect(await snapshot()).toEqual(before); expect(await repository.restore()).toEqual(original.project); expect(projects.getSnapshot().loading).toBe(false)
    await projects.remove(original.project); expect(await repository.list()).toEqual([]); expect(await repository.restore()).toBeUndefined(); expect(projects.getSnapshot().project).toBeUndefined()
  })
  it('blocks a dirty object transition and cancels vertex/drawing tools only after the choice', async () => {
    const { session, open, original } = await setup(); await open(); session.beginInformationEdit(); session.editInformation({ document: legacyContextDocument('Черновик контекста') })
    session.openCard(original.regions[0].id); expect(session.getSnapshot().pendingIntent?.kind).toBe('open'); expect(session.getSnapshot().cardId).toBeUndefined()
    await session.resolveCardIntent('stay'); expect(session.getSnapshot().information?.draft).toBeDefined()
    session.openCard(original.regions[0].id); await session.resolveCardIntent('discard'); expect(session.getSnapshot().information).toBeUndefined(); expect(session.getSnapshot().cardId).toBe(original.regions[0].id)
    session.setVertexMode(true); expect(session.getSnapshot().vertexMode).toBe(true); await open(); expect(session.getSnapshot().vertexMode).toBe(false); expect(session.getSnapshot().cardId).toBeUndefined()
    session.closeCard(); session.start({ x: 2, y: 2 }); expect(session.getSnapshot().draft).toBeDefined(); await open(); expect(session.getSnapshot().draft).toBeUndefined()
  })
  it('rolls back map description and newly inserted images on the final project write failure', async () => {
    const { session, open, original, snapshot } = await setup(); await open(original.maps[1].id); session.beginInformationEdit()
    const image = { ...original.assets[0], id: 'new-doc-asset' }; session.addInformationDraftAsset(image)
    session.editInformation({ document: { type: 'doc', content: [{ type: 'image', attrs: { assetId: image.id, alt: '' } }] } })
    const before = await snapshot(); const spy = failStore('put', 'projects'); await session.saveInformation(); spy.mockRestore()
    expect(await snapshot()).toEqual(before); expect(session.getSnapshot().information?.draft?.assets).toEqual([image]); expect(session.getSnapshot().information?.draft?.phase).toBe('error')
    await session.saveInformation(); expect((await snapshot()).assets).toHaveLength(3)
    for (const kind of ['project', 'map']) {
      const invalid = await snapshot(); const doc = { type: 'doc' as const, content: [{ type: 'image', attrs: { assetId: 'missing', alt: '' } }] }
      if (kind === 'project') invalid.project.context = doc; else invalid.maps[0].description = doc
      await expect(buildArchive(invalid)).rejects.toThrow('отсутствующее изображение')
    }
  })
  it('rolls back a failed v8 context migration and retains the original database version', async () => {
    const factory = new IDBFactory(); const original = await testSnapshot(); const legacy = structuredClone(original)
    legacyTestMetadata(legacy as unknown as Record<string, unknown>)
    const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME, 8); r.onupgradeneeded = () => {
      r.result.createObjectStore('settings'); r.result.createObjectStore('projects', { keyPath: 'id' })
      for (const name of ['maps', 'assets', 'entities']) r.result.createObjectStore(name, { keyPath: 'id' }).createIndex('projectId', 'projectId')
      for (const name of ['regions', 'imagePlacements', 'markerPlacements']) r.result.createObjectStore(name, { keyPath: 'id' }).createIndex('mapId', 'mapId')
    }; r.onsuccess = () => resolve(r.result) })
    await new Promise<void>((resolve) => { const tx = db.transaction(['projects', 'maps'], 'readwrite'); tx.objectStore('projects').add(legacy.project); tx.objectStore('maps').add({ ...legacy.maps[0], notesMd: null }); tx.oncomplete = () => resolve() }); db.close()
    await expect(new IndexedDbProjectRepository(() => factory).list()).rejects.toThrow('Исходные данные не изменены')
    const unchanged = await new Promise<IDBDatabase>((resolve) => { const r = factory.open(DATABASE_NAME); r.onsuccess = () => resolve(r.result) })
    expect(unchanged.version).toBe(8); expect(await requestResult(unchanged.transaction('projects').objectStore('projects').get(original.project.id))).toEqual(legacy.project); unchanged.close()
  })
})
