import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { test, expect } from '@playwright/test'
import { clickMenuAction, control } from './controls'

test('Pages subpath serves resources, scopes the worker and reloads local documents offline', async ({ page, context }) => {
  test.skip(!process.env.BM_PAGES_TEST_BASE, 'Build with BM_BASE_PATH and set BM_PAGES_TEST_BASE to test Pages hosting.')
  const base = process.env.BM_PAGES_TEST_BASE!
  const files = new Map<string, Uint8Array>()
  for (const entry of await readdir('dist', { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name)
      files.set(`${base}${relative('dist', path).replaceAll('\\', '/')}`, await readFile(path))
    }
  }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname
    const name = pathname === base ? `${base}index.html` : pathname
    const file = files.get(name)
    if (!file) { response.writeHead(404); response.end(); return }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' } as Record<string, string>)[extname(name)] ?? 'application/octet-stream')
    response.end(file)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Нет адреса тестового сервера')
  const origin = `http://127.0.0.1:${address.port}`
  const errors: string[] = []
  const paths: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  page.on('request', (request) => { if (request.url().startsWith(origin)) paths.push(new URL(request.url()).pathname) })
  try {
    await page.goto(`${origin}${base}`)
    await control(page, 'Меню проекта').click()
    await expect(page.getByText('Готово к работе без сети', { exact: true })).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(`${origin}${base}`)
    await page.reload()
    await clickMenuAction(page, 'Проекты')
    await page.getByLabel('Название нового проекта').fill('Проверка Pages')
    await control(page, 'Создать').click()
    const card = page.getByRole('region', { name: 'Контекст приключения', exact: true })
    await page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true }).fill('Локальные данные под путём репозитория')
    await card.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(card.getByRole('status')).toHaveText('Сохранено на устройстве')
    await context.setOffline(true)
    await page.reload()
    await control(page, 'Контекст приключения').click()
    await expect(card).toContainText('Локальные данные под путём репозитория')
    await card.getByRole('button', { name: 'Редактировать', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true })).toBeVisible()
    expect(paths.length).toBeGreaterThan(2)
    expect(paths.every((path) => path.startsWith(base))).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.setOffline(false)
    await page.goto('about:blank')
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
