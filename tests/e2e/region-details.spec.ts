import { finishProjectCreation } from './controls'
import { clickMenuAction } from './controls'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Region } from '../../src/domain/region'
import { fitBounds, worldToScreen, zoomAt } from '../../src/domain/viewport'
import { documentText } from '../../src/domain/richText'

async function stored(page: Page): Promise<Region[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction('regions', 'readonly')
    const rows = await new Promise<Region[]>((resolve) => { const r = tx.objectStore('regions').getAll(); r.onsuccess = () => resolve(r.result) })
    db.close(); return rows.sort((a, b) => a.number - b.number)
  })
}
async function seed(page: Page) {
  await page.goto('/')
  await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Карточки')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await finishProjectCreation(page)
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#466778'; ctx.fillRect(0, 0, 400, 300)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await expect(page.getByText('Подготовка изображения…')).toHaveCount(0)
  const box = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  for (const offset of [0, 280]) {
    await page.getByRole('button', { name: 'Добавить область', exact: true }).click()
    for (const [x, y] of [[120, 130], [320, 130], [320, 330], [120, 330]]) await page.mouse.click(box.x + x + offset, box.y + y)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Создание области' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  }
  await expect(page.getByRole('region', { name: 'Карточка области' })).toHaveCount(0)
  return box
}
const card = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })

