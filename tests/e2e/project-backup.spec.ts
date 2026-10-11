async function saveContext(page: Page) {
  const card = page.getByRole('region', { name: 'Контекст приключения', exact: true }); await card.getByRole('button', { name: 'Сохранить', exact: true }).click(); await expect(card.getByRole('status')).toHaveText('Сохранено на устройстве')
}
async function openContextEditor(page: Page) {
  await page.getByRole('button', { name: 'Контекст приключения', exact: true }).click(); const card = page.getByRole('region', { name: 'Контекст приключения', exact: true }); await card.getByRole('button', { name: 'Редактировать' }).click()
}
import { clickMenuAction, control } from './controls'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { zipSync, unzipSync } from 'fflate'
import { expect } from '@playwright/test'
import { test } from './testLocale'
import type { Page } from '@playwright/test'

async function seed(page: Page) {
  await page.goto('/')
  await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Исходное приключение')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true }).fill('Исходный контекст')
  await saveContext(page)
  await page.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#c95544'; ctx.fillRect(0, 0, 64, 32)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('Файл изображения карты').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(control(page, 'Заменить изображение')).toBeEnabled()
  await expect(page.getByText('Подготовка изображения…')).toHaveCount(0)
}

async function counts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['projects', 'maps', 'assets', 'imagePlacements', 'settings'], 'readonly')
    const getAll = (store: string) => new Promise<unknown[]>((resolve) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result) })
    const projects = getAll('projects'); const maps = getAll('maps'); const assets = getAll('assets'); const placements = getAll('imagePlacements')
    const active = new Promise<string>((resolve) => { const r = tx.objectStore('settings').get('activeProjectId'); r.onsuccess = () => resolve(r.result) })
    const result = { projects: (await projects).length, maps: (await maps).length, assets: (await assets).length, placements: (await placements).length, active: await active }
    db.close(); return result
  })
}

test('exports latest context and native image; imports an independent copy that survives reload', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await seed(page)
  await openContextEditor(page)
  await page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true }).fill('Последний контекст перед экспортом')
  await saveContext(page)
  await page.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
  const downloading = page.waitForEvent('download')
  await clickMenuAction(page, 'Экспорт проекта')
  const download = await downloading
  const path = info.outputPath('backup.zip')
  await download.saveAs(path)
  const entries = unzipSync(new Uint8Array(await readFile(path)))
  const document = JSON.parse(new TextDecoder().decode(entries['project.json']))
  expect(JSON.stringify(document.project.context)).toContain('Последний контекст перед экспортом')
  expect(document.assets[0]).toMatchObject({ pixelWidth: 64, pixelHeight: 32, mimeType: 'image/png' })
  expect(entries[document.assets[0].path].length).toBe(document.assets[0].byteSize)
  const before = await counts(page)
  await page.getByLabel('Архив проекта').setInputFiles(path)
  await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible()
  await expect(control(page, 'Заменить изображение')).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const after = await counts(page)
  expect(after).toMatchObject({ projects: 2, maps: 2, assets: 2, placements: 2 })
  expect(after.active).not.toBe(before.active)
  await openContextEditor(page)
  await expect(page.getByLabel('Название проекта')).toHaveValue('Исходное приключение (копия)')
  await expect(page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true })).toHaveText('Последний контекст перед экспортом')
  await page.getByLabel('Название проекта').fill('Моя копия')
  await page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true }).fill('Изменения только копии')
  await saveContext(page)
  await page.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
  await page.reload()
  await expect(control(page, 'Заменить изображение')).toBeEnabled()
  await clickMenuAction(page, 'Проекты')
  await page.getByRole('button', { name: 'Открыть проект «Исходное приключение»' }).click()
  await openContextEditor(page)
  await expect(page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true })).toHaveText('Последний контекст перед экспортом')
  await page.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
  await expect(page.locator('canvas')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('rejects broken/unknown archives and rolls back a late storage error', async ({ page }, info) => {
  await seed(page)
  const downloading = page.waitForEvent('download')
  await clickMenuAction(page, 'Экспорт проекта')
  const download = await downloading
  const path = info.outputPath('valid.zip'); await download.saveAs(path)
  const bytes = await readFile(path)
  const original = await counts(page)
  await page.getByLabel('Архив проекта').setInputFiles({ name: 'corrupt.zip', mimeType: 'application/zip', buffer: bytes.subarray(0, 50) })
  await expect(page.getByRole('alert')).toContainText('Ошибка импорта')
  expect(await counts(page)).toEqual(original)
  const files = unzipSync(new Uint8Array(bytes))
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ ...manifest, formatVersion: 99 }))
  await page.getByLabel('Архив проекта').setInputFiles({ name: 'future.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) })
  await expect(page.getByRole('alert')).toContainText('Неизвестная версия')
  expect(await counts(page)).toEqual(original)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    Object.defineProperty(window, '__backupTestPut', { value: put, configurable: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'settings') throw new DOMException('Тестовая ошибка записи', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.getByLabel('Архив проекта').setInputFiles(path)
  await expect(page.getByRole('alert')).toContainText('Тестовая ошибка записи')
  expect(await counts(page)).toEqual(original)
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __backupTestPut: typeof IDBObjectStore.prototype.put }).__backupTestPut })
  await page.reload()
  await expect(control(page, 'Заменить изображение')).toBeEnabled()
  expect(await counts(page)).toEqual(original)
  await page.getByLabel('Архив проекта').setInputFiles(path)
  await expect(page.getByText('Копия проекта импортирована и сохранена на устройстве.')).toBeVisible()
  expect((await counts(page)).projects).toBe(2)
})
