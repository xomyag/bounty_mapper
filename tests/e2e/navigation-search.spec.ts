import { finishProjectCreation } from './controls'
import { clickMenuAction, control } from './controls'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import type { Camera } from '../../src/domain/viewport'
import { centerOn, worldToScreen } from '../../src/domain/viewport'
import { emptyRegionContent, labelAnchor } from '../../src/domain/region'
import type { Region } from '../../src/domain/region'
import type { Entity, MarkerPlacement } from '../../src/domain/marker'
import type { Map, Project } from '../../src/domain/project'
import { emptyDocument } from '../../src/domain/richText'

type Frame = Camera & { mapId: string | null; hasImage: boolean; cards: number }
type TestWindow = { Konva: { stages: Konva.Stage[] }; frames: Frame[]; recording: boolean; originalCanvas: HTMLCanvasElement | null; originalPut: typeof IDBObjectStore.prototype.put }
const nav = (page: Page) => page.getByRole('complementary', { name: 'Навигация и поиск', exact: true })
const canvas = (page: Page) => page.getByRole('region', { name: 'Карта приключения', exact: true })
const card = (page: Page) => page.getByRole('region', { name: 'Карточка маркера', exact: true })
const regionCard = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })
const menu = (page: Page) => page.getByRole('menu', { name: 'Карты проекта', exact: true })
async function mapAction(page: Page, name: string, action: 'Удалить' | 'Переименовать') {
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click()
  await menu(page).getByRole('menuitem', { name: `${action} карту «${name}»`, exact: true }).click()
}
async function failWrites(page: Page) {
  await page.evaluate(() => { const w = window as unknown as TestWindow; w.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new Error('Нет места'); return w.originalPut.apply(this, args) } })
}
async function restoreWrites(page: Page) { await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as TestWindow).originalPut }) }
async function tagHistory(page: Page, projectId: string): Promise<string[]> {
  return page.evaluate(async (id) => { const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) }); const tx = db.transaction('settings'); const tags = await new Promise<string[]>((resolve) => { const r = tx.objectStore('settings').get(`tagHistory:${id}`); r.onsuccess = () => resolve(r.result ?? []) }); db.close(); return tags }, projectId)
}
async function imageData(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['assets', 'imagePlacements'])
    const assets = await new Promise<import('../../src/domain/project').Asset[]>((resolve) => { const r = tx.objectStore('assets').getAll(); r.onsuccess = () => resolve(r.result) })
    const placements = await new Promise<import('../../src/domain/project').ImagePlacement[]>((resolve) => { const r = tx.objectStore('imagePlacements').getAll(); r.onsuccess = () => resolve(r.result) })
    db.close(); return { placements, assets: await Promise.all(assets.map(async (asset) => ({ id: asset.id, checksum: asset.checksum, bytes: [...new Uint8Array(await asset.blob.arrayBuffer())] }))) }
  })
}
async function paint(page: Page) { await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function camera(page: Page): Promise<Camera> { return page.evaluate(() => { const s = (window as unknown as TestWindow).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX() } }) }
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['maps', 'projects', 'regions', 'entities', 'markerPlacements'], 'readonly')
    const get = <T,>(name: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result as T[]) })
    const [maps, projects, regions, entities, markers] = await Promise.all([get<Map>('maps'), get<Project>('projects'), get<Region>('regions'), get<Entity>('entities'), get<MarkerPlacement>('markerPlacements')]); db.close()
    return { maps, projects, regions, entities, markers }
  })
}
async function seed(page: Page) {
  await page.goto('/'); await expect(nav(page)).toHaveCount(0)
  await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Навигация')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await finishProjectCreation(page)
  async function upload(color: string) {
    const png = await page.evaluate((color) => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const ctx = c.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 600, 400); return c.toDataURL().split(',')[1] }, color)
    await expect(control(page, 'Загрузить карту')).toBeEnabled()
    await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  }
  await upload('#466778')
  await expect(nav(page)).toBeHidden(); await expect(page.locator('.region-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click()
  await page.getByRole('menuitem', { name: /Переименовать карту/ }).click()
  await page.getByLabel('Новое название карты').fill('Башня')
  await page.getByRole('button', { name: 'Переименовать карту', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Карты проекта', exact: true })).toContainText('Башня')
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New map', exact: true }).click()
  await page.getByLabel('Название новой карты').fill('Подвал')
  await page.getByRole('button', { name: 'Создать карту', exact: true }).click()
  await expect.poll(async () => (await stored(page)).maps.length).toBe(2)
  const maps = (await stored(page)).maps; const a = maps.find((m) => m.name === 'Башня')!; const b = maps.find((m) => m.name === 'Подвал')!
  await expect(canvas(page)).toHaveAttribute('data-map-id', b.id)
  await upload('#73564a')
  const regions: Region[] = [
    { ...emptyRegionContent(), id: 'a1', mapId: a.id, number: 12, title: 'Зал', titleCustomized: true, color: '#d7ad62', fillOpacity: .4, order: 0, tags: ['Тайна', 'Север'], vertices: [{ x: 50, y: 100 }, { x: 230, y: 100 }, { x: 230, y: 200 }, { x: 50, y: 200 }] },
    { ...emptyRegionContent(), id: 'a2', mapId: a.id, number: 14, title: 'Двор', titleCustomized: true, color: '#d7ad62', fillOpacity: .4, order: 1, tags: ['Север'], vertices: [{ x: 200, y: 150 }, { x: 360, y: 150 }, { x: 360, y: 270 }, { x: 200, y: 270 }] },
    { ...emptyRegionContent(), id: 'b1', mapId: b.id, number: 8, title: 'Подземелье', titleCustomized: true, color: '#d7ad62', fillOpacity: .4, order: 0, tags: ['Тайна'], vertices: [{ x: 600, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 600 }, { x: 600, y: 600 }] },
  ]
  const projectId = a.projectId
  const entities: Entity[] = [
    { checks: [], id: 'e1', projectId, kind: 'enemy', name: 'Страж башни', description: emptyDocument(), status: 'hidden', tags: ['Тайна', 'Север'] },
    { checks: [], id: 'e2', projectId, kind: 'enemy', name: 'Другой страж', description: emptyDocument(), status: 'alive', tags: ['Север'] },
    { checks: [], id: 'e3', projectId, kind: 'door', name: 'Ворота', description: emptyDocument(), status: 'hidden', tags: ['Ключ'] },
  ]
  const markers: MarkerPlacement[] = [
    { id: 'm1', entityId: 'e1', mapId: a.id, x: 260, y: 210, regionIds: ['a1', 'a2'], color: '#d7ad62', locked: false, order: 0 },
    { id: 'm2', entityId: 'e2', mapId: b.id, x: 850, y: 550, regionIds: ['b1'], color: '#d7ad62', locked: false, order: 0 },
    { id: 'm3', entityId: 'e3', mapId: a.id, x: 400, y: 250, regionIds: [], color: '#d7ad62', locked: false, order: 1 },
  ]
  await page.evaluate(async ({ regions, entities, markers, projectId }) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['regions', 'entities', 'markerPlacements', 'projects'], 'readwrite')
    for (const r of regions) tx.objectStore('regions').add(r)
    for (const e of entities) tx.objectStore('entities').add(e)
    for (const m of markers) tx.objectStore('markerPlacements').add(m)
    const request = tx.objectStore('projects').get(projectId)
    request.onsuccess = () => tx.objectStore('projects').put({ ...request.result, revision: request.result.revision + 1 })
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) }); db.close()
  }, { regions, entities, markers, projectId })
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить маркер', exact: true })).toBeEnabled()
  await expect(nav(page)).toBeHidden(); await expect(page.locator('.region-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Навигация и поиск', exact: true }).click()
  return { a, b, regions, markers, entities }
}
async function switchMap(page: Page, id: string) {
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click()
  await page.getByRole('menu', { name: 'Карты проекта', exact: true }).locator(`[data-map-id="${id}"]`).getByRole('menuitem', { name: /Перейти на карту/ }).click()
  await expect(canvas(page)).toHaveAttribute('data-map-id', id); await paint(page)
}
async function centered(page: Page, point: { x: number; y: number }, scale: number) {
  await expect.poll(async () => { const view = (await canvas(page).boundingBox())!; const cam = await camera(page); const screen = worldToScreen(point, cam); return Math.abs(screen.x - view.width / 2) + Math.abs(screen.y - view.height / 2) + Math.abs(cam.scale - scale) }).toBeLessThan(.01)
  await expect(page.locator('.region-card')).toHaveCount(1)
}

