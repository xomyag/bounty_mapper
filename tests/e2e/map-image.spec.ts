import { finishProjectCreation } from './controls'
import { clickMenuAction, control } from './controls'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function createProject(page: Page, name: string) {
  await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill(name)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await finishProjectCreation(page)
  await expect(control(page, 'Загрузить карту')).toBeEnabled()
}

async function raster(page: Page, mimeType = 'image/png', width = 320, height = 160) {
  const base64 = await page.evaluate(({ mimeType, width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c95544'; ctx.fillRect(0, 0, width / 2, height)
    ctx.fillStyle = '#376ead'; ctx.fillRect(width / 2, 0, width / 2, height)
    return canvas.toDataURL(mimeType).split(',')[1]
  }, { mimeType, width, height })
  return { name: `map.${mimeType.split('/')[1]}`, mimeType, buffer: Buffer.from(base64, 'base64') }
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('bounty-mapper')
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const tx = db.transaction(['maps', 'assets', 'imagePlacements'], 'readonly')
    const read = (name: string) => new Promise<unknown[]>((resolve) => {
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => resolve(request.result)
    })
    const [maps, assets, placements] = await Promise.all([read('maps'), read('assets'), read('imagePlacements')])
    db.close()
    return { maps, assets: (assets as { id: string; mimeType: string; byteSize: number; pixelWidth: number; pixelHeight: number; blob: Blob }[]).map((asset) => ({ id: asset.id, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.pixelWidth, height: asset.pixelHeight, blobSize: asset.blob.size })), placements }
  })
}

async function visibleMap(page: Page) {
  await expect(control(page, 'Заменить изображение')).toBeEnabled()
  await expect(page.getByText('Подготовка изображения…')).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(1)
  // Check actual canvas pixels: both halves of the uploaded rectangular image are drawn.
  await expect.poll(() => page.locator('canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let red = 0; let blue = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 150 && data[i + 2] < 120) red++
      if (data[i + 2] > 140 && data[i] < 120) blue++
    }
    return red > 100 && blue > 100
  })).toBe(true)
}

async function drawnBounds(page: Page) {
  return page.locator('canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let left = canvas.width; let right = -1; let top = canvas.height; let bottom = -1
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 200) {
        left = Math.min(left, x); right = Math.max(right, x)
        top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
    }
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  })
}

test('PNG/JPEG/WebP render; pan and pointer zoom preserve placement; project maps survive reload and switching', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await createProject(page, 'Первая карта')
  await page.getByLabel('Файл изображения карты').setInputFiles(await raster(page))
  await visibleMap(page)
  const before = await stored(page)
  expect(before.assets[0]).toMatchObject({ width: 320, height: 160, mimeType: 'image/png' })
  const region = page.getByRole('region', { name: 'Карта приключения' })
  const box = (await region.boundingBox())!
  const x = box.x + box.width / 2; const y = box.y + box.height / 2
  const initialBounds = await drawnBounds(page)
  expect(initialBounds.width / initialBounds.height).toBeCloseTo(2, 2)
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y + 10, { steps: 5 }); await page.mouse.up()
  await expect.poll(async () => (await drawnBounds(page)).x).toBe(initialBounds.x + 20)
  await expect.poll(async () => (await drawnBounds(page)).y).toBe(initialBounds.y + 10)
  const beforeZoom = await drawnBounds(page)
  const pointer = { x: box.width / 2 + 30, y: box.height / 2 - 20 }
  await page.mouse.move(box.x + pointer.x, box.y + pointer.y); await page.mouse.wheel(0, 200)
  await expect.poll(async () => (await drawnBounds(page)).width).toBeLessThan(beforeZoom.width)
  const afterZoom = await drawnBounds(page)
  // Infer world coordinates from rendered bounds, allowing one source pixel for raster rounding.
  expect(Math.abs((pointer.x - beforeZoom.x) / beforeZoom.width * 320 - (pointer.x - afterZoom.x) / afterZoom.width * 320)).toBeLessThan(1)
  expect(Math.abs((pointer.y - beforeZoom.y) / beforeZoom.height * 160 - (pointer.y - afterZoom.y) / afterZoom.height * 160)).toBeLessThan(1)
  await expect(region).toBeVisible()
  expect((await stored(page)).placements).toEqual(before.placements)
  await page.getByRole('button', { name: 'Показать всю карту' }).click()
  await page.getByRole('button', { name: 'Контекст приключения', exact: true }).click()
  const info = page.getByRole('region', { name: 'Контекст приключения', exact: true })
  await info.getByRole('button', { name: 'Заполнить' }).click()
  await page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true }).fill('Контекст рядом с картой')
  await info.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(info.getByRole('status')).toHaveText('Сохранено на устройстве')
  await page.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
  await page.reload()
  await visibleMap(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await stored(page)).placements).toEqual(before.placements)
  await createProject(page, 'Вторая карта')
  await page.getByLabel('Файл изображения карты').setInputFiles(await raster(page, 'image/jpeg', 200, 100))
  await visibleMap(page)
  await page.getByLabel('Файл изображения карты').setInputFiles(await raster(page, 'image/webp', 400, 200))
  await visibleMap(page)
  const second = await stored(page)
  expect(second.maps).toHaveLength(2)
  expect(second.assets).toHaveLength(2)
  expect(second.assets.some((asset) => asset.mimeType === 'image/webp' && asset.width === 400)).toBe(true)
  await clickMenuAction(page, 'Проекты')
  await page.getByRole('button', { name: 'Открыть проект «Первая карта»' }).click()
  await visibleMap(page)
  await page.getByRole('button', { name: 'Контекст приключения', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Контекст приключения', exact: true })).toContainText('Контекст рядом с картой')
  await page.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
  await page.reload(); await visibleMap(page)
  expect(errors).toEqual([])
})

test('invalid files and failed storage keep the previous image; replacement retry and removal are persistent', async ({ page }) => {
  await page.goto('/')
  await createProject(page, 'Ошибки изображения')
  await page.getByLabel('Файл изображения карты').setInputFiles(await raster(page))
  await visibleMap(page)
  const original = await stored(page)
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  await expect(page.getByRole('alert')).toContainText('Неподдерживаемый файл')
  expect((await stored(page)).assets).toEqual(original.assets)
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]) })
  await expect(page.getByRole('alert')).toContainText('декодировать')
  expect((await stored(page)).assets).toEqual(original.assets)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    Object.defineProperty(window, '__testOriginalPut', { value: put, configurable: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'projects') throw new DOMException('Тестовая ошибка квоты', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.getByLabel('Файл изображения карты').setInputFiles(await raster(page, 'image/webp', 600, 300))
  await expect(page.getByRole('alert')).toContainText('Ошибка записи изображения')
  expect(await stored(page)).toEqual(original)
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as unknown as { __testOriginalPut: typeof IDBObjectStore.prototype.put }).__testOriginalPut
  })
  await page.getByRole('button', { name: 'Повторить загрузку карты' }).click()
  await visibleMap(page)
  expect((await stored(page)).assets[0]).toMatchObject({ width: 600, height: 300, mimeType: 'image/webp' })
  page.once('dialog', (dialog) => dialog.accept())
  await clickMenuAction(page, 'Удалить изображение')
  await expect(control(page, 'Загрузить карту')).toBeEnabled()
  expect((await stored(page)).assets).toEqual([])
  await page.reload()
  await expect(control(page, 'Загрузить карту')).toBeEnabled()
  expect((await stored(page)).maps).toHaveLength(1)
})
