import { clickMenuAction, control } from './controls'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import type { Camera, Point } from '../../src/domain/viewport'
import { worldToScreen } from '../../src/domain/viewport'
import { emptyRegionContent } from '../../src/domain/region'
import type { Region } from '../../src/domain/region'
import type { Entity, MarkerPlacement } from '../../src/domain/marker'
import type { Map, Project, ImagePlacement } from '../../src/domain/project'
import { emptyDocument } from '../../src/domain/richText'
import type { RichDocument } from '../../src/domain/richText'

type TestWindow = { Konva: { stages: Konva.Stage[] }; originalPut: typeof IDBObjectStore.prototype.put; frames: Camera[]; recording: boolean; originalCanvas: HTMLCanvasElement | null }
const button = control
const modeButton = (page: Page, name: string) => page.getByRole('group', { name: 'Режим работы', exact: true }).getByRole('button', { name, exact: true })
const canvas = (page: Page) => page.getByRole('region', { name: 'Карта приключения', exact: true })
const regionCard = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })
const markerCard = (page: Page) => page.getByRole('region', { name: 'Карточка маркера', exact: true })
const nav = (page: Page) => page.getByRole('complementary', { name: 'Навигация и поиск', exact: true })
async function paint(page: Page) { await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function camera(page: Page): Promise<Camera> { return page.evaluate(() => { const s = (window as unknown as TestWindow).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX() } }) }
async function screen(page: Page, point: Point) { const box = (await canvas(page).boundingBox())!; const p = worldToScreen(point, await camera(page)); return { x: box.x + p.x, y: box.y + p.y } }
async function clickWorld(page: Page, point: Point) { await paint(page); const p = await screen(page, point); await page.mouse.click(p.x, p.y) }
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['maps', 'projects', 'regions', 'entities', 'markerPlacements', 'imagePlacements', 'assets'])
    const get = <T,>(name: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result as T[]) })
    const [maps, projects, regions, entities, markers, images, assets] = await Promise.all([get<Map>('maps'), get<Project>('projects'), get<Region>('regions'), get<Entity>('entities'), get<MarkerPlacement>('markerPlacements'), get<ImagePlacement>('imagePlacements'), get<{ id: string; checksum: string; blob: Blob }>('assets')]); db.close()
    return { maps, projects, regions, entities, markers, images, assets: assets.map((a) => ({ id: a.id, checksum: a.checksum, byteSize: a.blob.size })) }
  })
}
async function failWrites(page: Page, store: string) {
  await page.evaluate((store) => { const w = window as unknown as TestWindow; w.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === store) throw new DOMException('Нет места', 'QuotaExceededError'); return w.originalPut.apply(this, args) } }, store)
}
async function restoreWrites(page: Page) { await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as TestWindow).originalPut }) }
async function track(page: Page) {
  await page.evaluate(() => { const w = window as unknown as TestWindow; w.frames = []; w.recording = true; w.originalCanvas = document.querySelector('.konvajs-content canvas'); const sample = () => { if (!w.recording) return; const s = w.Konva.stages[0]; w.frames.push({ x: s.x(), y: s.y(), scale: s.scaleX() }); requestAnimationFrame(sample) }; requestAnimationFrame(sample) })
}
async function stable(page: Page, expected: Camera) {
  await paint(page)
  const observed = await page.evaluate(() => { const w = window as unknown as TestWindow; w.recording = false; return { frames: w.frames, sameCanvas: w.originalCanvas === document.querySelector('.konvajs-content canvas') } })
  expect(observed.sameCanvas).toBe(true); expect(observed.frames.length).toBeGreaterThan(0)
  for (const frame of observed.frames) expect(frame).toEqual(expected)
  expect(await camera(page)).toEqual(expected)
}
async function switchMap(page: Page, id: string) {
  await button(page, 'Карты проекта').click()
  await page.getByRole('menu', { name: 'Карты проекта' }).locator(`[data-map-id="${id}"]`).getByRole('menuitem', { name: /Перейти на карту/ }).click()
  await expect(canvas(page)).toHaveAttribute('data-map-id', id); await paint(page)
}
async function find(page: Page, kind: 'Области' | 'Маркеры', id: string) {
  if (!await nav(page).isVisible()) await button(page, 'Навигация и поиск').click()
  await nav(page).getByRole('tab', { name: kind, exact: true }).click()
  await nav(page).getByLabel('Область поиска').selectOption('project')
  await nav(page).locator(`[data-object-id="${id}"]`).first().click()
  await paint(page); await expect(page.locator('.region-card')).toHaveCount(1)
}
async function seed(page: Page) {
  await page.goto('/'); await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Игра')
  await button(page, 'Создать').click()
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Сохранено на устройстве')
  await button(page, 'Закрыть окно проекта').click()
  await expect(modeButton(page, 'Подготовка')).toHaveAttribute('aria-pressed', 'true')
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const ctx = c.getContext('2d')!; ctx.fillStyle = '#466778'; ctx.fillRect(0, 0, 600, 400); return c.toDataURL().split(',')[1] })
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(button(page, 'Добавить область')).toBeEnabled()
  const initial = await stored(page); const a = initial.maps[0]; const b = { ...a, id: 'b', name: 'Подвал', order: 1 }
  const assetId = initial.assets[0].id
  const rich: RichDocument = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Тайна ведущего' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Жирный текст', marks: [{ type: 'bold' }] }, { type: 'text', text: ' и курсив', marks: [{ type: 'italic' }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Список улик' }] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Цитата' }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Таблица' }] }] }] }] },
    { type: 'image', attrs: { assetId, alt: 'План комнаты' } },
  ] }
  const r: Region = { ...emptyRegionContent(), id: 'r1', mapId: a.id, number: 1, title: 'Зал', titleCustomized: true, order: 0, color: '#d7ad62', fillOpacity: .4, vertices: [{ x: 60, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 200 }, { x: 60, y: 200 }], gmNotes: rich, playerDescription: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Вы видите дверь.' }] }] }, checks: [{ id: 'check1', condition: 'Осмотреть дверь', ability: 'Внимание', dc: 12, result: 'Заметили ловушку' }], tags: ['Тайна'] }
  const regions: Region[] = [r, { ...emptyRegionContent(), id: 'empty', mapId: a.id, number: 2, title: 'Область 2', titleCustomized: false, order: 1, color: '#d7ad62', fillOpacity: .4, vertices: [{ x: 300, y: 220 }, { x: 420, y: 220 }, { x: 420, y: 300 }, { x: 300, y: 300 }] }, { ...r, id: 'rb', mapId: b.id, number: 3, title: 'Подземелье' }]
  const entities: Entity[] = [{ checks: [], id: 'e1', projectId: a.projectId, kind: 'enemy', name: 'Первый страж', description: rich, status: 'alive', tags: ['Тайна'] }, { checks: [], id: 'e2', projectId: a.projectId, kind: 'enemy', name: 'Второй страж', description: emptyDocument(), status: 'alive', tags: [] }]
  const markers: MarkerPlacement[] = [{ id: 'm1', entityId: 'e1', mapId: a.id, x: 260, y: 120, regionIds: ['r1', 'empty'], color: '#d7ad62', locked: false, order: 0 }, { id: 'm2', entityId: 'e2', mapId: a.id, x: 500, y: 280, regionIds: [], color: '#d7ad62', locked: false, order: 1 }, { id: 'mb', entityId: 'e1', mapId: b.id, x: 150, y: 180, regionIds: ['rb'], color: '#d7ad62', locked: false, order: 0 }]
  await page.evaluate(async ({ regions, entities, markers, b, image }) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['maps', 'regions', 'entities', 'markerPlacements', 'imagePlacements', 'projects'], 'readwrite')
    tx.objectStore('maps').add(b); tx.objectStore('imagePlacements').add({ ...image, id: 'image-b', mapId: b.id })
    for (const r of regions) tx.objectStore('regions').add(r)
    for (const e of entities) tx.objectStore('entities').add(e)
    for (const m of markers) tx.objectStore('markerPlacements').add(m)
    const request = tx.objectStore('projects').get(b.projectId); request.onsuccess = () => tx.objectStore('projects').put({ ...request.result, revision: request.result.revision + 1 })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) }); db.close()
  }, { regions, entities, markers, b, image: initial.images[0] })
  await page.reload(); await expect(button(page, 'Добавить область')).toBeEnabled()
  await expect(page.locator('.region-card')).toHaveCount(0); await expect(nav(page)).toBeHidden()
  return { a, b }
}

