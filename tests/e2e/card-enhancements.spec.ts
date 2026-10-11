import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import { control, clickMenuAction } from './controls'
import { emptyRegionContent } from '../../src/domain/region'
import type { Region } from '../../src/domain/region'
import type { Entity, MarkerPlacement } from '../../src/domain/marker'
import type { Point } from '../../src/domain/viewport'

const regionCard = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })
const markerCard = (page: Page) => page.getByRole('region', { name: 'Карточка маркера', exact: true })
async function view(page: Page) { return page.evaluate(() => { const s = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX(), id: s._id } }) }
async function point(page: Page, p: Point) { await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages.length ?? 0)).toBe(1); const camera = await view(page); const box = (await page.getByRole('region', { name: 'Карта приключения', exact: true }).boundingBox())!; return { x: box.x + camera.x + p.x * camera.scale, y: box.y + camera.y + p.y * camera.scale } }
async function stored(page: Page) { return page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
  const tx = db.transaction(['regions', 'entities', 'markerPlacements']); const get = <T,>(name: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result) })
  const [regions, entities, markers] = await Promise.all([get<Region>('regions'), get<Entity>('entities'), get<MarkerPlacement>('markerPlacements')]); db.close(); return { regions, entities, markers }
}) }
async function seed(page: Page) {
  await page.goto('/'); await clickMenuAction(page, 'Проекты'); await page.getByLabel('Название нового проекта').fill('UI-02')
  await control(page, 'Создать').click(); await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Сохранено на устройстве'); await control(page, 'Закрыть окно проекта').click()
  await control(page, 'Карты проекта').click(); await page.getByRole('menuitem', { name: 'New map', exact: true }).click(); await page.getByLabel('Название новой карты').fill('Залы')
  await page.getByRole('dialog').getByRole('button', { name: 'Создать карту', exact: true }).click(); await expect(control(page, 'Добавить область')).toBeEnabled()
  await page.evaluate(async (content) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) }); const tx = db.transaction(['maps', 'regions'], 'readwrite')
    const r = tx.objectStore('maps').getAll(); r.onsuccess = () => { const map = r.result[0]; for (let index = 0; index < 2; index++) tx.objectStore('regions').add({ ...content, id: 'area-' + index, mapId: map.id, number: index + 1, title: 'Зал ' + (index + 1), titleCustomized: true, color: '#aabbcc', fillOpacity: .4, order: index, vertices: [{ x: 150 + index * 250, y: 180 }, { x: 330 + index * 250, y: 180 }, { x: 330 + index * 250, y: 340 }, { x: 150 + index * 250, y: 340 }], gmNotes: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'СЕКРЕТ ведущего' }] }] }, tags: ['Ловушка', 'Камень', 'Вода', 'Огонь', 'Пыль', 'Ключ', 'Дверь'] }) }
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() }); db.close()
  }, emptyRegionContent())
  await page.reload(); await expect(control(page, 'Добавить область')).toBeEnabled(); await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages.length ?? 0)).toBe(1)
}
test('shared card resize persists, clamps narrow windows, preserves drafts/camera and keeps toolbar selection', async ({ page }, info) => {
  await seed(page); const initial = await view(page); await control(page, 'Увеличить масштаб').click(); await expect.poll(async () => (await view(page)).scale).toBeGreaterThan(initial.scale)
  await page.getByRole('region', { name: 'Карта приключения', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  const p = await point(page, { x: 200, y: 250 }); await page.mouse.click(p.x, p.y); await control(page, 'Редактировать').click()
  await page.getByLabel('Краткое описание', { exact: true }).fill('Кратко\nВторая строка'); const original = await stored(page); const camera = await view(page)
  const separator = page.getByRole('separator', { name: 'Ширина карточки' }); await separator.focus(); await page.keyboard.press('ArrowLeft')
  await expect(separator).toHaveAttribute('aria-valuenow', '434'); await expect(page.getByLabel('Краткое описание', { exact: true })).toHaveValue('Кратко\nВторая строка')
  const handle = (await separator.boundingBox())!; await page.mouse.move(handle.x + handle.width / 2, handle.y + 100); await page.mouse.down(); await page.mouse.move(handle.x - 170, handle.y + 100, { steps: 10 }); await page.mouse.up()
  const width = Number(await separator.getAttribute('aria-valuenow')); expect(width).toBeGreaterThan(600); expect(await view(page)).toEqual(camera); expect(await stored(page)).toEqual(original)
  const editor = page.getByRole('textbox', { name: 'Заметки ведущего', exact: true }); const toolbar = page.getByRole('toolbar', { name: 'Форматирование: Заметки ведущего' })
  await expect(toolbar.getByRole('button', { name: 'Ещё', exact: true })).toHaveCount(0); await expect(toolbar.getByRole('button', { name: 'Цитата', exact: true })).toBeVisible()
  await editor.fill('Выделение'); await editor.press('Control+a'); await toolbar.getByRole('button', { name: 'Жирный', exact: true }).click(); await expect(editor.locator('strong')).toHaveText('Выделение')
  await separator.focus(); await page.keyboard.press('Home'); await expect(separator).toHaveAttribute('aria-valuenow', '320')
  await editor.press('Control+a'); await toolbar.getByRole('button', { name: 'Ещё', exact: true }).click(); await page.screenshot({ path: info.outputPath('format-menu.png') }); await page.keyboard.press('Escape'); await expect(toolbar.getByRole('button', { name: 'Ещё', exact: true })).toBeFocused(); await page.keyboard.press('Enter'); await toolbar.getByRole('button', { name: 'Ссылка', exact: true }).click()
  await page.getByLabel('Адрес ссылки: Заметки ведущего').fill('https://example.org'); await page.getByRole('button', { name: 'Применить ссылку', exact: true }).click(); await expect(editor.locator('a')).toHaveText('Выделение')
  await toolbar.getByRole('combobox').selectOption('2'); await expect(editor.locator('h2')).toHaveText('Выделение'); await expect(toolbar.getByRole('button', { name: 'Жирный', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await separator.focus(); await page.keyboard.press('ArrowLeft'); await expect(separator).toHaveAttribute('aria-valuenow', '344')
  await regionCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(regionCard(page).getByRole('status')).toHaveText('Сохранено на устройстве'); expect(await view(page)).toEqual(camera)
  await page.screenshot({ path: info.outputPath('card-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 }); await expect(separator).toHaveAttribute('aria-valuenow', '366'); expect(await view(page)).toEqual(camera)
  const panel = (await regionCard(page).boundingBox())!; expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(390)
  for (const group of await page.locator('.workspace-controls').all()) { const b = (await group.boundingBox())!; expect(b.y + b.height <= panel.y || b.y >= panel.y + panel.height).toBe(true) }
  await page.screenshot({ path: info.outputPath('card-mobile.png') }); await page.setViewportSize({ width: 1280, height: 800 }); await expect(separator).toHaveAttribute('aria-valuenow', '344')
  await page.reload(); await expect(control(page, 'Добавить область')).toBeEnabled(); const again = await point(page, { x: 200, y: 250 }); await page.mouse.click(again.x, again.y); await expect(separator).toHaveAttribute('aria-valuenow', '344')
  await expect(regionCard(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible(); await expect(regionCard(page).getByLabel('Краткое описание области')).toContainText('Вторая строка')
  await control(page, 'Закрыть карточку области').click(); await page.mouse.move(again.x + 1, again.y + 1); const tooltip = page.getByRole('tooltip'); await expect(tooltip).toContainText('Кратко'); await expect(tooltip).not.toContainText('Выделение'); await expect(tooltip).toContainText('ещё 2')
  const tip = (await tooltip.boundingBox())!; const area = (await page.getByRole('main').boundingBox())!; expect(tip.x + tip.width).toBeLessThanOrEqual(area.x + area.width); expect(tip.y + tip.height).toBeLessThanOrEqual(area.y + area.height)
  await control(page, 'Добавить маркер').click(); await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: 'NPC', exact: true }).click(); await page.mouse.click(again.x, again.y)
  await expect(markerCard(page)).toBeVisible(); await expect(separator).toHaveAttribute('aria-valuenow', '344'); await expect(markerCard(page).getByLabel('Название маркера', { exact: true })).toBeVisible(); await markerCard(page).getByRole('button', { name: 'Отмена', exact: true }).click(); expect((await stored(page)).entities).toEqual([])
})
test('trap context placement moves before save, rejects bad checks, shares bindings, shows bounded hover and quick status undo', async ({ page }, info) => {
  await seed(page); const position = await point(page, { x: 200, y: 250 }); await page.mouse.click(position.x, position.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Добавить маркер', exact: true }).click(); await page.getByRole('menuitem', { name: 'Ловушка', exact: true }).click(); await expect(markerCard(page)).toBeVisible()
  const camera = await view(page); await page.mouse.move(position.x, position.y); await page.mouse.down(); await page.mouse.move(position.x + 25, position.y + 20, { steps: 8 }); await page.mouse.up()
  expect(await view(page)).toEqual(camera); expect((await stored(page)).entities).toEqual([])
  await page.getByLabel('Название маркера', { exact: true }).fill('Шипы'); await markerCard(page).getByRole('button', { name: 'Добавить проверку', exact: true }).click()
  await page.getByLabel('Назначение проверки 1').fill('Обнаружить'); await page.getByLabel('Навык проверки ловушки 1').fill('Внимательность'); await page.getByLabel('Сложность проверки 1').fill('1.5'); await page.getByLabel('Пояснение проверки 1').fill('Секретное пояснение')
  await markerCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(markerCard(page).getByRole('alert').first()).toContainText('положительным целым'); expect((await stored(page)).entities).toEqual([]); await expect(page.getByLabel('Сложность проверки 1')).toHaveValue('1.5')
  await page.getByLabel('Сложность проверки 1').fill('15'); await page.getByLabel('Привязать к области «1. Зал 1»').check(); await page.getByLabel('Привязать к области «2. Зал 2»').check()
  for (let index = 2; index <= 4; index++) { await markerCard(page).getByRole('button', { name: 'Добавить проверку', exact: true }).click(); await page.getByLabel(`Назначение проверки ${index}`).fill('Обезвредить ' + index); await page.getByLabel(`Навык проверки ловушки ${index}`).fill('Ловкость'); await page.getByLabel(`Сложность проверки ${index}`).fill('16') }
  for (const tag of ['ловушка', 'камень', 'вода', 'огонь', 'пыль', 'ключ', 'дверь']) { await markerCard(page).getByLabel('Новый тег').fill(tag); await markerCard(page).getByRole('button', { name: 'Добавить тег', exact: true }).click() }
  await markerCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(markerCard(page).getByRole('status')).toHaveText('Сохранено на устройстве'); const saved = await stored(page)
  expect(saved.entities[0]).toMatchObject({ kind: 'trap', status: 'armed' }); expect(saved.entities[0].checks[0]).toMatchObject({ condition: 'Обнаружить', dc: 15 }); expect(saved.entities[0].checks).toHaveLength(4); expect(saved.markers[0].regionIds).toHaveLength(2); expect(saved.markers[0].x).not.toBe(200); expect(await view(page)).toEqual(camera)
  await control(page, 'Закрыть карточку маркера').click(); const p = await point(page, saved.markers[0]); await page.mouse.move(p.x, p.y); await expect(page.getByRole('tooltip')).toContainText('Обнаружить — Внимательность, СЛ 15'); await expect(page.getByRole('tooltip')).toContainText('Ловушка'); await expect(page.getByRole('tooltip')).toContainText('ещё 2'); await expect(page.getByRole('tooltip')).toContainText('Ещё проверок: 1'); await expect(page.getByRole('tooltip')).not.toContainText('Секретное пояснение')
  await page.screenshot({ path: info.outputPath('trap-tooltip.png') }); await page.mouse.click(p.x, p.y); await expect(regionCard(page)).toHaveCount(0); await expect(markerCard(page).getByLabel('Проверки ловушки')).toContainText('Секретное пояснение')
  await control(page, 'Игра').click(); await expect(control(page, 'Игра')).toHaveAttribute('aria-pressed', 'true'); await page.getByRole('combobox', { name: 'Быстрая смена статуса', exact: true }).selectOption('disarmed'); await expect(markerCard(page).getByRole('status')).toHaveText('Сохранено на устройстве')
  await expect(markerCard(page).locator('.marker-status')).toContainText('✓'); await expect(markerCard(page).locator('.marker-status')).toContainText('Обезврежена'); await control(page, 'Отменить статус').click(); await expect(markerCard(page).locator('.marker-status')).toContainText('Заряжена'); expect(await view(page)).toEqual(camera)
  await page.reload(); await expect(control(page, 'Игра')).toHaveAttribute('aria-pressed', 'true'); await expect(control(page, 'Показать всю карту')).toBeEnabled(); const reloaded = await point(page, saved.markers[0]); await page.mouse.click(reloaded.x, reloaded.y); await expect(markerCard(page).getByLabel('Проверки ловушки')).toContainText('СЛ 15'); await expect(markerCard(page).getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
})
