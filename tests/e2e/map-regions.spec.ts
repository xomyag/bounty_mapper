import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Region } from '../../src/domain/region'
import type { ImagePlacement } from '../../src/domain/project'
import { fitBounds, screenToWorld, worldToScreen, zoomAt } from '../../src/domain/viewport'

async function seed(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Проекты', exact: true }).click()
  await page.getByLabel('Название нового проекта').fill('Карта с областями')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Сохранено на устройстве')
  await page.getByRole('button', { name: 'Закрыть окно проекта' }).click()
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#466778'; ctx.fillRect(0, 0, 400, 300)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await expect(page.getByText('Подготовка изображения…')).toHaveCount(0)
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['regions', 'imagePlacements'], 'readonly')
    const get = <T,>(name: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result as T[]) })
    const regions = get<Region>('regions'); const placements = get<ImagePlacement>('imagePlacements')
    const result = { regions: await regions, placements: await placements }; db.close(); return result
  })
}
async function createSquare(page: Page) {
  const box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  for (const [x, y] of [[120, 130], [320, 130], [320, 330], [120, 330]]) await page.mouse.click(box.x + x, box.y + y)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('group', { name: 'Создание области' })).toHaveCount(0)
  await expect.poll(async () => (await stored(page)).regions.length).toBe(1)
  return box
}
async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeEnabled()
}
async function canvasFrame(page: Page) {
  // Konva updates its visible and hit canvases on animation frames after React commits.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test('polygon drag/vertices stay in world coordinates, one drag is one undo; metadata, reload, archives and image removal', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await seed(page)
  await expect(page.getByRole('region', { name: 'Свойства области' })).toHaveCount(0)
  const box = await createSquare(page)
  const original = (await stored(page)).regions[0]
  expect(original).toMatchObject({ fillOpacity: 0.4, number: 1, title: 'Область 1' })
  await drag(page, { x: box.x + 200, y: box.y + 220 }, { x: box.x + 240, y: box.y + 250 })
  const moved = (await stored(page)).regions[0]
  await expect(page.getByRole('region', { name: 'Карточка области', exact: true })).toHaveCount(0)
  expect(moved.vertices[0].x).toBeGreaterThan(original.vertices[0].x)
  for (let i = 1; i < 4; i++) {
    expect(moved.vertices[i].x - original.vertices[i].x).toBeCloseTo(moved.vertices[0].x - original.vertices[0].x)
    expect(moved.vertices[i].y - original.vertices[i].y).toBeCloseTo(moved.vertices[0].y - original.vertices[0].y)
  }
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0]).toEqual(original)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0]).toEqual(moved)

  const placement = (await stored(page)).placements[0]
  let camera = fitBounds(placement, { width: box.width, height: box.height })
  const screenPointer = { x: 500, y: 350 }
  await page.mouse.move(box.x + screenPointer.x, box.y + screenPointer.y); await page.mouse.wheel(0, 120)
  camera = zoomAt(camera, screenPointer, camera.scale * Math.exp(-120 * 0.002))
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight')
  camera = { ...camera, x: camera.x - 40 }
  expect((await stored(page)).regions[0]).toEqual(moved)
  expect((await stored(page)).placements[0]).toEqual(placement)
  const center = worldToScreen({ x: (moved.vertices[0].x + moved.vertices[2].x) / 2, y: (moved.vertices[0].y + moved.vertices[2].y) / 2 }, camera)
  await page.mouse.click(box.x + center.x, box.y + center.y)
  await page.getByRole('button', { name: 'Редактировать вершины', exact: true }).click()
  await canvasFrame(page)
  const first = worldToScreen(moved.vertices[0], camera)
  await drag(page, { x: box.x + first.x, y: box.y + first.y }, { x: box.x + first.x + 30, y: box.y + first.y + 10 })
  const edited = (await stored(page)).regions[0]
  await expect(page.getByRole('region', { name: 'Карточка области', exact: true })).toHaveCount(1)
  expect(edited.vertices[0].x).toBeCloseTo(moved.vertices[0].x + 30 / camera.scale)
  expect(edited.vertices[0].y).toBeCloseTo(moved.vertices[0].y + 10 / camera.scale)
  expect(edited.vertices.slice(1)).toEqual(moved.vertices.slice(1))
  const midpoint = { x: (edited.vertices[0].x + edited.vertices[1].x) / 2, y: (edited.vertices[0].y + edited.vertices[1].y) / 2 }
  const screenMid = worldToScreen(midpoint, camera)
  await page.mouse.click(box.x + screenMid.x, box.y + screenMid.y)
  await expect.poll(async () => (await stored(page)).regions[0].vertices.length).toBe(5)
  await expect(page.getByRole('button', { name: 'Закончить правку вершин' })).toBeEnabled()
  await canvasFrame(page)
  await page.mouse.click(box.x + screenMid.x, box.y + screenMid.y)
  await page.getByRole('button', { name: 'Удалить вершину', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].vertices.length).toBe(4)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].vertices.length).toBe(5)
  await page.getByRole('button', { name: 'Закончить правку вершин' }).click()
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Номер области', { exact: true }).fill('12')
  await page.getByLabel('Название области', { exact: true }).fill('Зал сокровищ')
  await page.getByRole('button', { name: 'Цвет области', exact: true }).click()
  await page.getByLabel('HEX цвета', { exact: true }).fill('#22aa77')
  await expect(page.getByRole('dialog', { name: 'Палитра цвета области', exact: true })).toBeVisible()
  await page.getByLabel('Название области', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Палитра цвета области', exact: true })).toHaveCount(0)
  await page.getByLabel('Непрозрачность заливки').focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 65; i++) await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].title).toBe('Зал сокровищ')
  const saved = (await stored(page)).regions[0]
  expect(saved).toMatchObject({ number: 12, color: '#22aa77', fillOpacity: 0.65 })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Свойства области' })).toHaveCount(0)
  expect((await stored(page)).regions[0]).toEqual(saved)

  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт проекта' }).click()
  const path = info.outputPath('regions.zip'); await (await downloading).saveAs(path)
  const files = unzipSync(new Uint8Array(await readFile(path)))
  const document = JSON.parse(new TextDecoder().decode(files['project.json'])) as { regions: Region[] }
  expect(document.regions).toEqual([saved])
  await page.getByLabel('Архив проекта', { exact: true }).setInputFiles(path)
  await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  const copy = (await stored(page)).regions.find((r) => r.id !== saved.id)!
  expect(copy.vertices).toEqual(saved.vertices); expect(copy.mapId).not.toBe(saved.mapId)
  await page.getByRole('button', { name: 'Закрыть сообщение об архиве' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Удалить изображение', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Карта приключения' })).toBeVisible()
  expect((await stored(page)).regions.find((r) => r.id === copy.id)).toEqual(copy)
  expect(errors).toEqual([])
})

