import { defineConfig } from '@playwright/test'

const preview = process.env.PLAYWRIGHT_PREVIEW === '1'
const baseURL = preview ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: preview ? 'npm run preview' : 'npm run dev', url: baseURL, reuseExistingServer: !process.env.CI,
  },
})