test('mode transition resolves dirty region/new marker drafts, retains camera/search/selection, and persists only confirmed settings', async ({ page }) => {
  await seed(page); await find(page, 'Области', 'r1')
  await nav(page).getByLabel('Поиск объектов').fill('ЗАЛ')
  await regionCard(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Название области', { exact: true }).fill('Черновик')
  await modeButton(page, 'Игра').click()
  const prompt = page.getByRole('dialog', { name: 'Несохранённые изменения области' })
  await prompt.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(page.getByLabel('Название области', { exact: true })).toHaveValue('Черновик')
  await failWrites(page, 'projects'); await modeButton(page, 'Игра').click()
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(prompt.getByRole('alert')).toContainText('Нет места')
  await expect(modeButton(page, 'Подготовка')).toHaveAttribute('aria-pressed', 'true')
  await restoreWrites(page)
  const before = await camera(page); await track(page)
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  await stable(page, before)
  await expect(regionCard(page).getByRole('heading', { name: '1. Черновик', exact: true })).toBeVisible()
  await expect(nav(page).getByLabel('Поиск объектов')).toHaveValue('ЗАЛ')
  expect((await stored(page)).regions.find((r) => r.id === 'r1')?.title).toBe('Черновик')
  await page.reload(); await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  await expect(nav(page)).toBeHidden(); await expect(page.locator('.region-card')).toHaveCount(0)
  await modeButton(page, 'Подготовка').click(); await expect(button(page, 'Добавить маркер')).toBeEnabled()
  await button(page, 'Добавить маркер').click(); await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: 'Противник', exact: true }).click()
  await clickWorld(page, { x: 450, y: 160 }); await page.getByLabel('Название маркера', { exact: true }).fill('Несохранённый')
  const saved = await stored(page); await modeButton(page, 'Игра').click()
  await page.getByRole('dialog', { name: 'Несохранённые изменения маркера' }).getByRole('button', { name: 'Отбросить изменения' }).click()
  await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.region-card')).toHaveCount(0); expect(await stored(page)).toEqual(saved)
  await modeButton(page, 'Подготовка').click(); await expect(modeButton(page, 'Подготовка')).toHaveAttribute('aria-pressed', 'true')
  await failWrites(page, 'settings'); await modeButton(page, 'Игра').click()
  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить режим')
  await expect(modeButton(page, 'Подготовка')).toHaveAttribute('aria-pressed', 'true')
  await restoreWrites(page); await button(page, 'Повторить выбор режима').click()
  await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
})

