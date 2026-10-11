import { finishProjectCreation } from './controls'
import { clickMenuAction } from './controls'
import { Buffer } from 'node:buffer'
import { expect } from '@playwright/test'
import { test, configureRussianLocale } from './testLocale'
import type { Page } from '@playwright/test'
import type { Entity, MarkerPlacement } from '../../src/domain/marker'
import type { Region } from '../../src/domain/region'
import { fitBounds, screenToWorld, worldToScreen, zoomAt } from '../../src/domain/viewport'
import type { Camera } from '../../src/domain/viewport'
import { labelAnchor } from '../../src/domain/region'
import type Konva from 'konva'

type CanvasWindow = { Konva: { stages: Konva.Stage[] }; cameraTrail?: Camera[]; trackCamera?: boolean }
async function currentCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => { const stage = (window as unknown as CanvasWindow).Konva.stages[0]; return { x: stage.x(), y: stage.y(), scale: stage.scaleX() } })
}
async function clickWorld(page: Page, point: { x: number; y: number }) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  const screen = worldToScreen(point, await currentCamera(page))
  await page.mouse.click(box.x + screen.x, box.y + screen.y)
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['regions', 'entities', 'markerPlacements', 'assets'], 'readonly')
    const get = <T,>(name: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result as T[]) })
    const [regions, entities, markers, assets] = await Promise.all([get<Region>('regions'), get<Entity>('entities'), get<MarkerPlacement>('markerPlacements'), get<{ id: string }>('assets')]); db.close()
    return { regions, entities, markers, assets }
  })
}
async function seed(page: Page, withArea = true) {
  await page.goto('/'); await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Маркеры')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await finishProjectCreation(page)
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const ctx = c.getContext('2d')!; ctx.fillStyle = '#466778'; ctx.fillRect(0, 0, 400, 300); return c.toDataURL().split(',')[1] })
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('button', { name: 'Добавить маркер', exact: true })).toBeEnabled()
  const box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  if (withArea) {
    await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
    for (const [x, y] of [[120, 130], [320, 130], [320, 330], [120, 330]]) await page.mouse.click(box.x + x, box.y + y)
    await page.keyboard.press('Enter'); await expect.poll(async () => (await stored(page)).regions.length).toBe(1)
  }
  return { box, png }
}
const card = (page: Page) => page.getByRole('region', { name: 'Карточка маркера', exact: true })
async function place(page: Page, box: { x: number; y: number }, kind = 'Противник', x = 220, y = 230) {
  await page.getByRole('button', { name: 'Добавить маркер', exact: true }).click()
  await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: kind, exact: true }).click()
  await page.mouse.click(box.x + x, box.y + y)
  await expect(page.getByLabel('Название маркера')).toBeVisible()
  await expect(page.locator('.region-card')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Карточка области', exact: true })).toHaveCount(0)
}
async function save(page: Page) {
  await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  await expect(card(page).getByRole('status')).toHaveText('Сохранено на устройстве')
}
async function goldBounds(page: Page) {
  return page.locator('canvas').evaluate((node) => {
    const c = node as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let left = c.width; let right = -1; let top = c.height; let bottom = -1
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] === 215 && d[i + 1] === 173 && d[i + 2] === 98 && d[i + 3] === 255) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) } }
    return { left, top, width: right - left + 1, height: bottom - top + 1 }
  })
}

