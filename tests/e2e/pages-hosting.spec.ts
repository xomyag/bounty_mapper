import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { test } from './testLocale'
import { clickMenuAction, control } from './controls'

async function checkFavicons(page: Page, root: string) {
  const icons = await page.locator('link[rel="icon"]').evaluateAll((links) => links.map((link) => ({
    href: (link as HTMLLinkElement).href, type: (link as HTMLLinkElement).type,
  })))
  expect(icons).toEqual([
    { href: `${root}favicon.png`, type: 'image/png' },
    { href: `${root}favicon.svg`, type: 'image/svg+xml' },
  ])
  for (const icon of icons) {
    const loaded = await page.evaluate(async ({ href }) => {
      const response = await fetch(href)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        return { status: response.status, type: blob.type, width: image.naturalWidth, height: image.naturalHeight }
      } finally { URL.revokeObjectURL(url) }
    }, icon)
    expect(loaded).toEqual({ status: 200, type: icon.type, width: 32, height: 32 })
  }
}

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
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' } as Record<string, string>)[extname(name)] ?? 'application/octet-stream')
    response.end(file)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const origin = `http://127.0.0.1:${address.port}`
  const errors: string[] = []
  const paths: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  page.on('request', (request) => { if (request.url().startsWith(origin)) paths.push(new URL(request.url()).pathname) })
  try {
    await page.goto(`${origin}${base}`)
    await checkFavicons(page, `${origin}${base}`)
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
    await checkFavicons(page, `${origin}${base}`)
    await control(page, 'Контекст приключения').click()
    await expect(card).toContainText('Локальные данные под путём репозитория')
    await card.getByRole('button', { name: 'Редактировать', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Общий контекст приключения', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Меню проекта', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('button', { name: 'Project menu', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'General adventure context', exact: true })).toContainText('Локальные данные под путём репозитория')
    expect(paths.length).toBeGreaterThan(2)
    expect(paths.every((path) => path.startsWith(base))).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.setOffline(false)
    await page.goto('about:blank')
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