test('search and combined filters persist across tabs/close; multi-bound grouping counts placements once and opens one card', async ({ page }) => {
  const { a, regions, markers } = await seed(page); const before = await stored(page)
  await nav(page).getByLabel('Поиск объектов').fill('12'); await expect(nav(page).getByText('Найдено: 1', { exact: true })).toBeVisible()
  await nav(page).getByLabel('Поиск объектов').fill('ТАЙНА'); await nav(page).getByLabel('Область поиска').selectOption('project')
  await expect(nav(page).getByText('Найдено: 2', { exact: true })).toBeVisible()
  await expect(nav(page).getByLabel('Фильтр по карте')).toBeHidden()
  await nav(page).getByRole('button', { name: /Фильтры и группировка/ }).click()
  await nav(page).getByLabel('Фильтр по тегу «Тайна»').check(); await nav(page).getByLabel('Фильтр по тегу «Север»').check()
  await nav(page).getByLabel('Логика фильтра тегов').selectOption('all'); await expect(nav(page).getByText('Найдено: 1', { exact: true })).toBeVisible()
  await nav(page).getByLabel('Группировка результатов').selectOption('tag')
  await expect(nav(page).locator('[data-object-id="a1"]')).toHaveCount(2)
  await nav(page).getByRole('tab', { name: 'Маркеры', exact: true }).click(); await nav(page).getByLabel('Область поиска').selectOption('project')
  await nav(page).getByLabel('Тип маркера в поиске').selectOption('enemy'); await nav(page).getByLabel('Статус маркера в поиске').selectOption('hidden')
  await nav(page).getByLabel('Тип маркера в поиске').selectOption('boss'); await expect(nav(page).getByLabel('Статус маркера в поиске')).toHaveValue('hidden')
  await expect(nav(page).getByText('Найдено: 0', { exact: true })).toBeVisible(); await nav(page).getByLabel('Тип маркера в поиске').selectOption('enemy')
  await nav(page).getByLabel('Фильтр по карте').selectOption(a.id); await nav(page).getByLabel('Связанная область в поиске').selectOption('a2')
  await nav(page).getByLabel('Фильтр по тегу «Тайна»').check(); await nav(page).getByLabel('Фильтр по тегу «Север»').check(); await nav(page).getByLabel('Логика фильтра тегов').selectOption('all')
  await expect(nav(page).getByText('Найдено: 1', { exact: true })).toBeVisible()
  await nav(page).getByLabel('Поиск объектов').fill('несуществующий'); await expect(nav(page).getByText('Найдено: 0', { exact: true })).toBeVisible(); await expect(nav(page).getByText(/Ничего не найдено/)).toBeVisible()
  await nav(page).getByRole('button', { name: 'Сбросить фильтры', exact: true }).click(); await nav(page).getByLabel('Область поиска').selectOption('project'); await nav(page).getByLabel('Группировка результатов').selectOption('region')
  await expect(nav(page).getByText('Найдено: 3', { exact: true })).toBeVisible()
  await expect(nav(page).locator('[data-object-id="m1"]')).toHaveCount(2); await expect(nav(page).getByRole('heading', { name: 'Без области', exact: true })).toBeVisible()
  await page.evaluate(() => { (window as unknown as TestWindow).originalCanvas = document.querySelector('canvas') })
  const scale = (await camera(page)).scale
  await nav(page).locator('[data-object-id="m1"]').first().click(); await centered(page, markers[0], scale)
  await card(page).getByRole('region', { name: 'Связанные области' }).getByRole('button', { name: '12. Зал', exact: true }).click(); await centered(page, labelAnchor(regions[0].vertices), scale)
  await page.getByRole('region', { name: 'Связанные маркеры' }).getByRole('button', { name: 'Страж башни · Скрыт', exact: true }).click(); await centered(page, markers[0], scale)
  await nav(page).getByRole('tab', { name: 'Области', exact: true }).click()
  await expect(nav(page).getByLabel('Поиск объектов')).toHaveValue('ТАЙНА'); await expect(nav(page).getByLabel('Группировка результатов')).toHaveValue('tag'); await expect(nav(page).getByLabel('Логика фильтра тегов')).toHaveValue('all')
  await nav(page).getByRole('tab', { name: 'Маркеры', exact: true }).click(); await page.getByRole('button', { name: 'Закрыть навигацию' }).click()
  const closedCamera = await camera(page)
  await expect(nav(page)).toBeHidden(); await page.getByRole('button', { name: 'Навигация и поиск', exact: true }).click()
  await expect(nav(page).getByLabel('Группировка результатов')).toHaveValue('region')
  expect(await camera(page)).toEqual(closedCamera)
  expect(await page.evaluate(() => document.querySelector('canvas') === (window as unknown as TestWindow).originalCanvas)).toBe(true)
  expect(await stored(page)).toEqual(before)
})

