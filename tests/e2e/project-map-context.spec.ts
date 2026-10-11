import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { clickMenuAction, control } from './controls'

const contextCard = (page: Page) => page.getByRole('region', { name: 'Контекст приключения', exact: true })
const mapCard = (page: Page) => page.getByRole('region', { name: 'Описание карты', exact: true })
const contextText = (page: Page) => page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true })
const mapText = (page: Page) => page.getByRole('textbox', { name: 'Текст описания карты', exact: true })
async function draft(page: Page, name: string) {
  await clickMenuAction(page, 'Проекты'); await page.getByLabel('Название нового проекта').fill(name)
  await control(page, 'Создать').click(); await expect(contextText(page)).toBeVisible()
}
async function save(page: Page, kind = 'Контекст приключения') {
  const card = page.getByRole('region', { name: kind, exact: true })
  await card.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Сохранено на устройстве')
}
async function createMap(page: Page, name: string) {
  await control(page, 'Карты проекта').click(); await page.getByRole('menuitem', { name: 'New map', exact: true }).click()
  await page.getByLabel('Название новой карты').fill(name); await page.getByRole('dialog').getByRole('button', { name: 'Создать карту', exact: true }).click()
  await expect(control(page, 'Описание карты')).toBeEnabled(); await expect(page.locator('canvas')).toHaveCount(1)
}
async function image(page: Page) {
  const bytes = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 30; c.height = 20; c.getContext('2d')!.fillRect(0, 0, 30, 20); return c.toDataURL().split(',')[1] })
  return { name: 'context.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') }
}
async function rows(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['projects', 'maps', 'assets', 'settings']); const all = (name: string) => new Promise<Record<string, unknown>[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result) })
    const [projects, maps, assets] = await Promise.all([all('projects'), all('maps'), all('assets')]); db.close(); return { projects, maps, assets: assets.map((a) => ({ id: a.id, projectId: a.projectId })) }
  })
}
async function camera(page: Page) { return page.evaluate(() => { const s = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX(), id: s._id } }) }
async function switchMap(page: Page, name: string) { await control(page, 'Карты проекта').click(); await page.getByRole('menuitem', { name: `Перейти на карту «${name}»` }).click() }
async function deleteMenu(page: Page, name: string) {
  await clickMenuAction(page, 'Проекты'); await page.getByLabel(`Действия проекта «${name}»`, { exact: true }).click()
  await page.locator('.project-list-row').filter({ has: page.getByRole('button', { name: `Открыть проект «${name}»` }) }).getByRole('button', { name: 'Удалить проект', exact: true }).click()
}

test('creation is staged; cancellation and failed save leave no records; editor formatting/images persist and export independently', async ({ page }, info) => {
  await page.goto('/'); await draft(page, 'Отменённый')
  await contextText(page).fill('Несохранённое'); await page.getByLabel('Изображение: Общий контекст приключения', { exact: true }).setInputFiles(await image(page))
  await expect(contextCard(page).locator('img')).toHaveCount(1); expect(await rows(page)).toEqual({ projects: [], maps: [], assets: [] })
  await contextCard(page).getByRole('button', { name: 'Отмена', exact: true }).click(); expect(await rows(page)).toEqual({ projects: [], maps: [], assets: [] })
  await page.getByRole('button', { name: 'Закрыть окно проекта' }).click(); await draft(page, 'История')
  await contextText(page).fill('Глава приключения'); await page.getByLabel('Тип текста: Общий контекст приключения', { exact: true }).selectOption('1')
  await page.getByLabel('Изображение: Общий контекст приключения', { exact: true }).setInputFiles(await image(page)); await expect(contextCard(page).locator('img')).toHaveCount(1)
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; Object.assign(window, { ui03put: put }); IDBObjectStore.prototype.put = function (...args) { if (this.name === 'settings') throw new DOMException('Нет места', 'QuotaExceededError'); return put.apply(this, args) } })
  await contextCard(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(contextCard(page).getByRole('alert')).toContainText('Недостаточно места')
  expect((await rows(page)).projects).toHaveLength(0); expect((await rows(page)).assets).toHaveLength(0); await expect(contextText(page)).toContainText('Глава приключения')
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { ui03put: typeof IDBObjectStore.prototype.put }).ui03put })
  await save(page); await expect(contextCard(page).locator('.rich-text-view h1')).toHaveText('Глава приключения'); await expect(contextCard(page).locator('img')).toHaveCount(1)
  await control(page, 'Закрыть контекст приключения').click(); await createMap(page, 'Этаж')
  await control(page, 'Описание карты').click(); await mapCard(page).getByRole('button', { name: 'Заполнить' }).click(); await mapText(page).fill('Описание этажа')
  await page.getByLabel('Изображение: Текст описания карты', { exact: true }).setInputFiles(await image(page)); await expect(mapCard(page).locator('img')).toHaveCount(1); await save(page, 'Описание карты')
  await control(page, 'Закрыть описание карты').click(); const downloading = page.waitForEvent('download'); await clickMenuAction(page, 'Экспорт проекта'); const download = await downloading
  const path = info.outputPath('information.zip'); await download.saveAs(path); const files = unzipSync(new Uint8Array(await readFile(path))); const doc = JSON.parse(new TextDecoder().decode(files['project.json']))
  expect(JSON.stringify(doc.project.context)).toContain('Глава приключения'); expect(JSON.stringify(doc.maps[0].description)).toContain('Описание этажа'); expect(doc.assets).toHaveLength(2)
  const original = await rows(page); await page.getByLabel('Архив проекта').setInputFiles(path); await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible()
  await control(page, 'Описание карты').click(); await expect(mapCard(page)).toContainText('Описание этажа'); await expect(mapCard(page).locator('img')).toHaveCount(1)
  await control(page, 'Контекст приключения').click(); await expect(contextCard(page).locator('h1')).toHaveText('Глава приключения'); await expect(page.locator('.card-panel')).toHaveCount(1)
  expect((await rows(page)).assets.filter((a) => !original.assets.some((b) => b.id === a.id))).toHaveLength(2)
  await page.reload(); await control(page, 'Контекст приключения').click(); await expect(contextCard(page).locator('img')).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('context-view.png') })
})