test('play locks buttons/canvas/context/keyboard and unfinished tools; cards render rich content/images in view; returning restores editing', async ({ page }) => {
  await seed(page)
  await button(page, 'Добавить область').click(); await clickWorld(page, { x: 40, y: 40 }); await clickWorld(page, { x: 90, y: 40 })
  const before = await stored(page)
  await modeButton(page, 'Игра').click(); await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.drawing-toolbar')).toHaveCount(0)
  for (const name of ['Добавить область', 'Добавить маркер', 'Заменить изображение', 'Удалить изображение']) await expect(button(page, name)).toBeDisabled()
  await canvas(page).click({ position: { x: 200, y: 40 }, button: 'right' }); await expect(page.getByRole('menu', { name: /Действия на карте/ })).toHaveCount(0)
  await canvas(page).focus(); for (const key of ['Enter', 'Delete', 'Control+z', 'Control+Shift+z', 'Control+y']) await page.keyboard.press(key)
  await button(page, 'Карты проекта').click()
  const menu = page.getByRole('menu', { name: 'Карты проекта' }); await expect(menu.getByRole('menuitem', { name: 'New map' })).toBeDisabled()
  for (const item of await menu.getByRole('menuitem', { name: /Переименовать|Удалить/ }).all()) await expect(item).toBeDisabled()
  await page.keyboard.press('Escape')
  const start = await screen(page, { x: 260, y: 120 }); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 80, start.y + 60, { steps: 8 }); await page.mouse.up()
  expect(await stored(page)).toEqual(before)
  await find(page, 'Области', 'r1')
  await expect(regionCard(page).getByRole('heading', { name: '1. Зал' })).toBeVisible()
  await expect(regionCard(page).getByRole('region', { name: 'Описание для игроков области' })).toContainText('Вы видите дверь.')
  const notes = regionCard(page).getByRole('region', { name: 'Заметки ведущего области' })
  await expect(notes.getByRole('heading', { name: 'Тайна ведущего' })).toBeVisible(); await expect(notes.locator('strong')).toHaveText('Жирный текст')
  await expect(notes.locator('em')).toHaveText(' и курсив'); await expect(notes.locator('ul')).toContainText('Список улик')
  await expect(notes.locator('blockquote')).toContainText('Цитата'); await expect(notes.getByRole('table')).toContainText('Таблица')
  await expect(notes.getByRole('img', { name: 'План комнаты' })).toBeVisible()
  await expect(regionCard(page)).toContainText('Внимание · СЛ 12'); await expect(regionCard(page)).toContainText('Заметили ловушку')
  await expect(regionCard(page).getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
  await expect(page.locator('[contenteditable=true]')).toHaveCount(0)
  await find(page, 'Области', 'empty'); await expect(regionCard(page)).toContainText('Карточка пока не заполнена')
  await expect(page.getByLabel('Название области', { exact: true })).toHaveCount(0)
  await modeButton(page, 'Подготовка').click()
  await regionCard(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Название области', { exact: true }).fill('Заполненная после игры')
  await regionCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(regionCard(page).getByRole('status')).toHaveText('Сохранено на устройстве')
  await button(page, 'Редактировать вершины').click(); await expect(page.locator('.card-map-tools button[aria-pressed=true]')).toHaveText('Закончить правку вершин')
  await modeButton(page, 'Игра').click(); await expect(page.locator('.card-map-tools')).toHaveCount(0)
  await modeButton(page, 'Подготовка').click(); await expect(button(page, 'Редактировать вершины')).toBeEnabled()
  await button(page, 'Закрыть карточку области').click(); await button(page, 'Добавить маркер').click()
  await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: 'Дверь', exact: true }).click()
  await modeButton(page, 'Игра').click(); await expect(page.locator('.canvas-host')).not.toHaveClass(/drawing/)
  await clickWorld(page, { x: 450, y: 170 }); expect((await stored(page)).markers).toHaveLength(3)
})