test('new marker cancel is empty; independent enemies, shared panel, explicit binding and region links survive reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  const { box } = await seed(page)
  await place(page, box)
  await expect(page.getByRole('group', { name: 'Привязки к областям' }).getByRole('checkbox', { checked: true })).toHaveCount(0)
  expect((await stored(page)).markers).toEqual([]); expect((await stored(page)).entities).toEqual([])
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(card(page)).toHaveCount(0); expect((await stored(page)).entities).toEqual([])
  await place(page, box); await page.getByLabel('Название маркера').fill('Страж')
  const r = (await stored(page)).regions[0]
  await page.getByLabel(`Привязать к области «${r.number}. ${r.title}»`).check()
  await page.getByLabel('Статус маркера').selectOption('hidden'); await save(page)
  const first = (await stored(page)).markers[0]
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await page.mouse.move(box.x + 220, box.y + 230)
  await expect(page.getByRole('tooltip')).toContainText('Страж'); await expect(page.getByRole('tooltip')).toContainText('Скрыт')
  await place(page, box, 'Противник', 500, 230); await page.getByLabel('Название маркера').fill('Другой страж'); await save(page)
  const saved = await stored(page); expect(saved.entities).toHaveLength(2)
  expect(saved.entities.find((e) => e.id === first.entityId)?.status).toBe('hidden')
  expect(saved.entities.find((e) => e.id !== first.entityId)?.status).toBe('alive')
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await page.mouse.click(box.x + 180, box.y + 200)
  await page.getByRole('region', { name: 'Связанные маркеры' }).getByRole('button', { name: 'Страж · Скрыт' }).click()
  await expect(card(page).getByRole('heading', { name: 'Страж', exact: true })).toBeVisible()
  await expect(page.locator('.region-card')).toHaveCount(1)
  // Link navigation centers the first marker. Pan to expose the second marker
  // beside the open panel before testing a direct canvas-card transition.
  await page.getByRole('region', { name: 'Карта приключения' }).focus()
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
  await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByRole('textbox', { name: 'Описание маркера', exact: true }).fill('Текст первого при быстром переключении')
  await clickWorld(page, saved.markers.find((m) => m.id !== first.id)!)
  const switching = page.getByRole('dialog', { name: 'Несохранённые изменения маркера' })
  await expect(switching).toBeVisible(); await switching.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(page.getByRole('textbox', { name: 'Описание маркера', exact: true })).toContainText('Текст первого при быстром переключении')
  await clickWorld(page, saved.markers.find((m) => m.id !== first.id)!); await switching.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(card(page).getByRole('heading', { name: 'Другой страж', exact: true })).toBeVisible()
  const switched = await stored(page)
  expect(switched.entities.find((e) => e.id !== first.entityId)?.description).toEqual(saved.entities.find((e) => e.id !== first.entityId)?.description)
  saved.entities = switched.entities
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await clickWorld(page, { x: r.vertices[0].x * .7 + r.vertices[2].x * .3, y: r.vertices[0].y * .7 + r.vertices[2].y * .3 })
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить область', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions.length).toBe(0)
  expect((await stored(page)).markers.find((m) => m.id === first.id)?.regionIds).toEqual([])
  expect((await stored(page)).entities).toEqual(saved.entities)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).markers.find((m) => m.id === first.id)?.regionIds).toEqual([r.id])
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить маркер', exact: true })).toBeEnabled(); await expect(page.locator('.region-card')).toHaveCount(0)
  const fresh = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.mouse.click(fresh.x + 220, fresh.y + 230)
  await expect(card(page).locator('.marker-status')).toContainText('Скрыт')
  expect((await stored(page)).entities).toEqual(saved.entities); expect(errors).toEqual([])
})