test('shared panel protects transitions, shows target map description, preserves width and every camera frame, views in play', async ({ page }, info) => {
  await page.goto('/'); await draft(page, 'Контекст'); await contextText(page).fill('Для всех этажей'); await save(page); await control(page, 'Закрыть контекст приключения').click()
  await createMap(page, 'Первый'); const first = (await rows(page)).maps[0].id
  await createMap(page, 'Второй'); await switchMap(page, 'Первый'); await expect(page.getByRole('region', { name: 'Карта приключения' })).toHaveAttribute('data-map-id', String(first))
  await control(page, 'Увеличить масштаб').click(); await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight'); const before = await camera(page)
  await page.evaluate(() => { const w = window as unknown as { Konva: { stages: Konva.Stage[] }; trail: object[]; tracking: boolean }; w.trail = []; w.tracking = true; const record = () => { if (!w.tracking) return; const s = w.Konva.stages[0]; w.trail.push({ x: s.x(), y: s.y(), scale: s.scaleX(), id: s._id }); requestAnimationFrame(record) }; requestAnimationFrame(record) })
  await control(page, 'Описание карты').click(); await mapCard(page).getByRole('button', { name: 'Заполнить' }).click(); await mapText(page).fill('Первый этаж')
  await control(page, 'Контекст приключения').click(); await page.getByRole('button', { name: 'Продолжить редактирование' }).click(); await expect(mapText(page)).toHaveText('Первый этаж')
  await control(page, 'Контекст приключения').click(); await page.getByRole('button', { name: 'Сохранить и продолжить' }).click(); await expect(contextCard(page)).toContainText('Для всех этажей')
  const nameBox = (await page.locator('.project-name').boundingBox())!; const infoBox = (await control(page, 'Контекст приключения').boundingBox())!
  expect(infoBox.x - nameBox.x - nameBox.width).toBeLessThan(12)
  const panelBox = (await contextCard(page).boundingBox())!
  for (const group of await page.locator('.workspace-controls').all()) { const b = (await group.boundingBox())!; expect(b.x + b.width <= panelBox.x || b.y + b.height <= panelBox.y || b.y >= panelBox.y + panelBox.height).toBe(true) }
  const separator = page.getByRole('separator', { name: 'Ширина карточки' }); await separator.focus(); await page.keyboard.press('ArrowLeft'); const width = await separator.getAttribute('aria-valuenow')
  await control(page, 'Описание карты').click(); await expect(separator).toHaveAttribute('aria-valuenow', width!); await mapCard(page).getByRole('button', { name: 'Редактировать' }).click(); await mapText(page).fill('Отбросить')
  await control(page, 'Игра').click(); await page.getByRole('button', { name: 'Отбросить изменения' }).click(); await expect(mapCard(page)).toContainText('Первый этаж'); await expect(mapCard(page).getByRole('button', { name: 'Редактировать' })).toHaveCount(0)
  await control(page, 'Контекст приключения').click(); await expect(contextCard(page)).toContainText('Для всех этажей'); await expect(contextCard(page).getByRole('button', { name: 'Редактировать' })).toHaveCount(0)
  const frames = await page.evaluate(() => { const w = window as unknown as { tracking: boolean; trail: object[] }; w.tracking = false; return w.trail }); expect(frames.length).toBeGreaterThan(5); for (const frame of frames) expect(frame).toEqual(before)
  await control(page, 'Подготовка').click(); await control(page, 'Описание карты').click(); await switchMap(page, 'Второй'); await expect(mapCard(page)).toContainText('Описание карты: Второй'); await mapCard(page).getByRole('button', { name: 'Заполнить' }).click(); await mapText(page).fill('Второй этаж')
  await switchMap(page, 'Первый'); await page.getByRole('button', { name: 'Продолжить редактирование' }).click(); await expect(mapText(page)).toHaveText('Второй этаж')
  await switchMap(page, 'Первый'); await page.getByRole('button', { name: 'Сохранить и продолжить' }).click(); await expect(mapCard(page)).toContainText('Первый этаж'); expect(await camera(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('map-description.png') })
  await page.setViewportSize({ width: 360, height: 720 }); await expect(page.getByRole('main')).toHaveClass(/controls-strips/)
  const mobilePanel = (await mapCard(page).boundingBox())!
  for (const group of await page.locator('.workspace-controls').all()) { const b = (await group.boundingBox())!; expect(b.y + b.height <= mobilePanel.y || b.y >= mobilePanel.y + mobilePanel.height).toBe(true) }
  expect(await camera(page)).toEqual(before); await page.screenshot({ path: info.outputPath('map-description-mobile.png') })
  await page.reload(); await control(page, 'Описание карты').click(); await expect(mapCard(page)).toContainText('Первый этаж')
})

