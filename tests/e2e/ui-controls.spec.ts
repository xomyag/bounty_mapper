import { finishProjectCreation } from './controls'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import { clickMenuAction, control } from './controls'
import { emptyRegionContent } from '../../src/domain/region'
import type { Region } from '../../src/domain/region'
import type { MarkerPlacement } from '../../src/domain/marker'
import { worldToScreen } from '../../src/domain/viewport'
import type { Camera, Point } from '../../src/domain/viewport'

const card = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })
const canvas = (page: Page) => page.getByRole('region', { name: 'Карта приключения', exact: true })
async function paint(page: Page) { await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function camera(page: Page): Promise<Camera> { return page.evaluate(() => { const s = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX() } }) }
async function screen(page: Page, point: Point) { const box = (await canvas(page).boundingBox())!; const p = worldToScreen(point, await camera(page)); return { x: box.x + p.x, y: box.y + p.y } }
async function clickWorld(page: Page, point: Point) { await paint(page); const p = await screen(page, point); await page.mouse.click(p.x, p.y) }
async function drag(page: Page, point: Point, offset: Point) { await paint(page); const p = await screen(page, point); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + offset.x, p.y + offset.y, { steps: 10 }); await page.mouse.up(); await paint(page) }
async function stored(page: Page) { return page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
  const tx = db.transaction(['regions', 'markerPlacements'])
  const get = <T,>(store: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result) })
  const [regions, markers] = await Promise.all([get<Region>('regions'), get<MarkerPlacement>('markerPlacements')]); db.close(); return { regions, markers }
}) }
async function displayed(page: Page) { return page.evaluate(() => { const s = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return (s.find('.map-region')[0] as Konva.Group).findOne<Konva.Line>('Line')!.points() }) }
async function seed(page: Page) {
  await page.goto('/'); await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Проверка управления'); await control(page, 'Создать').click()
  await finishProjectCreation(page)
  await control(page, 'Карты проекта').click(); await page.getByRole('menuitem', { name: 'New map', exact: true }).click()
  await page.getByLabel('Название новой карты').fill('Этаж 1'); await page.getByRole('dialog', { name: 'Новая карта' }).getByRole('button', { name: 'Создать карту', exact: true }).click(); await expect(control(page, 'Добавить область')).toBeEnabled()
  await page.evaluate(async (content) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['maps', 'regions', 'entities', 'markerPlacements'], 'readwrite')
    const request = tx.objectStore('maps').getAll(); request.onsuccess = () => {
      const map = request.result[0]
      tx.objectStore('maps').add({ ...map, id: 'other-map', name: 'Этаж 2', order: 1 })
      for (const [index, id] of ['a', 'b'].entries()) { const x = 100 + index * 300; tx.objectStore('regions').add({ ...content, id, mapId: map.id, number: index + 1, title: `Зал ${id}`, titleCustomized: true, color: '#d7ad62', fillOpacity: .4, order: index, vertices: [{ x, y: 150 }, { x: x + 150, y: 150 }, { x: x + 150, y: 300 }, { x, y: 300 }] }) }
      tx.objectStore('entities').add({ checks: [], id: 'npc', projectId: map.projectId, name: 'Страж', kind: 'enemy', status: 'alive', description: content.gmNotes, tags: [] })
      tx.objectStore('markerPlacements').add({ id: 'npc-placement', entityId: 'npc', mapId: map.id, x: 600, y: 400, color: '#d7ad62', locked: false, order: 0, regionIds: ['a'] })
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) }); db.close()
  }, emptyRegionContent())
  await page.reload(); await expect(control(page, 'Добавить область')).toBeEnabled(); await expect(canvas(page)).toBeVisible(); await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages.length ?? 0)).toBe(1); await paint(page)
}

test('only the edited region moves; whole-card draft cancels, retries atomically and preserves camera and linked marker', async ({ page }) => {
  await seed(page)
  const original = await stored(page)
  const beforePan = await camera(page)
  await drag(page, { x: 175, y: 225 }, { x: 30, y: 20 })
  expect((await camera(page)).x).toBeCloseTo(beforePan.x + 30)
  expect((await camera(page)).y).toBeCloseTo(beforePan.y + 20)
  await expect(card(page)).toHaveCount(0); expect(await stored(page)).toEqual(original)
  await clickWorld(page, { x: 175, y: 225 }); await control(page, 'Редактировать').click()
  const view = await camera(page)
  await drag(page, { x: 175, y: 225 }, { x: 40, y: 20 })
  expect(await camera(page)).toEqual(view); expect(await stored(page)).toEqual(original)
  const draft = await displayed(page); expect(draft[0]).toBeCloseTo(100 + 40 / view.scale)
  await control(page, 'Отменить').click(); await paint(page); expect((await displayed(page))[0]).toBe(100)
  await control(page, 'Повторить').click(); await paint(page); expect(await displayed(page)).toEqual(draft)
  await card(page).getByRole('button', { name: 'Отмена', exact: true }).click(); await paint(page)
  expect((await displayed(page))[0]).toBe(100); expect(await stored(page)).toEqual(original)
  await control(page, 'Редактировать').click(); await drag(page, { x: 175, y: 225 }, { x: 40, y: 20 })
  await page.getByLabel('Название области', { exact: true }).fill('Сохранённый зал')
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; Object.defineProperty(window, 'originalPut', { value: put, configurable: true }); IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError'); return put.apply(this, args) } })
  await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('alert')).toContainText('Нет места'); expect(await stored(page)).toEqual(original)
  await expect(page.getByLabel('Название области', { exact: true })).toHaveValue('Сохранённый зал')
  expect(await displayed(page)).toEqual(draft); expect(await camera(page)).toEqual(view)
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { originalPut: typeof IDBObjectStore.prototype.put }).originalPut })
  await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(card(page).getByRole('status')).toHaveText('Сохранено на устройстве')
  const saved = await stored(page); expect(saved.regions[0].title).toBe('Сохранённый зал'); expect(saved.markers).toEqual(original.markers)
  expect(saved.regions[0].vertices[0].x).toBeCloseTo(100 + 40 / view.scale); expect(await camera(page)).toEqual(view)
  await drag(page, { x: 175 + 40 / view.scale, y: 225 + 20 / view.scale }, { x: 30, y: 10 })
  expect(await stored(page)).toEqual(saved); expect((await camera(page)).x).toBeCloseTo(view.x + 30)
})