test('double-click finishes without duplicate, Esc/draft export, context menu and failed writes', async ({ page }, info) => {
  await seed(page)
  let box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  await page.mouse.click(box.x + 120, box.y + 130); await page.mouse.click(box.x + 320, box.y + 130)
  await page.mouse.dblclick(box.x + 220, box.y + 330)
  await expect.poll(async () => (await stored(page)).regions.length).toBe(1)
  expect((await stored(page)).regions[0].vertices).toHaveLength(3)
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  await page.mouse.click(box.x + 500, box.y + 100); await page.mouse.click(box.x + 650, box.y + 100)
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Экспорт проекта' }).click()
  const path = info.outputPath('no-draft.zip'); await (await downloading).saveAs(path)
  const files = unzipSync(new Uint8Array(await readFile(path)))
  expect((JSON.parse(new TextDecoder().decode(files['project.json'])) as { regions: Region[] }).regions).toHaveLength(1)
  await page.getByRole('button', { name: 'Закрыть сообщение об архиве' }).click()
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Создание области' })).toHaveCount(0)
  box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.mouse.click(box.x + 500, box.y + 100, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Добавить область', exact: true }).click()
  await page.mouse.click(box.x + 650, box.y + 100); await page.mouse.click(box.x + 550, box.y + 250)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    Object.defineProperty(window, '__regionPut', { value: put, configurable: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'projects') throw new DOMException('Тестовая ошибка области', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Тестовая ошибка области')
  expect((await stored(page)).regions).toHaveLength(1)
  await expect(page.getByRole('group', { name: 'Создание области' })).toContainText('Вершин: 3')
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __regionPut: typeof IDBObjectStore.prototype.put }).__regionPut })
  await page.getByRole('button', { name: 'Повторить запись областей', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions.length).toBe(2)
  await expect(page.getByRole('group', { name: 'Создание области' })).toHaveCount(0)
  box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.mouse.click(box.x + 566, box.y + 150)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить область', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions.length).toBe(1)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions.length).toBe(2)
})