test('project delete menu confirms/cancels, preserves other project/card/camera, rolls back and resolves current drafts', async ({ page }, info) => {
  await page.goto('/'); await draft(page, 'Другая история'); await save(page); await control(page, 'Закрыть контекст приключения').click(); await createMap(page, 'Другая карта')
  await draft(page, 'Текущая история'); await contextText(page).fill('Сохранённый контекст'); await save(page); await control(page, 'Закрыть контекст приключения').click(); await createMap(page, 'Текущая карта')
  await control(page, 'Увеличить масштаб').click(); await control(page, 'Описание карты').click(); const before = await camera(page); const data = await rows(page)
  await deleteMenu(page, 'Другая история'); const confirmation = page.getByRole('dialog', { name: 'Удаление проекта' }); await expect(confirmation).toContainText('Другая история'); await confirmation.getByRole('button', { name: 'Отмена' }).click(); expect(await rows(page)).toEqual(data)
  await control(page, 'Закрыть окно проекта').click(); await deleteMenu(page, 'Другая история'); await confirmation.getByRole('button', { name: 'Удалить проект', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Локальные проекты' })).toContainText('удалён'); await control(page, 'Закрыть окно проекта').click()
  expect((await rows(page)).projects).toHaveLength(1); await expect(mapCard(page)).toContainText('Текущая карта'); expect(await camera(page)).toEqual(before)
  await control(page, 'Контекст приключения').click(); await contextCard(page).getByRole('button', { name: 'Редактировать' }).click(); await contextText(page).fill('Несохранённый текст')
  await deleteMenu(page, 'Текущая история'); await confirmation.getByRole('button', { name: 'Удалить проект', exact: true }).click(); await page.getByRole('button', { name: 'Продолжить редактирование' }).click(); await expect(contextText(page)).toHaveText('Несохранённый текст'); expect((await rows(page)).projects).toHaveLength(1)
  await deleteMenu(page, 'Текущая история'); await page.evaluate(() => { const remove = IDBObjectStore.prototype.delete; Object.assign(window, { ui03delete: remove }); IDBObjectStore.prototype.delete = function (...args) { if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError'); return remove.apply(this, args) } })
  await confirmation.getByRole('button', { name: 'Удалить проект', exact: true }).click(); await page.getByRole('button', { name: 'Отбросить изменения' }).click(); await expect(confirmation.getByRole('alert')).toContainText('Проект не удалён'); expect((await rows(page)).projects).toHaveLength(1); expect((await rows(page)).maps).toHaveLength(1); expect(await camera(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('delete-error.png') }); await page.evaluate(() => { IDBObjectStore.prototype.delete = (window as unknown as { ui03delete: typeof IDBObjectStore.prototype.delete }).ui03delete })
  await confirmation.getByRole('button', { name: 'Удалить проект', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Локальные проекты' })).toContainText('удалён'); expect(await rows(page)).toEqual({ projects: [], maps: [], assets: [] })
  await control(page, 'Закрыть окно проекта').click(); await expect(page.locator('.card-panel')).toHaveCount(0); await expect(page.locator('canvas')).toHaveCount(0)
})