test('card links navigate both ways and center without changing zoom; stay and failed saves preserve the view', async ({ page }) => {
  const { box } = await seed(page)
  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  for (const [x, y] of [[450, 130], [650, 130], [650, 330], [450, 330]]) await page.mouse.click(box.x + x, box.y + y)
  await page.keyboard.press('Enter'); await expect.poll(async () => (await stored(page)).regions.length).toBe(2)
  await place(page, box, 'NPC', 500, 450)
  await page.getByLabel('Название маркера').fill('Проводник')
  const regions = (await stored(page)).regions.sort((a, b) => a.number - b.number)
  for (const r of regions) await page.getByLabel(`Привязать к области «${r.number}. ${r.title}»`).check()
  await save(page)
  const original = await stored(page); const marker = original.markers[0]
  const linkedAreas = () => page.getByRole('region', { name: 'Связанные области' })
  const linkedMarkers = () => page.getByRole('region', { name: 'Связанные маркеры' })
  const regionCard = page.getByRole('region', { name: 'Карточка области', exact: true })
  const expectCentered = async (point: { x: number; y: number }, scale: number) => {
    await expect.poll(async () => {
      const view = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
      const camera = await currentCamera(page); const screen = worldToScreen(point, camera)
      return Math.abs(screen.x - view.width / 2) + Math.abs(screen.y - view.height / 2) + Math.abs(camera.scale - scale)
    }).toBeLessThan(.01)
    await expect(page.locator('.region-card')).toHaveCount(1)
  }
  await page.mouse.move(box.x + 500, box.y + 350); await page.mouse.wheel(0, 150)
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight')
  const scale = (await currentCamera(page)).scale
  await expect(linkedAreas().getByRole('button')).toHaveCount(2)
  await linkedAreas().getByRole('button', { name: `${regions[0].number}. ${regions[0].title}`, exact: true }).click()
  await expectCentered(labelAnchor(regions[0].vertices), scale)
  const regionCamera = await currentCamera(page)
  await page.getByLabel('Название области').fill('Несохранённая область')
  await linkedMarkers().getByRole('button', { name: 'Проводник · На месте', exact: true }).click()
  const regionPrompt = page.getByRole('dialog', { name: 'Несохранённые изменения области' })
  await expect(regionPrompt).toBeVisible(); expect(await currentCamera(page)).toEqual(regionCamera)
  await regionPrompt.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(page.getByLabel('Название области')).toHaveValue('Несохранённая область')
  await linkedMarkers().getByRole('button', { name: 'Проводник · На месте', exact: true }).click()
  await regionPrompt.getByRole('button', { name: 'Отбросить изменения' }).click()
  await expectCentered(marker, scale); expect(await stored(page)).toEqual(original)
  await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Название маркера').fill('Сохранённый проводник')
  const markerCamera = await currentCamera(page)
  await linkedAreas().getByRole('button', { name: `${regions[1].number}. ${regions[1].title}`, exact: true }).click()
  const markerPrompt = page.getByRole('dialog', { name: 'Несохранённые изменения маркера' })
  await expect(markerPrompt).toBeVisible(); expect(await currentCamera(page)).toEqual(markerCamera)
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; Object.defineProperty(window, '__markerPut', { value: put }); IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Ошибка перехода', 'QuotaExceededError'); return put.apply(this, args) } })
  await markerPrompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(markerPrompt.getByRole('alert')).toContainText('Ошибка перехода')
  expect(await currentCamera(page)).toEqual(markerCamera); expect(await stored(page)).toEqual(original)
  await expect(page.getByLabel('Название маркера')).toHaveValue('Сохранённый проводник')
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __markerPut: typeof IDBObjectStore.prototype.put }).__markerPut })
  await markerPrompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expectCentered(labelAnchor(regions[1].vertices), scale)
  await expect(regionCard.getByRole('heading', { level: 2 })).toHaveText(`${regions[1].number}. ${regions[1].title}`)
  await linkedMarkers().getByRole('button', { name: 'Сохранённый проводник · На месте', exact: true }).click()
  await expectCentered(marker, scale)
  const centered = await currentCamera(page)
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  expect(await currentCamera(page)).toEqual(centered)
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight')
  const panned = await currentCamera(page)
  await page.setViewportSize({ width: 1100, height: 760 })
  await expect.poll(() => currentCamera(page)).toEqual(panned)
  await page.getByRole('button', { name: 'Показать всю карту', exact: true }).click()
  await expect.poll(async () => (await currentCamera(page)).scale).not.toBe(scale)
  const fitted = await currentCamera(page)
  await page.setViewportSize({ width: 1200, height: 800 })
  await expect.poll(() => currentCamera(page)).toEqual(fitted)
})

test('marker size is constant under zoom; drag transforms coordinates, one undo, lock and deletion retain entity', async ({ page }) => {
  const { box } = await seed(page, false); await place(page, box); await save(page)
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  const original = (await stored(page)).markers[0]
  await expect.poll(async () => (await goldBounds(page)).width).toBeGreaterThan(30)
  const beforeSize = await goldBounds(page)
  const initialCamera = fitBounds({ x: 0, y: 0, width: 400, height: 300 }, box)
  await page.mouse.move(box.x + 500, box.y + 350); await page.mouse.wheel(0, 120)
  const camera = zoomAt(initialCamera, { x: 500, y: 350 }, initialCamera.scale * Math.exp(-120 * .002))
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight'); camera.x -= 40
  const point = worldToScreen(original, camera)
  await expect.poll(async () => Math.abs((await goldBounds(page)).width - beforeSize.width)).toBeLessThanOrEqual(1)
  await page.mouse.move(box.x + point.x, box.y + point.y); await page.mouse.down(); await page.mouse.move(box.x + point.x + 40, box.y + point.y + 10, { steps: 12 }); await page.mouse.up()
  await expect.poll(async () => (await stored(page)).markers[0].x).toBeCloseTo(original.x + 40 / camera.scale)
  await expect(card(page)).toHaveCount(0)
  const moved = (await stored(page)).markers[0]
  expect(moved.y).toBeCloseTo(original.y + 10 / camera.scale)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect.poll(async () => (await stored(page)).markers[0]).toEqual(original)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect.poll(async () => (await stored(page)).markers[0]).toEqual(moved)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const now = worldToScreen(moved, camera)
  await page.mouse.click(box.x + now.x, box.y + now.y); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Закрепить положение').check(); await save(page); await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const lockedBounds = await goldBounds(page)
  await page.mouse.move(box.x + now.x, box.y + now.y); await page.mouse.down(); await page.mouse.move(box.x + now.x + 40, box.y + now.y + 10, { steps: 12 }); await page.mouse.up()
  expect((await stored(page)).markers[0]).toMatchObject({ ...moved, locked: true })
  await expect.poll(() => goldBounds(page)).toEqual(lockedBounds)
  await page.mouse.click(box.x + now.x, box.y + now.y)
  await expect(card(page)).toBeVisible(); await card(page).getByRole('button', { name: 'Удалить маркер' }).click()
  await expect.poll(async () => (await stored(page)).markers.length).toBe(0); expect((await stored(page)).entities).toHaveLength(1)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect.poll(async () => (await stored(page)).markers.length).toBe(1)
})