test('one panel, empty/edit and filled/view modes; toolbar keeps selection, all fields save/cancel together', async ({ page }) => {
  const box = await seed(page)
  const original = (await stored(page))[0]
  await page.mouse.click(box.x + 220, box.y + 230)
  const notes = page.getByRole('textbox', { name: 'Заметки ведущего', exact: true })
  const toolbar = page.getByRole('toolbar', { name: 'Форматирование: Заметки ведущего' })
  await expect(notes).toBeVisible()
  await expect(page.locator('.region-card')).toHaveCount(1)
  await expect(page.locator('.region-tools')).toHaveCount(0)
  await notes.fill('Тайная комната'); await notes.press('Control+a')
  await toolbar.getByRole('button', { name: 'Жирный', exact: true }).click()
  await expect(notes.locator('strong')).toHaveText('Тайная комната')
  await toolbar.getByRole('button', { name: 'Курсив', exact: true }).click()
  await toolbar.getByRole('button', { name: 'Подчёркнутый', exact: true }).click()
  await toolbar.getByRole('combobox', { name: 'Тип текста: Заметки ведущего' }).selectOption('2')
  await expect(notes.locator('h2')).toHaveText('Тайная комната')
  await toolbar.getByRole('button', { name: 'Ещё', exact: true }).click()
  await toolbar.getByRole('button', { name: 'Ссылка', exact: true }).click()
  await page.getByLabel('Адрес ссылки: Заметки ведущего').fill('https://example.org')
  await page.getByRole('button', { name: 'Применить ссылку', exact: true }).click()
  await expect(notes.locator('a')).toHaveAttribute('href', 'https://example.org')
  await page.getByRole('textbox', { name: 'Описание для игроков', exact: true }).fill('Дверь закрыта')
  await page.getByLabel('Номер области', { exact: true }).fill('7')
  await page.getByLabel('Название области', { exact: true }).fill('Сокровищница')
  await page.getByRole('button', { name: 'Добавить проверку', exact: true }).click()
  await page.getByLabel('Условие проверки 1').fill('Открытие двери')
  await page.getByLabel('Навык проверки 1').fill('Сила')
  await page.getByLabel('СЛ проверки 1').fill('15')
  await page.getByLabel('Результат проверки 1').fill('Дверь открыта')
  await page.getByLabel('Новый тег').fill('ловушка'); await page.getByRole('button', { name: 'Добавить тег', exact: true }).click()
  expect(documentText((await stored(page)).find((r) => r.id === original.id)!.gmNotes)).toBe('')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  await expect(notes).toHaveCount(0)
  await expect(card(page).getByRole('heading', { name: 'Тайная комната' })).toBeVisible()
  const saved = (await stored(page)).find((r) => r.id === original.id)!
  expect(saved).toMatchObject({ title: 'Сокровищница', titleCustomized: true, number: 7, tags: ['ловушка'], checks: [{ condition: 'Открытие двери', ability: 'Сила', dc: 15, result: 'Дверь открыта', id: expect.any(String) }] })
  expect(saved.vertices).toEqual(original.vertices)
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await page.getByLabel('Название области', { exact: true }).fill('Отменить всё')
  await notes.fill('Новый текст')
  await page.getByRole('button', { name: 'Удалить проверку 1' }).click()
  await page.getByRole('button', { name: 'Удалить тег «ловушка»' }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect((await stored(page)).find((r) => r.id === original.id)).toEqual(saved)
  await expect(card(page).getByRole('heading', { name: 'Тайная комната' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
  await page.mouse.move(box.x + 221, box.y + 231)
  await expect(page.getByRole('tooltip')).toContainText('7. Сокровищница')
  await expect(page.getByRole('tooltip')).toContainText('ловушка')
  await expect(page.getByRole('tooltip')).not.toContainText('Тайная комната')
  await page.mouse.move(box.x + 700, box.y + 350); await page.mouse.wheel(0, 120)
  const initial = fitBounds({ x: 0, y: 0, width: 400, height: 300 }, box)
  const camera = zoomAt(initial, { x: 700, y: 350 }, initial.scale * Math.exp(-120 * .002))
  await page.getByRole('region', { name: 'Карта приключения' }).focus(); await page.keyboard.press('ArrowRight'); camera.x -= 40
  const anchor = worldToScreen({ x: (original.vertices[0].x + original.vertices[2].x) / 2, y: (original.vertices[0].y + original.vertices[2].y) / 2 }, camera)
  await page.mouse.click(box.x + anchor.x, box.y + anchor.y)
  await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
  await page.mouse.click(box.x + anchor.x, box.y + anchor.y)
  await expect(card(page)).toBeVisible()
})

test('dirty close/switch offers three choices; save failure preserves fields and destination', async ({ page }) => {
  const box = await seed(page); const [a, b] = await stored(page)
  await page.mouse.click(box.x + 220, box.y + 230)
  const notes = page.getByRole('textbox', { name: 'Заметки ведущего', exact: true })
  const prompt = page.getByRole('dialog', { name: 'Несохранённые изменения области' })
  await notes.fill('Черновик A')
  await page.mouse.click(box.x + 500, box.y + 230)
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(notes).toHaveText('Черновик A')
  await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
  await prompt.getByRole('button', { name: 'Отбросить изменения' }).click()
  await expect(card(page)).toHaveCount(0)
  expect(documentText((await stored(page)).find((r) => r.id === a.id)!.gmNotes)).toBe('')
  await page.mouse.click(box.x + 220, box.y + 230); await notes.fill('Сохранить A')
  await page.mouse.click(box.x + 500, box.y + 230)
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(notes).toHaveText('')
  expect(documentText((await stored(page)).find((r) => r.id === a.id)!.gmNotes)).toBe('Сохранить A')
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    Object.defineProperty(window, '__originalPut', { value: put, configurable: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Нет места для карточки', 'QuotaExceededError'); return put.apply(this, args) }
  })
  await notes.fill('Не потерять B'); await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
  await prompt.getByRole('button', { name: 'Сохранить и продолжить' }).click()
  await expect(prompt.getByRole('alert')).toContainText('Нет места для карточки')
  expect(documentText((await stored(page)).find((r) => r.id === b.id)!.gmNotes)).toBe('')
  await prompt.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(notes).toHaveText('Не потерять B')
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __originalPut: typeof IDBObjectStore.prototype.put }).__originalPut })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  expect(documentText((await stored(page)).find((r) => r.id === b.id)!.gmNotes)).toBe('Не потерять B')
})