test('map creation and rename preserve typed names and existing data after a late write error, then retry atomically', async ({ page }) => {
  await seed(page); const before = await stored(page)
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New map', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Новая карта', exact: true })
  await create.getByLabel('Название новой карты').fill('Новая карта')
  const failWrites = async () => page.evaluate(() => { const w = window as unknown as TestWindow; w.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new Error('Нет места для карты'); return w.originalPut.apply(this, args) } })
  const restoreWrites = async () => page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as TestWindow).originalPut })
  await failWrites(); await create.getByRole('button', { name: 'Создать карту', exact: true }).click()
  await expect(create.getByRole('alert')).toContainText('Нет места для карты')
  await expect(create.getByLabel('Название новой карты')).toHaveValue('Новая карта'); expect(await stored(page)).toEqual(before)
  await restoreWrites(); await create.getByRole('button', { name: 'Создать карту', exact: true }).click()
  await expect.poll(async () => (await stored(page)).maps.length).toBe(3)
  const created = (await stored(page)).maps.find((m) => m.name === 'Новая карта')!
  await expect(canvas(page)).toHaveAttribute('data-map-id', created.id); await expect(create).toBeHidden()
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click()
  await page.getByRole('menuitem', { name: /Переименовать карту «Новая карта»/ }).click()
  const rename = page.getByRole('dialog', { name: 'Переименование карты', exact: true })
  await rename.getByLabel('Новое название карты').fill('Переименованная карта'); const saved = await stored(page)
  await failWrites(); await rename.getByRole('button', { name: 'Переименовать карту', exact: true }).click()
  await expect(rename.getByRole('alert')).toContainText('Нет места для карты')
  await expect(rename.getByLabel('Новое название карты')).toHaveValue('Переименованная карта'); expect(await stored(page)).toEqual(saved)
  await restoreWrites(); await rename.getByRole('button', { name: 'Переименовать карту', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Карты проекта', exact: true })).toContainText('Переименованная карта')
  const after = await stored(page); expect(after.markers).toEqual(before.markers); expect(after.entities).toEqual(before.entities); expect(after.regions).toEqual(before.regions)
  await nav(page).getByRole('tab', { name: 'Области', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  await expect(nav(page).getByRole('tab', { name: 'Маркеры', exact: true })).toHaveAttribute('aria-selected', 'true')
  await nav(page).getByLabel('Поиск объектов').focus(); await page.keyboard.press('Escape'); await expect(nav(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Навигация и поиск', exact: true })).toBeFocused()
})

test('cross-map results preserve target zoom and center without intermediate fit; dirty transitions and direct clicks preserve data/view', async ({ page }) => {
  const { a, b, markers } = await seed(page)
  await nav(page).getByRole('tab', { name: 'Маркеры', exact: true }).click(); await nav(page).getByLabel('Область поиска').selectOption('project')
  await canvas(page).focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('+'); await paint(page)
  const cameraA = await camera(page)
  await switchMap(page, b.id); await canvas(page).focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('-'); await paint(page)
  const cameraB = await camera(page)
  await switchMap(page, a.id); expect(await camera(page)).toEqual(cameraA)
  await nav(page).getByLabel('Поиск объектов').fill('ДРУГОЙ')
  const view = (await canvas(page).boundingBox())!; const expectedB = centerOn(cameraB, markers[1], view)
  await page.evaluate(() => {
    const w = window as unknown as TestWindow; w.frames = []; w.recording = true; w.originalCanvas = document.querySelector('canvas')
    const record = () => { if (!w.recording) return; const s = w.Konva.stages[0]; w.frames.push({ x: s.x(), y: s.y(), scale: s.scaleX(), mapId: document.querySelector('[aria-label="Карта приключения"]')!.getAttribute('data-map-id'), hasImage: !!s.findOne('Image'), cards: document.querySelectorAll('.region-card').length }); requestAnimationFrame(record) }; requestAnimationFrame(record)
  })
  await nav(page).locator('[data-object-id="m2"]').click(); await centered(page, markers[1], cameraB.scale); await paint(page)
  const frames = await page.evaluate(() => { const w = window as unknown as TestWindow; w.recording = false; return w.frames })
  expect(frames.some((f) => f.mapId === b.id)).toBe(true)
  for (const frame of frames) {
    const expected = frame.mapId === a.id ? cameraA : expectedB
    expect(frame.scale).toBeCloseTo(expected.scale, 8); expect(frame.x).toBeCloseTo(expected.x, 6); expect(frame.y).toBeCloseTo(expected.y, 6)
    expect(frame.hasImage).toBe(true); expect(frame.cards).toBeLessThanOrEqual(1)
  }
  expect(await page.evaluate(() => document.querySelector('canvas') === (window as unknown as TestWindow).originalCanvas)).toBe(true)
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await canvas(page).focus(); await page.keyboard.press('ArrowRight'); const directCamera = await camera(page)
  const point = worldToScreen(markers[1], directCamera); const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + point.x, box.y + point.y); await expect(card(page)).toBeVisible(); expect(await camera(page)).toEqual(directCamera)
  await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название маркера').fill('Черновик второго')
  await nav(page).getByLabel('Поиск объектов').fill('Страж башни'); await nav(page).locator('[data-object-id="m1"]').click()
  const prompt = page.getByRole('dialog', { name: 'Несохранённые изменения маркера' }); await expect(prompt).toBeVisible()
  expect(await camera(page)).toEqual(directCamera); await prompt.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(page.getByLabel('Название маркера')).toHaveValue('Черновик второго')
  await nav(page).locator('[data-object-id="m1"]').click()
  await page.evaluate(() => { const w = window as unknown as TestWindow; w.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new Error('Отказ перехода'); return w.originalPut.apply(this, args) } })
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click(); await expect(prompt.getByRole('alert')).toContainText('Отказ перехода')
  await expect(canvas(page)).toHaveAttribute('data-map-id', b.id); expect(await camera(page)).toEqual(directCamera); expect((await stored(page)).entities.find((e) => e.id === 'e2')?.name).toBe('Другой страж')
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as TestWindow).originalPut })
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click(); await centered(page, markers[0], cameraA.scale)
  await expect(canvas(page)).toHaveAttribute('data-map-id', a.id); expect((await stored(page)).entities.find((e) => e.id === 'e2')?.name).toBe('Черновик второго')
  await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название маркера').fill('Изменённый страж')
  const savedCamera = await camera(page); await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  expect(await camera(page)).toEqual(savedCamera)
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить маркер', exact: true })).toBeEnabled(); await expect(nav(page)).toBeHidden(); await expect(page.locator('.region-card')).toHaveCount(0)
  expect((await stored(page)).markers).toEqual(markers)
})