test('marker rich text/image drafts survive errors and archive copy; every type can be placed without saving on Cancel', async ({ page }, info) => {
  const { box, png } = await seed(page); const r = (await stored(page)).regions[0]
  for (const kind of ['Босс', 'Дверь', 'Проход', 'Награда', 'Герой', 'Союзник', 'NPC']) { await place(page, box, kind); await page.getByRole('button', { name: 'Отмена', exact: true }).click() }
  expect((await stored(page)).entities).toEqual([])
  await place(page, box, 'NPC'); await page.getByLabel('Название маркера').fill('Проводник')
  await page.getByLabel(`Привязать к области «${r.number}. ${r.title}»`).check()
  const description = page.getByRole('textbox', { name: 'Описание маркера', exact: true })
  await description.fill('Указывает путь'); await description.press('Control+a')
  await page.getByRole('toolbar', { name: 'Форматирование: Описание маркера' }).getByRole('button', { name: 'Жирный', exact: true }).click()
  await expect(description.locator('strong')).toHaveText('Указывает путь')
  // Tiptap restores toolbar focus on the next frame; collapse only after that.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await description.press('Control+End')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true)
  await page.getByLabel('Изображение: Описание маркера').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(description.locator('img')).toBeVisible()
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; Object.defineProperty(window, '__markerPut', { value: put }); IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Нет места для маркера', 'QuotaExceededError'); return put.apply(this, args) } })
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  const prompt = page.getByRole('dialog', { name: 'Несохранённые изменения маркера' })
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(prompt.getByRole('alert')).toContainText('Нет места для маркера')
  expect((await stored(page)).markers).toEqual([]); expect((await stored(page)).entities).toEqual([]); expect((await stored(page)).assets).toHaveLength(1)
  await prompt.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(description.locator('strong')).toHaveText('Указывает путь'); await expect(description.locator('img')).toBeVisible()
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __markerPut: typeof IDBObjectStore.prototype.put }).__markerPut })
  await save(page); const before = await stored(page)
  const downloading = page.waitForEvent('download'); await clickMenuAction(page, 'Экспорт проекта')
  const archive = info.outputPath('markers.zip'); await (await downloading).saveAs(archive)
  await page.getByLabel('Архив проекта', { exact: true }).setInputFiles(archive)
  await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible(); await page.getByRole('button', { name: 'Закрыть сообщение об архиве' }).click()
  await expect(page.getByRole('button', { name: 'Добавить маркер' })).toBeEnabled()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const fresh = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  const importedMarker = (await stored(page)).markers.find((m) => m.id !== before.markers[0].id)!
  const importedPoint = worldToScreen(importedMarker, await currentCamera(page))
  await page.mouse.click(fresh.x + importedPoint.x, fresh.y + importedPoint.y); await expect(card(page).locator('img')).toBeVisible()
  await expect(card(page).locator('strong')).toContainText('Указывает путь')
  await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название маркера').fill('Проводник копии'); await page.getByLabel('Статус маркера').selectOption('gone'); await save(page)
  const after = await stored(page)
  expect(after.entities.find((e) => e.id === before.entities[0].id)).toEqual(before.entities[0])
  const copyMarker = after.markers.find((m) => m.id !== before.markers[0].id)!
  expect(copyMarker.entityId).not.toBe(before.markers[0].entityId); expect(copyMarker.regionIds).toHaveLength(1); expect(copyMarker.regionIds).not.toContain(r.id)
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить маркер' })).toBeEnabled(); await expect(page.locator('.region-card')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const reloadedBox = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  const reloadedPoint = worldToScreen(copyMarker, await currentCamera(page))
  await page.mouse.click(reloadedBox.x + reloadedPoint.x, reloadedBox.y + reloadedPoint.y); await expect(card(page).locator('img')).toBeVisible(); await expect(card(page).getByRole('heading', { name: 'Проводник копии' })).toBeVisible()
})

