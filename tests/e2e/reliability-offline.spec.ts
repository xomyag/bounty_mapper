import { finishProjectCreation } from './controls'
import { clickMenuAction, control } from './controls'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, extname } from 'node:path'
import { Buffer } from 'node:buffer'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import type { Camera } from '../../src/domain/viewport'
import { emptyRegionContent } from '../../src/domain/region'

const button = control
const mapCanvas = (page: Page) => page.getByRole('region', { name: 'Карта приключения', exact: true })
const nav = (page: Page) => page.getByRole('complementary', { name: 'Навигация и поиск', exact: true })
const card = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })
async function camera(page: Page) { return page.evaluate(() => { const s = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX() } }) }
async function seed(page: Page, origin: string) {
  await page.goto(origin); await expect(page.getByText('Готово к работе без сети', { exact: true })).toBeVisible()
  await clickMenuAction(page, 'Проекты'); await page.getByLabel('Название нового проекта').fill('Надёжность'); await button(page, 'Создать').click()
  await finishProjectCreation(page)
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 500; c.height = 400; c.getContext('2d')!.fillRect(0, 0, 500, 400); return c.toDataURL().split(',')[1] })
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await expect(button(page, 'Добавить область')).toBeEnabled()
  await page.evaluate(async (content) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['maps', 'regions', 'assets', 'entities', 'markerPlacements', 'projects'], 'readwrite')
    const request = tx.objectStore('maps').getAll(); request.onsuccess = () => {
      const map = request.result[0]; const asset = tx.objectStore('assets').getAll(); asset.onsuccess = () => {
        const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Тайна офлайн', marks: [{ type: 'bold' }] }] }, { type: 'image', attrs: { assetId: asset.result[0].id, alt: 'Локальная схема' } }] }
        const region = { ...content, id: 'room', mapId: map.id, number: 9, title: 'Зал офлайн', titleCustomized: true, order: 0, color: '#d7ad62', fillOpacity: .4, vertices: [{ x: 20, y: 20 }, { x: 250, y: 20 }, { x: 250, y: 200 }], gmNotes: doc, tags: ['Тайна'] }
        tx.objectStore('regions').add(region)
        tx.objectStore('entities').add({ checks: [], id: 'guard', projectId: map.projectId, name: 'Страж офлайн', kind: 'enemy', status: 'alive', description: doc, tags: ['Тайна'] })
        tx.objectStore('markerPlacements').add({ id: 'guard-placement', entityId: 'guard', mapId: map.id, x: 300, y: 250, color: '#d7ad62', locked: false, order: 0, regionIds: ['room'] })
        const p = tx.objectStore('projects').get(map.projectId); p.onsuccess = () => tx.objectStore('projects').put({ ...p.result, revision: p.result.revision + 1 })
      }
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) }); db.close()
  }, emptyRegionContent())
  await page.reload(); await expect(button(page, 'Добавить область')).toBeEnabled()
}
async function openRoom(page: Page) {
  await button(page, 'Навигация и поиск').click(); await nav(page).locator('[data-object-id="room"]').click(); await expect(card(page)).toBeVisible()
}
async function productionServer() {
  const paths = await readdir('dist', { recursive: true, withFileTypes: true }); const files = new Map<string, Buffer>()
  for (const file of paths.filter((f) => f.isFile())) { const path = join(file.parentPath, file.name); files.set('/' + relative('dist', path).replaceAll('\\', '/'), await readFile(path)) }
  let update = false
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname; const name = path === '/' ? '/index.html' : path; let file = files.get(name)
    if (update && name === '/sw.js' && file) file = Buffer.from(file.toString().replace(/[a-f0-9]{20}/, '11111111111111111111'))
    if (!file) { response.writeHead(404); response.end(); return }
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(name)] ?? 'application/octet-stream'); response.end(file)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Нет адреса сервера')
  return { origin: `http://127.0.0.1:${address.port}`, update: () => { update = true }, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
test.describe('Production reliability and offline', () => {
  test.skip(process.env.PLAYWRIGHT_PREVIEW !== '1', 'Run after build with PLAYWRIGHT_PREVIEW=1; these checks require production resources.')
  test('background write failure, retry with a differently sized image and removal never reset any camera frame', async ({ page }) => {
    const server = await productionServer()
    try {
      await seed(page, server.origin); await mapCanvas(page).focus(); await page.keyboard.press('+'); await page.keyboard.press('ArrowRight')
      const view = await camera(page)
      await page.evaluate(() => {
        const w = window as unknown as { Konva: { stages: Konva.Stage[] }; bmPut: typeof IDBObjectStore.prototype.put; bmFrames: Camera[]; bmRecord: boolean }
        w.bmPut = IDBObjectStore.prototype.put; w.bmFrames = []; w.bmRecord = true
        const sample = () => { if (!w.bmRecord) return; const s = w.Konva.stages[0]; w.bmFrames.push({ x: s.x(), y: s.y(), scale: s.scaleX() }); requestAnimationFrame(sample) }; requestAnimationFrame(sample)
        IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError'); return w.bmPut.apply(this, args) }
      })
      const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 700; c.height = 200; c.getContext('2d')!.fillRect(0, 0, 700, 200); return c.toDataURL().split(',')[1] })
      await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await expect(page.getByRole('alert')).toContainText('Недостаточно места')
      expect(await camera(page)).toEqual(view)
      await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { bmPut: typeof IDBObjectStore.prototype.put }).bmPut })
      await button(page, 'Повторить загрузку карты').click(); await expect(button(page, 'Заменить изображение')).toBeEnabled(); await expect(page.getByRole('alert')).toHaveCount(0)
      expect(await camera(page)).toEqual(view); page.once('dialog', (dialog) => dialog.accept()); await clickMenuAction(page, 'Удалить изображение'); await expect(button(page, 'Загрузить карту')).toBeEnabled()
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const frames = await page.evaluate(() => { const w = window as unknown as { bmFrames: Camera[]; bmRecord: boolean }; w.bmRecord = false; return w.bmFrames }); expect(frames.length).toBeGreaterThan(0); for (const frame of frames) expect(frame).toEqual(view)
    } finally { await page.goto('about:blank'); await server.close() }
  })
  test('reloads offline, loads a previously unopened visual editor and local images, saves and exports without network', async ({ page, context }) => {
    const server = await productionServer(); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
    try {
      await seed(page, server.origin)
      const cached = await page.evaluate(async () => { const names = await caches.keys(); const cache = await caches.open(names.find((n) => n.startsWith('bounty-mapper-shell-'))!); return (await cache.keys()).map((r) => r.url) }); expect(cached.some((url) => url.includes('RichTextEditor-'))).toBe(true)
      await context.setOffline(true); await page.reload(); await expect(mapCanvas(page)).toBeVisible(); await expect(page.getByText('Готово к работе без сети', { exact: true })).toBeVisible()
      await openRoom(page); await expect(card(page).getByRole('img', { name: 'Локальная схема' })).toBeVisible(); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'Заметки ведущего', exact: true })).toBeVisible(); await page.getByLabel('Название области', { exact: true }).fill('Сохранено офлайн')
      await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(card(page).getByRole('status')).toHaveText('Сохранено на устройстве')
      const download = page.waitForEvent('download'); await clickMenuAction(page, 'Экспорт проекта'); expect((await download).suggestedFilename()).toMatch(/\.zip$/)
      await page.reload(); await expect(button(page, 'Добавить область')).toBeEnabled(); await openRoom(page); await expect(card(page).getByRole('heading', { level: 2 })).toContainText('Сохранено офлайн'); expect(errors).toEqual([])
    } finally { await context.setOffline(false); await page.goto('about:blank'); await server.close() }
  })
  test('tab locks are disabled; stale writes are rejected without losing the second tab draft', async ({ page, context }) => {
    const server = await productionServer(); let reader: Page | undefined
    try {
      await seed(page, server.origin); reader = await context.newPage(); await reader.goto(server.origin)
      await expect(button(reader, 'Добавить область')).toBeEnabled()
      await expect(reader.locator('.access-banner')).toHaveCount(0)
      await expect(page.locator('.access-banner')).toHaveCount(0)
      await openRoom(reader); await card(reader).getByRole('button', { name: 'Редактировать', exact: true }).click()
      await reader.getByLabel('Название области', { exact: true }).fill('Черновик второй вкладки')
      await openRoom(page); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название области', { exact: true }).fill('Актуальный зал'); await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(card(page).getByRole('status')).toHaveText('Сохранено на устройстве')
      const view = await camera(reader)
      await card(reader).getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(reader.getByRole('alert')).toContainText('другой вкладке')
      await expect(reader.getByLabel('Название области', { exact: true })).toHaveValue('Черновик второй вкладки')
      expect(await camera(reader)).toEqual(view)
    } finally { await reader?.close(); if (!page.isClosed()) await page.goto('about:blank'); await server.close() }
  })
  test('an available update waits, protects the card draft and camera, and reloads only through an explicit action', async ({ page }) => {
    const server = await productionServer()
    try {
      await seed(page, server.origin); await openRoom(page); await card(page).getByRole('button', { name: 'Редактировать', exact: true }).click(); await page.getByLabel('Название области', { exact: true }).fill('Черновик обновления')
      const view: Camera = await camera(page); server.update(); await clickMenuAction(page, 'Проверить обновления'); await expect(button(page, 'Применить обновление')).toBeVisible(); await expect(button(page, 'Применить обновление')).toBeDisabled()
      await expect(page.getByLabel('Название области', { exact: true })).toHaveValue('Черновик обновления'); expect(await camera(page)).toEqual(view)
      await card(page).getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(button(page, 'Применить обновление')).toBeEnabled()
      await Promise.all([page.waitForEvent('load'), clickMenuAction(page, 'Применить обновление')]); await expect(page.getByText('Готово к работе без сети', { exact: true })).toBeVisible(); await openRoom(page); await expect(card(page).getByRole('heading', { level: 2 })).toContainText('Черновик обновления')
    } finally { await page.goto('about:blank'); await server.close() }
  })
})
