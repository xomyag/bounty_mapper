import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export async function finishProjectCreation(page: Page) {
  const card = page.getByRole('region', { name: 'Контекст приключения', exact: true })
  await expect(card.getByRole('textbox', { name: 'Общий контекст приключения' })).toBeVisible()
  await card.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(card.getByRole('status')).toHaveText('Сохранено на устройстве')
  await card.getByRole('button', { name: 'Закрыть контекст приключения' }).click()
}

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