test('rejects self-crossing drafts and rereads the same project after a revision conflict', async ({ page, context }) => {
  await seed(page)
  const box = await createSquare(page)
  const other = await context.newPage(); await other.goto('/')
  await expect(other.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  const otherBox = (await other.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await other.mouse.click(otherBox.x + 220, otherBox.y + 230)
  await expect(other.getByLabel('Название области', { exact: true })).toHaveValue('Область 1')
  await page.mouse.click(box.x + 220, box.y + 230)
  await page.getByLabel('Название области', { exact: true }).fill('Название из первой вкладки')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].title).toBe('Название из первой вкладки')
  await other.getByLabel('Название области', { exact: true }).fill('Несохранённый текст второй вкладки')
  await other.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(other.getByRole('alert')).toContainText('другой вкладке')
  await expect(other.getByLabel('Название области', { exact: true })).toHaveValue('Несохранённый текст второй вкладки')
  // Discard is explicit; an unsuccessful card write must not silently lose its draft on reopen.
  await other.getByRole('button', { name: 'Отмена', exact: true }).click()
  await other.getByRole('button', { name: 'Проекты', exact: true }).click()
  await other.getByRole('button', { name: 'Открыть проект «Карта с областями»' }).click()
  await expect(other.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await expect(other.getByRole('region', { name: 'Свойства области' })).toHaveCount(0)
  await other.mouse.click(otherBox.x + 220, otherBox.y + 230)
  await other.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await expect(other.getByLabel('Название области', { exact: true })).toHaveValue('Название из первой вкладки')
  await expect(other.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled()
  await other.close()

  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  for (const [x, y] of [[500, 120], [700, 320], [500, 320], [700, 120]]) await page.mouse.click(box.x + x, box.y + y)
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('пересекать себя')
  expect((await stored(page)).regions).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Создание области' })).toHaveCount(0)
})

test('moves draft handles under pan/zoom and deletes handles by double click without completing the draft', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await seed(page)
  const box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  const placement = (await stored(page)).placements[0]
  const initialCamera = fitBounds(placement, { width: box.width, height: box.height })
  const points = [{ x: 120, y: 130 }, { x: 320, y: 130 }, { x: 320, y: 330 }, { x: 120, y: 330 }]
  const vertices = points.map((p) => screenToWorld(p, initialCamera))
  await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
  for (const point of points) await page.mouse.click(box.x + point.x, box.y + point.y)
  const zoomPointer = { x: 500, y: 350 }
  await page.mouse.move(box.x + zoomPointer.x, box.y + zoomPointer.y); await page.mouse.wheel(0, 120)
  let camera = zoomAt(initialCamera, zoomPointer, initialCamera.scale * Math.exp(-120 * 0.002))
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight')
  camera = { ...camera, x: camera.x - 40 }
  const first = worldToScreen(vertices[0], camera)
  await page.mouse.move(box.x + first.x, box.y + first.y); await page.mouse.down()
  await page.mouse.move(box.x + first.x + 30, box.y + first.y + 10, { steps: 12 }); await page.mouse.up()
  await expect(page.getByRole('group', { name: 'Создание области' })).toContainText('Вершин: 4')
  expect((await stored(page)).regions).toEqual([])
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled()
  const second = worldToScreen(vertices[1], camera)
  await page.mouse.dblclick(box.x + second.x, box.y + second.y)
  await expect(page.getByRole('group', { name: 'Создание области' })).toContainText('Вершин: 3')
  expect((await stored(page)).regions).toEqual([])
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await stored(page)).regions.length).toBe(1)
  await expect(page.getByRole('group', { name: 'Создание области' })).toHaveCount(0)
  const saved = (await stored(page)).regions[0]
  expect(saved.vertices).toHaveLength(3)
  expect(saved.vertices[0].x).toBeCloseTo(vertices[0].x + 30 / camera.scale)
  expect(saved.vertices[0].y).toBeCloseTo(vertices[0].y + 10 / camera.scale)
  expect(saved.vertices.slice(1)).toEqual(vertices.slice(2))
  expect((await stored(page)).placements[0]).toEqual(placement)

  const center = worldToScreen({ x: saved.vertices.reduce((sum, p) => sum + p.x, 0) / 3, y: saved.vertices.reduce((sum, p) => sum + p.y, 0) / 3 }, camera)
  await page.mouse.click(box.x + center.x, box.y + center.y)
  await page.getByRole('button', { name: 'Редактировать вершины', exact: true }).click()
  await canvasFrame(page)
  const midpoint = { x: (saved.vertices[0].x + saved.vertices[1].x) / 2, y: (saved.vertices[0].y + saved.vertices[1].y) / 2 }
  const screenMid = worldToScreen(midpoint, camera)
  await page.mouse.click(box.x + screenMid.x, box.y + screenMid.y)
  await expect.poll(async () => (await stored(page)).regions[0].vertices.length).toBe(4)
  await expect(page.getByRole('button', { name: 'Закончить правку вершин' })).toBeEnabled()
  await canvasFrame(page)
  const four = (await stored(page)).regions[0]
  await page.mouse.dblclick(box.x + screenMid.x, box.y + screenMid.y)
  await expect.poll(async () => (await stored(page)).regions[0].vertices.length).toBe(3)
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0]).toEqual(four)
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].vertices.length).toBe(3)
  await expect(page.getByRole('button', { name: 'Закончить правку вершин' })).toBeEnabled()
  const movedFirst = worldToScreen(saved.vertices[0], camera)
  await page.mouse.dblclick(box.x + movedFirst.x, box.y + movedFirst.y)
  await expect(page.getByRole('alert')).toContainText('минимум три')
  expect((await stored(page)).regions[0].vertices).toEqual(saved.vertices)
  expect(errors).toEqual([])
})