test('touch placement and tap open only the marker card above a region', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ hasTouch: true, baseURL, viewport: { width: 1280, height: 800 } }); const page = await context.newPage()
  await configureRussianLocale(context)
  try {
    const { box } = await seed(page)
    await page.getByRole('button', { name: 'Добавить маркер', exact: true }).click(); await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: 'Герой', exact: true }).click()
    await page.touchscreen.tap(box.x + 220, box.y + 230); await expect(card(page)).toBeVisible(); await save(page)
    await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click(); await page.touchscreen.tap(box.x + 220, box.y + 230)
    await expect(card(page)).toBeVisible(); await expect(page.locator('.region-card')).toHaveCount(1); await expect(page.getByRole('region', { name: 'Карточка области', exact: true })).toHaveCount(0)
  } finally { await context.close() }
})

test('camera never resets on marker drag, region/marker save, cleared inputs or viewport resize, including intermediate frames', async ({ page }) => {
  const { box } = await seed(page); await place(page, box); await save(page); await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await page.mouse.move(box.x + 420, box.y + 300); await page.mouse.wheel(0, -140)
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown')
  const camera = await currentCamera(page)
  await page.evaluate(() => {
    const app = window as unknown as CanvasWindow; app.cameraTrail = []; app.trackCamera = true
    const record = () => { if (!app.trackCamera) return; const s = app.Konva.stages[0]; app.cameraTrail!.push({ x: s.x(), y: s.y(), scale: s.scaleX() }); requestAnimationFrame(record) }; requestAnimationFrame(record)
  })
  const original = (await stored(page)).markers[0]; const start = worldToScreen(original, camera)
  await page.mouse.move(box.x + start.x, box.y + start.y); await page.mouse.down(); await page.mouse.move(box.x + start.x + 30, box.y + start.y + 12, { steps: 10 }); await page.mouse.up()
  await expect.poll(async () => (await stored(page)).markers[0].x).toBeCloseTo(original.x + 30 / camera.scale)
  const r = (await stored(page)).regions[0]
  const areaPoint = worldToScreen({ x: r.vertices[0].x + (r.vertices[2].x - r.vertices[0].x) * .15, y: r.vertices[0].y + (r.vertices[2].y - r.vertices[0].y) * .15 }, camera)
  await page.mouse.click(box.x + areaPoint.x, box.y + areaPoint.y)
  const areaCard = page.getByRole('region', { name: 'Карточка области', exact: true })
  await page.getByLabel('Название области').fill('Имя'); await page.getByLabel('Название области').fill(''); await page.getByLabel('Название области').fill('Зал')
  await page.getByRole('textbox', { name: 'Заметки ведущего', exact: true }).fill('Заметки'); await page.getByRole('textbox', { name: 'Заметки ведущего', exact: true }).fill('')
  await areaCard.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(areaCard.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
  const markerPoint = worldToScreen((await stored(page)).markers[0], camera)
  await page.mouse.click(box.x + markerPoint.x, box.y + markerPoint.y); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Название маркера').fill(''); await page.getByLabel('Название маркера').fill('Страж')
  await page.getByRole('textbox', { name: 'Описание маркера', exact: true }).fill('Текст'); await page.getByRole('textbox', { name: 'Описание маркера', exact: true }).fill('')
  await save(page); await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await page.setViewportSize({ width: 1100, height: 740 })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const trail = await page.evaluate(() => { const app = window as unknown as CanvasWindow; app.trackCamera = false; return app.cameraTrail! })
  expect(trail.length).toBeGreaterThan(10)
  for (const frame of trail) { expect(frame.x).toBeCloseTo(camera.x, 8); expect(frame.y).toBeCloseTo(camera.y, 8); expect(frame.scale).toBeCloseTo(camera.scale, 8) }
  expect(await currentCamera(page)).toEqual(camera)
  await page.getByRole('button', { name: 'Показать всю карту' }).click(); await expect.poll(() => currentCamera(page)).not.toEqual(camera)
})

test('context menu has every type; new marker drag is a draft, multiple links survive save/reload and region undo', async ({ page }) => {
  const { box } = await seed(page)
  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  for (const [x, y] of [[120, 130], [320, 130], [320, 330], [120, 330]]) await page.mouse.click(box.x + x, box.y + y)
  await page.keyboard.press('Enter'); await expect.poll(async () => (await stored(page)).regions.length).toBe(2)
  await page.mouse.move(box.x + 500, box.y + 350); await page.mouse.wheel(0, -80)
  const camera = await currentCamera(page)
  await page.mouse.click(box.x + 220, box.y + 230, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Действия на карте', exact: true })
  await expect(menu.getByRole('menuitem', { name: 'Добавить область', exact: true })).toBeVisible()
  const add = menu.getByRole('menuitem', { name: 'Добавить маркер', exact: true }); await add.hover()
  const types = page.getByRole('menu', { name: 'Тип маркера', exact: true })
  await expect(types.getByRole('menuitem')).toHaveCount(9)
  for (const kind of ['Противник', 'Босс', 'Дверь', 'Проход', 'Награда', 'Герой', 'Союзник', 'NPC']) await expect(types.getByRole('menuitem', { name: kind, exact: true })).toBeVisible()
  await add.click(); await expect(types).toBeVisible()
  await types.getByRole('menuitem', { name: 'Босс', exact: true }).click(); await expect(menu).toHaveCount(0)
  await page.getByLabel('Название маркера').fill('Черновик босса')
  await page.getByRole('textbox', { name: 'Описание маркера', exact: true }).fill('Текст до переноса')
  const regions = (await stored(page)).regions
  for (const r of regions) await page.getByLabel(`Привязать к области «${r.number}. ${r.title}»`).check()
  const fresh = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  const point = screenToWorld({ x: 220, y: 230 }, camera)
  await page.mouse.move(fresh.x + 220, fresh.y + 230); await page.mouse.down(); await page.mouse.move(fresh.x + 270, fresh.y + 210, { steps: 10 }); await page.mouse.up()
  expect((await stored(page)).markers).toEqual([]); expect((await stored(page)).entities).toEqual([])
  await expect(page.getByLabel('Название маркера')).toHaveValue('Черновик босса'); await expect(page.getByRole('textbox', { name: 'Описание маркера', exact: true })).toContainText('Текст до переноса')
  await save(page); const saved = (await stored(page)).markers[0]
  expect(saved.x).toBeCloseTo(point.x + 50 / camera.scale); expect(saved.y).toBeCloseTo(point.y - 20 / camera.scale)
  expect(new Set(saved.regionIds)).toEqual(new Set(regions.map((r) => r.id)))
  await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  const r = regions.find((r) => r.number === 2)!
  const areaPoint = worldToScreen({ x: r.vertices[0].x + (r.vertices[2].x - r.vertices[0].x) * .15, y: r.vertices[0].y + (r.vertices[2].y - r.vertices[0].y) * .15 }, camera)
  await page.mouse.click(fresh.x + areaPoint.x, fresh.y + areaPoint.y)
  await expect(page.getByRole('region', { name: 'Связанные маркеры' }).getByRole('button', { name: 'Черновик босса · Жив' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click(); await page.getByRole('button', { name: 'Удалить область', exact: true }).click()
  await expect.poll(async () => (await stored(page)).markers[0].regionIds).toEqual([regions.find((r) => r.number === 1)!.id])
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect.poll(async () => (await stored(page)).markers[0].regionIds.length).toBe(2)
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить маркер', exact: true })).toBeEnabled()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const reloadedBox = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  const reloadedPoint = worldToScreen(saved, await currentCamera(page))
  await page.mouse.click(reloadedBox.x + reloadedPoint.x, reloadedBox.y + reloadedPoint.y); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Привязки к областям' }).getByRole('checkbox', { checked: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click(); await page.getByRole('button', { name: 'Закрыть карточку маркера' }).click()
  await page.mouse.click(reloadedBox.x + 600, reloadedBox.y + 350, { button: 'right' })
  const addAgain = page.getByRole('menuitem', { name: 'Добавить маркер', exact: true }); await addAgain.focus(); await addAgain.press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: 'Противник', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Босс', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp'); await expect(page.getByRole('menuitem', { name: 'Противник', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowLeft'); await expect(addAgain).toBeFocused(); await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0)
})
