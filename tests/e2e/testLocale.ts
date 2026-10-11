import { test as base, type BrowserContext } from '@playwright/test'

export async function configureRussianLocale(context: BrowserContext) {
  await context.addInitScript(() => {
    if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('bounty-mapper:interface-language', 'ru')
  })
}

// These regression fixtures deliberately exercise the Russian interface.
export const test = base.extend({
  context: async ({ context }, runFixture) => {
    await configureRussianLocale(context)
    await runFixture(context)
  },
})