test('keeps the first color palette open through choices and closes on outside click or Escape', async ({ page }) => {
  await seed(page); const box = await createSquare(page)
  await page.mouse.click(box.x + 220, box.y + 230)
  const trigger = page.getByRole('button', { name: 'Цвет области', exact: true })
  const palette = page.getByRole('dialog', { name: 'Палитра цвета области', exact: true })
  await trigger.click()
  await expect(palette).toBeVisible()
  await palette.getByRole('button', { name: 'Красный (#ef6543)', exact: true }).click()
  await expect(palette).toBeVisible()
  await expect(page.getByRole('region', { name: 'Карточка области', exact: true })).toHaveCount(1)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(palette.getByLabel('HEX цвета')).toHaveValue('#ef6543')
  await palette.getByRole('button', { name: 'Синий (#4a90e2)', exact: true }).click()
  await expect(palette).toBeVisible()
  await palette.getByLabel('HEX цвета').fill('#22aa77')
  await expect(palette).toBeVisible()
  await palette.getByLabel('Красный канал').focus(); await page.keyboard.press('Home')
  await expect(palette.getByLabel('HEX цвета')).toHaveValue('#00aa77')
  await expect(palette).toBeVisible()
  // Color choices edit the single draft; writing remains explicit via Save.
  expect((await stored(page)).regions[0].color).toBe('#d7ad62')
  await page.getByLabel('Название области', { exact: true }).click()
  await expect(palette).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(palette.getByLabel('HEX цвета')).toHaveValue('#00aa77')
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect.poll(async () => (await stored(page)).regions[0].color).toBe('#00aa77')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  expect((await stored(page)).regions[0].color).toBe('#00aa77')
})