test('header actions do not switch on rename/delete; confirmation, atomic failure, current/other/last deletion preserve data and cameras', async ({ page }) => {
  const { a, b, entities, regions, markers } = await seed(page)
  await canvas(page).focus(); await page.keyboard.press('+'); await page.keyboard.press('ArrowRight'); const cameraA = await camera(page)
  await switchMap(page, b.id); await canvas(page).focus(); await page.keyboard.press('-'); await page.keyboard.press('ArrowLeft'); const cameraB = await camera(page)
  await switchMap(page, a.id)
  const before = await stored(page); const images = await imageData(page)
  await mapAction(page, 'Подвал', 'Переименовать')
  await expect(canvas(page)).toHaveAttribute('data-map-id', a.id); expect(await camera(page)).toEqual(cameraA)
  await page.getByLabel('Новое название карты').fill('Нижний этаж'); await page.getByRole('button', { name: 'Переименовать карту', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Карты проекта', exact: true })).toContainText('Башня')
  await nav(page).getByRole('button', { name: /Фильтры и группировка/ }).click(); await expect(nav(page).getByLabel('Фильтр по карте')).toContainText('Нижний этаж')
  await nav(page).getByLabel('Область поиска').selectOption('project'); await nav(page).getByLabel('Фильтр по карте').selectOption(b.id)
  await expect(canvas(page)).toHaveAttribute('data-map-id', a.id); await expect(nav(page).getByText('Найдено: 1', { exact: true })).toBeVisible()
  expect(await camera(page)).toEqual(cameraA)
  await mapAction(page, 'Нижний этаж', 'Удалить')
  const deletion = page.getByRole('dialog', { name: 'Удаление карты', exact: true })
  await expect(deletion).toContainText('Нижний этаж'); await expect(deletion).toContainText('размещения маркеров')
  await deletion.getByRole('button', { name: 'Отмена', exact: true }).click()
  const renamed = await stored(page); expect(renamed.maps).toHaveLength(2); expect(await imageData(page)).toEqual(images); expect(await camera(page)).toEqual(cameraA)
  await mapAction(page, 'Нижний этаж', 'Удалить'); await failWrites(page)
  await deletion.getByRole('button', { name: 'Удалить карту', exact: true }).click(); await expect(deletion.getByRole('alert')).toContainText('Нет места')
  expect(await stored(page)).toEqual(renamed); expect(await imageData(page)).toEqual(images); expect(await camera(page)).toEqual(cameraA)
  await restoreWrites(page); await deletion.getByRole('button', { name: 'Удалить карту', exact: true }).click()
  await expect(deletion).toBeHidden(); await expect(canvas(page)).toHaveAttribute('data-map-id', a.id); expect(await camera(page)).toEqual(cameraA)
  await expect(nav(page).getByLabel('Фильтр по карте')).toContainText('Карта удалена'); await expect(nav(page).getByText('Найдено: 0', { exact: true })).toBeVisible()
  await nav(page).getByRole('button', { name: 'Сбросить фильтры', exact: true }).click(); await expect(nav(page).getByLabel('Фильтр по карте')).toHaveValue('')
  expect((await stored(page)).regions).toEqual(regions.filter((r) => r.mapId === a.id)); expect((await stored(page)).markers).toEqual(markers.filter((m) => m.mapId === a.id)); expect((await stored(page)).entities).toEqual(entities)
  expect((await imageData(page)).placements).toEqual(images.placements.filter((p) => p.mapId === a.id))
  // Re-create a destination to check deletion of the active map without an intermediate fit.
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click(); await menu(page).getByRole('menuitem', { name: 'New map' }).click()
  await page.getByLabel('Название новой карты').fill('Следующая'); await page.getByRole('button', { name: 'Создать карту', exact: true }).click()
  const next = (await stored(page)).maps.find((m) => m.name === 'Следующая')!
  await expect(canvas(page)).toHaveAttribute('data-map-id', next.id); await canvas(page).focus(); await page.keyboard.press('+'); await page.keyboard.press('ArrowLeft'); const cameraNext = await camera(page)
  await switchMap(page, a.id); await nav(page).locator('[data-object-id="a1"]').first().click(); await expect(regionCard(page)).toBeVisible()
  await mapAction(page, 'Башня', 'Удалить'); await deletion.getByRole('button', { name: 'Удалить карту', exact: true }).click()
  await expect(canvas(page)).toHaveAttribute('data-map-id', next.id); await expect(page.locator('.region-card')).toHaveCount(0); expect(await camera(page)).toEqual(cameraNext)
  await mapAction(page, 'Следующая', 'Удалить'); await deletion.getByRole('button', { name: 'Отмена', exact: true }).click(); await expect(canvas(page)).toBeVisible()
  await mapAction(page, 'Следующая', 'Удалить'); await deletion.getByRole('button', { name: 'Удалить карту', exact: true }).click()
  await expect(canvas(page)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Создать карту', exact: true })).toBeVisible()
  expect((await stored(page)).maps).toEqual([]); expect((await stored(page)).markers).toEqual([]); expect((await stored(page)).entities).toEqual(before.entities)
  expect((await imageData(page)).assets).toEqual([])
  await page.reload(); await expect(page.getByRole('button', { name: 'Создать карту', exact: true })).toBeEnabled(); await expect(nav(page)).toBeHidden()
  await page.getByRole('button', { name: 'Создать карту', exact: true }).click(); await page.getByLabel('Название новой карты').fill('Снова карта'); await page.getByRole('dialog', { name: 'Новая карта', exact: true }).getByRole('button', { name: 'Создать карту', exact: true }).click()
  await expect(canvas(page)).toBeVisible(); await expect(page.getByRole('button', { name: 'Карты проекта', exact: true })).toContainText('Снова карта')
  expect(cameraB.scale).not.toBe(cameraA.scale)
})

test('shared tag suggestions normalize spelling, consume keyboard actions, persist only successful saves, and survive reload/archives', async ({ page }, info) => {
  const { a } = await seed(page)
  await nav(page).locator('[data-object-id="a1"]').click(); await regionCard(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  const tag = page.getByRole('combobox', { name: 'Новый тег', exact: true })
  await tag.focus(); await expect(page.getByRole('option', { name: 'Ключ', exact: true })).toBeVisible()
  await tag.fill('ловушка'); await tag.press('Enter'); await expect(regionCard(page).getByRole('button', { name: 'Удалить тег «ловушка»' })).toBeVisible()
  await tag.fill(' ЛОВУШКА '); await tag.press('Enter'); await expect(regionCard(page).getByRole('button', { name: 'Удалить тег «ловушка»' })).toHaveCount(1)
  await tag.fill('КЛ'); await expect(page.getByRole('option', { name: 'Ключ', exact: true })).toBeVisible(); await tag.press('ArrowDown'); await tag.press('Enter')
  await expect(tag).toHaveValue(''); await tag.press('ArrowUp'); await tag.press('Escape'); await expect(page.getByRole('listbox', { name: 'Подсказки тегов' })).toHaveCount(0)
  await expect(regionCard(page)).toBeVisible(); await expect(regionCard(page).getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible()
  expect(await tagHistory(page, a.projectId)).toEqual([])
  await failWrites(page); const view = await camera(page); await regionCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(regionCard(page).getByRole('alert')).toContainText('Нет места'); expect(await tagHistory(page, a.projectId)).toEqual([]); expect(await camera(page)).toEqual(view)
  await restoreWrites(page); await regionCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(regionCard(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  expect(await tagHistory(page, a.projectId)).toEqual(['Ключ', 'ловушка', 'Север', 'Тайна']); expect(await camera(page)).toEqual(view)
  await nav(page).getByRole('tab', { name: 'Маркеры', exact: true }).click(); await nav(page).locator('[data-object-id="m3"]').click(); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await tag.focus(); await expect(page.getByRole('listbox', { name: 'Подсказки тегов' }).getByRole('option').first()).toHaveText('ловушка'); await tag.fill(' ЛОВУШ'); await tag.press('ArrowDown'); await tag.press('Enter')
  await expect(card(page).getByRole('button', { name: 'Удалить тег «ловушка»' })).toBeVisible(); await card(page).getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(await tagHistory(page, a.projectId)).toEqual(['Ключ', 'ловушка', 'Север', 'Тайна'])
  await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await tag.fill(' ЛОВУШКА '); await tag.press('Enter'); await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible(); expect((await stored(page)).entities.find((e) => e.id === 'e3')!.tags).toEqual(['Ключ', 'ловушка'])
  expect(await tagHistory(page, a.projectId)).toEqual(['ловушка', 'Ключ', 'Север', 'Тайна'])
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить маркер', exact: true })).toBeEnabled(); await expect(nav(page)).toBeHidden()
  expect(await tagHistory(page, a.projectId)).toEqual(['ловушка', 'Ключ', 'Север', 'Тайна'])
  await page.getByRole('button', { name: 'Навигация и поиск', exact: true }).click(); await nav(page).locator('[data-object-id="a2"]').click(); await regionCard(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await tag.focus(); await expect(page.getByRole('listbox', { name: 'Подсказки тегов' }).getByRole('option').first()).toHaveText('ловушка'); await regionCard(page).getByRole('button', { name: 'Отмена', exact: true }).click()
  const downloading = page.waitForEvent('download'); await clickMenuAction(page, 'Экспорт проекта')
  const path = info.outputPath('tags.zip'); await (await downloading).saveAs(path)
  const entries = unzipSync(new Uint8Array(await readFile(path))); const document = JSON.parse(new TextDecoder().decode(entries['project.json']))
  expect(document.regions.find((r: Region) => r.id === 'a1').tags).toEqual(['Тайна', 'Север', 'ловушка', 'Ключ']); expect(document.entities.find((e: Entity) => e.id === 'e3').tags).toEqual(['Ключ', 'ловушка']); expect(document.settings).toBeUndefined()
  await page.getByLabel('Архив проекта').setInputFiles(path); await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible()
  await expect(nav(page)).toBeHidden(); await page.getByRole('button', { name: 'Навигация и поиск', exact: true }).click()
  const all = await stored(page); const copy = all.projects.find((p) => p.id !== a.projectId)!
  expect(await tagHistory(page, copy.id)).toEqual([]); await nav(page).getByLabel('Поиск объектов').fill('14'); await nav(page).locator('[data-object-id]').click()
  await regionCard(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await tag.focus(); await expect(page.getByRole('listbox', { name: 'Подсказки тегов' }).getByRole('option').first()).toHaveText('Ключ')
  expect((await imageData(page)).assets).toHaveLength(4)
})

test('map menu is available by keyboard and touch, and dirty switching closes only after the explicit choice', async ({ page, browser }) => {
  const { a, b } = await seed(page)
  await nav(page).getByRole('tab', { name: 'Маркеры', exact: true }).click(); await nav(page).locator('[data-object-id="m1"]').click(); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название маркера').fill('Несохранённый страж')
  const trigger = page.getByRole('button', { name: 'Карты проекта', exact: true }); await trigger.focus(); await trigger.press('ArrowDown')
  await expect(menu(page).getByRole('menuitem', { name: 'New map' })).toBeDisabled(); await expect(menu(page).getByRole('menuitem', { name: 'Перейти на карту «Башня»' })).toBeFocused()
  await page.keyboard.press('End'); await expect(menu(page).getByRole('menuitem', { name: 'Перейти на карту «Подвал»' })).toBeFocused(); await page.keyboard.press('Enter')
  const prompt = page.getByRole('dialog', { name: 'Несохранённые изменения маркера' }); await expect(prompt).toBeVisible(); await expect(canvas(page)).toHaveAttribute('data-map-id', a.id)
  await prompt.getByRole('button', { name: 'Продолжить редактирование' }).click(); await expect(page.getByLabel('Название маркера')).toHaveValue('Несохранённый страж')
  await switchMapRequest(page, b.id); await prompt.getByRole('button', { name: 'Отбросить изменения' }).click(); await expect(canvas(page)).toHaveAttribute('data-map-id', b.id); await expect(page.locator('.region-card')).toHaveCount(0)
  expect((await stored(page)).entities.find((e) => e.id === 'e1')!.name).toBe('Страж башни')
  const touch = await browser.newContext({ hasTouch: true, baseURL: new URL(page.url()).origin, viewport: { width: 640, height: 900 } })
  try {
    const touchPage = await touch.newPage(); const { a: touchMap } = await seed(touchPage)
    await touchPage.getByRole('button', { name: 'Карты проекта', exact: true }).tap()
    await menu(touchPage).getByRole('menuitem', { name: 'Переименовать карту «Подвал»', exact: true }).tap()
    await expect(canvas(touchPage)).toHaveAttribute('data-map-id', touchMap.id)
    await touchPage.getByLabel('Новое название карты').fill('Сенсорная карта'); await touchPage.getByRole('button', { name: 'Переименовать карту', exact: true }).tap()
    await touchPage.getByRole('button', { name: 'Карты проекта', exact: true }).tap(); await menu(touchPage).getByRole('menuitem', { name: 'Удалить карту «Сенсорная карта»', exact: true }).tap()
    await touchPage.getByRole('dialog', { name: 'Удаление карты' }).getByRole('button', { name: 'Отмена', exact: true }).tap()
    await expect(canvas(touchPage)).toHaveAttribute('data-map-id', touchMap.id)
  } finally { await touch.close() }
})

async function switchMapRequest(page: Page, id: string) {
  await page.getByRole('button', { name: 'Карты проекта', exact: true }).click(); await menu(page).locator(`[data-map-id="${id}"]`).getByRole('menuitem', { name: /Перейти на карту/ }).click()
}