test('pastes cleaned HTML/plain text and a screenshot; assets survive failed writes, reload, archive and deletion', async ({ page, context }, info) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message))
  const box = await seed(page); const [a] = await stored(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.mouse.click(box.x + 220, box.y + 230)
  const notes = page.getByRole('textbox', { name: 'Заметки ведущего', exact: true })
  await page.evaluate(async () => {
    const html = '<h2>Вставленный зал</h2><p><strong>Золото</strong> и <em>пыль</em>, <u>важно</u>, <a href="https://example.org">ссылка</a><a href="javascript:alert(1)">опасно</a></p><ul><li>Первый</li></ul><ol><li>Второй</li></ol><blockquote>Цитата</blockquote><table><tr><th>Навык</th><th>СЛ</th></tr><tr><td>Сила</td><td>15</td></tr></table><script>window.compromised=true</script><img src="x" onerror="window.compromised=true">'
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob(['Запасной текст'], { type: 'text/plain' }) })])
  })
  await notes.focus(); await page.keyboard.press('Control+v')
  await expect(notes.locator('h2')).toHaveText('Вставленный зал')
  await expect(notes.locator('table')).toBeVisible()
  await expect(notes.locator('strong')).toHaveText('Золото')
  await expect(notes.locator('u')).toHaveText('важно')
  await expect(notes.locator('a')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { compromised?: boolean }).compromised)).toBeUndefined()
  await notes.press('Control+End')
  await page.evaluate(async () => { await navigator.clipboard.writeText('Обычный **текст**') })
  await page.keyboard.press('Control+v')
  await expect(notes).toContainText('Обычный **текст**')
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#dfb577'; ctx.fillRect(0, 0, 80, 40)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await notes.focus(); await page.keyboard.press('Control+v')
  await expect(notes.locator('img')).toBeVisible()
  await page.getByLabel('Изображение: Описание для игроков').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('textbox', { name: 'Описание для игроков', exact: true }).locator('img')).toBeVisible()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    Object.defineProperty(window, '__imagePut', { value: put, configurable: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { if (this.name === 'projects') throw new DOMException('Нет места для изображений', 'QuotaExceededError'); return put.apply(this, args) }
  })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('alert')).toContainText('Нет места для изображений')
  await expect(card(page).locator('img')).toHaveCount(2)
  expect(documentText((await stored(page)).find((r) => r.id === a.id)!.gmNotes)).toBe('')
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __imagePut: typeof IDBObjectStore.prototype.put }).__imagePut })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
  const saved = (await stored(page)).find((r) => r.id === a.id)!
  expect(JSON.stringify(saved)).not.toContain('blob:')
  await expect(card(page).locator('img')).toHaveCount(2)
  await page.reload(); await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  await expect(card(page)).toHaveCount(0)
  const fresh = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.mouse.click(fresh.x + 220, fresh.y + 230)
  await expect(card(page).locator('img')).toHaveCount(2)
  const sizes = await card(page).locator('img').first().evaluate((img: HTMLImageElement) => ({ width: img.width, height: img.height, naturalWidth: img.naturalWidth }))
  expect(sizes.naturalWidth).toBe(80); expect(sizes.width / sizes.height).toBeCloseTo(2)
  const downloading = page.waitForEvent('download'); await clickMenuAction(page, 'Экспорт проекта')
  const path = info.outputPath('visual-details.zip'); await (await downloading).saveAs(path)
  const entries = unzipSync(new Uint8Array(await readFile(path)))
  expect(JSON.parse(new TextDecoder().decode(entries['manifest.json'])).formatVersion).toBe(8)
  await page.getByLabel('Архив проекта', { exact: true }).setInputFiles(path)
  await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть сообщение об архиве' }).click()
  await expect(page.getByRole('button', { name: 'Добавить область', exact: true })).toBeEnabled()
  const copyBox = (await page.getByRole('region', { name: 'Карта приключения' }).boundingBox())!
  await page.mouse.click(copyBox.x + 220, copyBox.y + 230)
  await expect(card(page).locator('img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await notes.getByRole('button', { name: 'Удалить изображение из текста' }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card(page).locator('img')).toHaveCount(1)
  expect((await stored(page)).find((r) => r.id === a.id)).toEqual(saved)
  expect(errors).toEqual([])
})

test('touch opens one card; text undo does not undo map geometry; technical empty blocks stay empty', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ hasTouch: true, baseURL, viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    const box = await seed(page); const original = await stored(page)
    await page.touchscreen.tap(box.x + 220, box.y + 230)
    const notes = page.getByRole('textbox', { name: 'Заметки ведущего', exact: true })
    await expect(notes).toBeVisible()
    await notes.fill('Текст для отмены')
    await notes.press('Control+z')
    await expect(notes).not.toContainText('Текст для отмены')
    expect(await stored(page)).toEqual(original)
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
    await notes.focus(); await notes.press('Enter')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
    await page.touchscreen.tap(box.x + 220, box.y + 230)
    await expect(notes).toBeVisible()
    await page.getByLabel('Название области', { exact: true }).fill('Особая область')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(card(page).getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть карточку области' }).click()
    await page.touchscreen.tap(box.x + 220, box.y + 230)
    await expect(notes).toHaveCount(0)
    await expect(page.locator('.region-card')).toHaveCount(1)
  } finally { await context.close() }
})