test('quick status/undo/redo are atomic, update every representation, preserve camera, reload and ZIP data without geometric undo', async ({ page }) => {
  const { a, b } = await seed(page); await find(page, 'Маркеры', 'm1')
  await button(page, 'Закрыть навигацию').click()
  await modeButton(page, 'Игра').click(); await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  const before = await stored(page); const cam = await camera(page)
  await failWrites(page, 'projects'); await markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true }).selectOption('defeated')
  await expect(markerCard(page).getByRole('status')).toContainText('Ошибка сохранения статуса')
  await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('alive')
  expect(await stored(page)).toEqual(before); await expect(button(page, 'Отменить статус')).toBeDisabled()
  await restoreWrites(page); await track(page); await button(page, 'Повторить смену статуса').click()
  await expect(markerCard(page).getByRole('status')).toHaveText('Сохранено на устройстве')
  await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('defeated'); await stable(page, cam)
  expect((await stored(page)).entities.find((e) => e.id === 'e2')?.status).toBe('alive')
  await expect(markerCard(page).getByRole('img', { name: 'План комнаты' })).toBeVisible()
  await markerCard(page).getByRole('button', { name: '1. Зал', exact: true }).click()
  await expect(regionCard(page).getByRole('button', { name: 'Первый страж · Повержен', exact: true })).toBeVisible()
  await regionCard(page).getByRole('button', { name: 'Первый страж · Повержен', exact: true }).click()
  const focused = await camera(page); await track(page)
  await canvas(page).focus(); await page.keyboard.press('Control+z')
  await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('alive')
  await page.keyboard.press('Control+Shift+z'); await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('defeated')
  await stable(page, focused)
  await find(page, 'Маркеры', 'm1'); await nav(page).getByRole('button', { name: /Фильтры и группировка/ }).click()
  await nav(page).getByLabel('Тип маркера в поиске').selectOption('enemy'); await nav(page).getByLabel('Статус маркера в поиске').selectOption('defeated')
  await expect(nav(page).getByText('Найдено: 2', { exact: true })).toBeVisible()
  await nav(page).locator('[data-object-id="mb"]').click(); await expect(canvas(page)).toHaveAttribute('data-map-id', b.id)
  await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('defeated')
  await expect(page.locator('.region-card')).toHaveCount(1)
  await button(page, 'Отменить статус').click(); await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('alive')
  await expect(nav(page).getByText('Найдено: 0', { exact: true })).toBeVisible()
  await button(page, 'Повторить статус').click(); await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('defeated')
  await switchMap(page, a.id); await expect(page.locator('.region-card')).toHaveCount(0)
  const saved = await stored(page)
  for (const key of ['regions', 'markers', 'images', 'assets', 'maps'] as const) expect(saved[key]).toEqual(before[key])
  const download = page.waitForEvent('download'); await clickMenuAction(page, 'Экспорт проекта'); const archive = await download
  const bytes = await readFile((await archive.path())!); const files = unzipSync(bytes)
  const document = JSON.parse(new TextDecoder().decode(files['project.json']))
  expect(document.entities.find((e: Entity) => e.id === 'e1').status).toBe('defeated'); expect(document).not.toHaveProperty('mode')
  await page.reload(); await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  await expect(button(page, 'Отменить статус')).toBeDisabled(); await find(page, 'Маркеры', 'm1')
  await expect(markerCard(page).getByRole('combobox', { name: 'Быстрая смена статуса', exact: true })).toHaveValue('defeated')
  await page.getByLabel('Архив проекта').setInputFiles({ name: 'copy.zip', mimeType: 'application/zip', buffer: bytes })
  await expect(modeButton(page, 'Подготовка')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.region-card')).toHaveCount(0)
  const imported = await stored(page); const copyProject = imported.projects.find((p) => p.id !== a.projectId)!
  const copyEntity = imported.entities.find((e) => e.projectId === copyProject.id && e.name === 'Первый страж')!
  expect(copyEntity.status).toBe('defeated'); expect(imported.markers.filter((m) => m.entityId === copyEntity.id)).toHaveLength(2)
  expect(copyEntity.description.content.at(-1)?.attrs?.assetId).not.toBe(document.entities[0].description.content.at(-1)?.attrs?.assetId)
})