test('other regions pan the camera; dirty movement participates in close, object, map and mode confirmation', async ({ page }) => {
  await seed(page); await clickWorld(page, { x: 175, y: 225 }); await control(page, 'Редактировать').click()
  await drag(page, { x: 175, y: 225 }, { x: 15, y: 10 }); const draft = await displayed(page)
  const view = await camera(page); await drag(page, { x: 475, y: 225 }, { x: 25, y: 15 })
  expect((await camera(page)).x).toBeCloseTo(view.x + 25); expect(await displayed(page)).toEqual(draft)
  await control(page, 'Закрыть карточку области').click(); await expect(page.getByRole('dialog', { name: 'Несохранённые изменения области' })).toBeVisible()
  await control(page, 'Продолжить редактирование').click(); expect(await displayed(page)).toEqual(draft)
  await clickWorld(page, { x: 475, y: 225 }); await expect(page.getByRole('dialog', { name: 'Несохранённые изменения области' })).toBeVisible(); await control(page, 'Продолжить редактирование').click()
  await control(page, 'Карты проекта').click(); await page.getByRole('menuitem', { name: 'Перейти на карту «Этаж 2»', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения области' })).toBeVisible(); await control(page, 'Продолжить редактирование').click()
  await control(page, 'Игра').click(); await expect(page.getByRole('dialog', { name: 'Несохранённые изменения области' })).toBeVisible(); await control(page, 'Отбросить изменения').click()
  await expect(control(page, 'Игра')).toHaveAttribute('aria-pressed', 'true'); expect((await displayed(page))[0]).toBe(100)
  await expect(control(page, 'Добавить область')).toBeDisabled(); await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
  const saved = await stored(page); await drag(page, { x: 175, y: 225 }, { x: 20, y: 10 }); expect(await stored(page)).toEqual(saved)
})

test('compact menus work by keyboard, overlays stay accessible beside panels and do not pass clicks to canvas', async ({ page }, info) => {
  await seed(page)
  await control(page, 'Меню проекта').focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Проекты', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Импорт проекта', exact: true })).toBeFocused(); await page.keyboard.press('Escape')
  await expect(control(page, 'Меню проекта')).toBeFocused()
  await control(page, 'Карты проекта').focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'New map', exact: true })).toBeFocused(); await page.keyboard.press('Escape')
  const initial = await stored(page); const view = await camera(page)
  await clickWorld(page, { x: 175, y: 225 }); await control(page, 'Навигация и поиск').click(); await paint(page)
  expect(await camera(page)).toEqual(view)
  const checkOverlays = async () => {
    const panels = await page.locator('.region-card, .navigation-panel:not([hidden])').all()
    for (const group of await page.locator('.workspace-controls').all()) {
      const box = (await group.boundingBox())!; const workspace = (await page.getByRole('main').boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(workspace.x); expect(box.x + box.width).toBeLessThanOrEqual(workspace.x + workspace.width)
      for (const panel of panels) { const other = (await panel.boundingBox())!; expect(box.x >= other.x + other.width || box.x + box.width <= other.x || box.y >= other.y + other.height || box.y + box.height <= other.y).toBe(true) }
    }
  }
  await checkOverlays(); await page.screenshot({ path: info.outputPath('desktop.png') })
  await page.setViewportSize({ width: 1050, height: 780 }); await paint(page); await checkOverlays()
  await page.setViewportSize({ width: 375, height: 780 }); await paint(page); await checkOverlays(); await page.screenshot({ path: info.outputPath('narrow.png') })
  await control(page, 'Увеличить масштаб').click(); expect((await camera(page)).scale).toBeCloseTo(view.scale * 1.25)
  await control(page, 'Уменьшить масштаб').click(); expect((await camera(page)).scale).toBeCloseTo(view.scale)
  expect(await stored(page)).toEqual(initial)
  await control(page, 'Закрыть навигацию').click(); await control(page, 'Закрыть карточку области').click()
  await control(page, 'Добавить область').click(); await control(page, 'Увеличить масштаб').click()
  await expect(page.getByRole('group', { name: 'Создание области' })).toContainText('Вершин: 0')
  await control(page, 'Отменить контур').click()
  await control(page, 'Добавить маркер').click(); await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: 'NPC', exact: true }).click()
  await control(page, 'Уменьшить масштаб').click(); await expect(page.getByRole('group', { name: 'Размещение маркера' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Карточка маркера' })).toHaveCount(0); expect(await stored(page)).toEqual(initial)
  await control(page, 'Отменить размещение').click()
  await control(page, 'Игра').click(); await expect(control(page, 'Добавить маркер')).toBeDisabled()
  await control(page, 'Карты проекта').click(); await expect(page.getByRole('menuitem', { name: 'New map', exact: true })).toBeDisabled(); await expect(page.getByRole('menuitem', { name: 'Загрузить карту', exact: true })).toBeDisabled()
})
