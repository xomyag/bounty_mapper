import type { Page } from '@playwright/test'

const projectActions = ['Проекты', 'Импорт проекта', 'Экспорт проекта', 'Проверить обновления', 'Повторить подготовку офлайн', 'Применить обновление']
const imageActions = ['Загрузить карту', 'Заменить изображение', 'Удалить изображение']
export function control(page: Page, name: string) {
  const inMenu = projectActions.includes(name) || imageActions.includes(name)
  return page.getByRole(inMenu ? 'menuitem' : 'button', { name, exact: true, includeHidden: inMenu })
}
export async function clickMenuAction(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: projectActions.includes(name) ? 'Меню проекта' : 'Карты проекта', exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