test('play pan/zoom, map memory and search centering remain available without fitting or reopening an editor', async ({ page }) => {
  const { a, b } = await seed(page)
  await switchMap(page, b.id); await canvas(page).focus(); await page.keyboard.press('+'); await page.keyboard.press('ArrowLeft'); await paint(page)
  const targetCamera = await camera(page)
  await switchMap(page, a.id)
  await canvas(page).focus(); await page.keyboard.press('-'); await page.keyboard.press('ArrowRight'); await paint(page)
  await modeButton(page, 'Игра').click(); await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
  const before = await stored(page)
  await find(page, 'Области', 'r1'); await button(page, 'Закрыть навигацию').click(); await button(page, 'Закрыть карточку области').click()
  const panBefore = await camera(page); const p = await screen(page, { x: 140, y: 150 })
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 40, { steps: 8 }); await page.mouse.up(); await paint(page)
  await expect.poll(async () => Math.abs((await camera(page)).x - panBefore.x - 70)).toBeLessThan(.01)
  await expect(page.locator('.region-card')).toHaveCount(0)
  await canvas(page).focus(); await page.keyboard.press('+'); await paint(page)
  const currentCamera = await camera(page); expect(currentCamera.scale).toBeGreaterThan(panBefore.scale)
  const oldCanvas = await canvas(page).locator('canvas').first().elementHandle()
  await find(page, 'Области', 'rb'); await expect(canvas(page)).toHaveAttribute('data-map-id', b.id)
  const box = (await canvas(page).boundingBox())!; const target = await camera(page); const centered = worldToScreen({ x: 140, y: 150 }, target)
  expect(target.scale).toBe(targetCamera.scale); expect(centered.x).toBeCloseTo(box.width / 2, 5); expect(centered.y).toBeCloseTo(box.height / 2, 5)
  expect(await oldCanvas!.evaluate((node) => node.isConnected)).toBe(true)
  await expect(regionCard(page).getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
  await switchMap(page, a.id); expect(await camera(page)).toEqual(currentCamera)
  expect(await stored(page)).toEqual(before)
})

test.describe('touch', () => {
  test.use({ hasTouch: true })
  test('tap opens a play card without moving its object or entering editing', async ({ page }) => {
    await seed(page); await modeButton(page, 'Игра').click(); await expect(modeButton(page, 'Игра')).toHaveAttribute('aria-pressed', 'true')
    const before = await stored(page); const cam = await camera(page); const p = await screen(page, { x: 260, y: 120 })
    await page.touchscreen.tap(p.x, p.y); await expect(markerCard(page)).toBeVisible()
    await expect(markerCard(page).getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
    expect(await camera(page)).toEqual(cam); expect(await stored(page)).toEqual(before)
  })
})
