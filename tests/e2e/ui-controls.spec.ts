import { finishProjectCreation } from './controls'
import { expect } from '@playwright/test'
import { test } from './testLocale'
import type { Page } from '@playwright/test'
import type Konva from 'konva'
import { clickMenuAction, control } from './controls'
import { emptyRegionContent } from '../../src/domain/region'
import type { Region } from '../../src/domain/region'
import type { MarkerPlacement } from '../../src/domain/marker'
import { worldToScreen } from '../../src/domain/viewport'
import type { Camera, Point } from '../../src/domain/viewport'

const card = (page: Page) => page.getByRole('region', { name: 'Карточка области', exact: true })
const canvas = (page: Page) => page.getByRole('region', { name: 'Карта приключения', exact: true })
async function paint(page: Page) { await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function camera(page: Page): Promise<Camera> { return page.evaluate(() => { const s = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return { x: s.x(), y: s.y(), scale: s.scaleX() } }) }
async function screen(page: Page, point: Point) { const box = (await canvas(page).boundingBox())!; const p = worldToScreen(point, await camera(page)); return { x: box.x + p.x, y: box.y + p.y } }
async function clickWorld(page: Page, point: Point) { await paint(page); const p = await screen(page, point); await page.mouse.click(p.x, p.y) }
async function drag(page: Page, point: Point, offset: Point) { await paint(page); const p = await screen(page, point); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + offset.x, p.y + offset.y, { steps: 10 }); await page.mouse.up(); await paint(page) }
async function stored(page: Page) { return page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
  const tx = db.transaction(['regions', 'markerPlacements'])
  const get = <T,>(store: string) => new Promise<T[]>((resolve) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result) })
  const [regions, markers] = await Promise.all([get<Region>('regions'), get<MarkerPlacement>('markerPlacements')]); db.close(); return { regions, markers }
}) }
async function seed(page: Page) {
  await page.goto('/'); await clickMenuAction(page, 'Проекты')
  await page.getByLabel('Название нового проекта').fill('Проверка управления'); await control(page, 'Создать').click()
  await finishProjectCreation(page)
  await control(page, 'Карты проекта').click(); await page.getByRole('menuitem', { name: 'Новая карта', exact: true }).click()
  await page.getByLabel('Название новой карты').fill('Этаж 1'); await page.getByRole('dialog', { name: 'Новая карта' }).getByRole('button', { name: 'Создать карту', exact: true }).click(); await expect(control(page, 'Добавить область')).toBeEnabled()
  await page.evaluate(async (content) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['maps', 'regions', 'entities', 'markerPlacements'], 'readwrite')
    const request = tx.objectStore('maps').getAll(); request.onsuccess = () => {
      const map = request.result[0]
      tx.objectStore('maps').add({ ...map, id: 'other-map', name: 'Этаж 2', order: 1 })
      for (const [index, id] of ['a', 'b'].entries()) { const x = 100 + index * 300; tx.objectStore('regions').add({ ...content, id, mapId: map.id, number: index + 1, title: `Зал ${id}`, titleCustomized: true, color: '#d7ad62', fillOpacity: .4, order: index, vertices: [{ x, y: 150 }, { x: x + 150, y: 150 }, { x: x + 150, y: 300 }, { x, y: 300 }] }) }
      tx.objectStore('entities').add({ checks: [], id: 'npc', projectId: map.projectId, name: 'Страж', kind: 'enemy', status: 'alive', description: content.gmNotes, tags: [] })
      tx.objectStore('markerPlacements').add({ id: 'npc-placement', entityId: 'npc', mapId: map.id, x: 600, y: 400, color: '#d7ad62', locked: false, order: 0, regionIds: ['a'] })
      tx.objectStore('markerPlacements').add({ id: 'npc-locked', entityId: 'npc', mapId: map.id, x: 650, y: 400, color: '#d7ad62', locked: true, order: 1, regionIds: ['a','b'] })
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) }); db.close()
  }, emptyRegionContent())
  await page.reload(); await expect(control(page, 'Добавить область')).toBeEnabled(); await expect(canvas(page)).toBeVisible(); await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages.length ?? 0)).toBe(1); await paint(page)
}

test('regions move with cards closed; mixed selection translates once, excludes locks and undoes as one operation', async ({ page }) => {
  await seed(page)
  const original = await stored(page)
  const view = await camera(page)
  await drag(page, { x: 175, y: 225 }, { x: 40, y: 20 })
  await expect.poll(async ()=>(await stored(page)).regions[0].vertices[0].x).toBeCloseTo(100+40/view.scale)
  expect(await camera(page)).toEqual(view); await expect(card(page)).toHaveCount(0)
  expect((await stored(page)).markers).toEqual(original.markers)
  await control(page,'Отменить').click(); await expect.poll(()=>stored(page)).toEqual(original)
  await control(page,'Повторить').click(); await expect.poll(async ()=>(await stored(page)).regions[0].vertices[0].x).toBeCloseTo(100+40/view.scale)
  await control(page,'Отменить').click(); await expect.poll(()=>stored(page)).toEqual(original)
  await control(page,'Снять выделение').click()
  const a=await screen(page,{x:50,y:120}), b=await screen(page,{x:700,y:450})
  await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:10})
  expect(await page.evaluate(()=>(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0].find('.selection-box').length)).toBe(1)
  await page.mouse.up(); await expect(page.getByText('Выделено 3 объекта',{exact:true})).toBeVisible()
  await drag(page,{x:175,y:225},{x:30,y:15})
  await expect.poll(async ()=>(await stored(page)).markers.find(m=>m.id==='npc-placement')!.x).toBeCloseTo(600+30/view.scale)
  const moved=await stored(page)
  for(const region of moved.regions) { const old=original.regions.find(r=>r.id===region.id)!; expect(region.vertices[0].x-old.vertices[0].x).toBeCloseTo(30/view.scale); expect(region.vertices[0].y-old.vertices[0].y).toBeCloseTo(15/view.scale) }
  expect(moved.markers.find(m=>m.id==='npc-locked')).toEqual(original.markers.find(m=>m.id==='npc-locked'))
  expect(await camera(page)).toEqual(view); await expect(card(page)).toHaveCount(0)
  await control(page,'Отменить').click(); await expect.poll(()=>stored(page)).toEqual(original)
  const p=await screen(page,{x:175,y:225}); await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(p.x+60,p.y+30,{steps:8}); await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await stored(page)).toEqual(original); await expect(card(page)).toHaveCount(0)
  await control(page,'Снять выделение').click()
  await page.keyboard.down('Shift'); await clickWorld(page,{x:175,y:225}); await clickWorld(page,{x:600,y:400}); await clickWorld(page,{x:175,y:225}); await clickWorld(page,{x:650,y:400}); await page.keyboard.up('Shift')
  await expect(page.getByText('Выделен 1 объект',{exact:true})).toBeVisible(); await expect(card(page)).toHaveCount(0)
  await canvas(page).focus(); await page.keyboard.press('Escape'); await expect(control(page,'Снять выделение')).toHaveCount(0)
  await control(page,'Увеличить масштаб').click(); await expect.poll(async ()=>(await camera(page)).scale).toBeCloseTo(view.scale*1.25)
  const zoomed=await camera(page)
  const box = async (from:Point,to:Point,shift=false) => { const a=await screen(page,from),b=await screen(page,to); if(shift)await page.keyboard.down('Shift'); await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up();if(shift)await page.keyboard.up('Shift') }
  await box({x:50,y:120},{x:280,y:330}); await expect(page.getByText('Выделен 1 объект',{exact:true})).toBeVisible()
  await box({x:350,y:120},{x:700,y:450},true); await expect(page.getByText('Выделено 3 объекта',{exact:true})).toBeVisible()
  await page.keyboard.down('Shift'); await drag(page,{x:475,y:225},{x:40,y:-20}); await page.keyboard.up('Shift')
  await expect.poll(async ()=>(await stored(page)).markers.find(m=>m.id==='npc-placement')!.x).toBeCloseTo(600+40/zoomed.scale)
  expect((await stored(page)).regions[1].vertices[0].x-(await stored(page)).regions[0].vertices[0].x).toBeCloseTo(300)
  await control(page,'Отменить').click(); await expect.poll(()=>stored(page)).toEqual(original)
  await box({x:280,y:130},{x:70,y:320}); await expect(page.getByText('Выделен 1 объект',{exact:true})).toBeVisible()
  await clickWorld(page,{x:800,y:600}); await expect(control(page,'Снять выделение')).toHaveCount(0)
  await drag(page,{x:175,y:225},{x:2,y:0}); await expect(card(page)).toBeVisible(); expect(await stored(page)).toEqual(original)
  await page.keyboard.down('Shift'); await clickWorld(page,{x:175,y:225}); await drag(page,{x:475,y:225},{x:20,y:10}); await page.keyboard.up('Shift')
  await expect(page.getByText('Выделено 2 объекта',{exact:true})).toBeVisible()
  await expect.poll(async ()=>(await stored(page)).regions[0].vertices[0].x).toBeCloseTo(100+20/zoomed.scale)
  expect((await stored(page)).markers).toEqual(original.markers)
  await control(page,'Отменить').click(); await expect.poll(()=>stored(page)).toEqual(original)
})

test('dirty movement resolves before a new drag; failures rollback, explicit pan and game keep geometry protected', async ({ page }) => {
  await seed(page); const original=await stored(page)
  await clickWorld(page,{x:175,y:225}); await control(page,'Редактировать').click()
  await page.getByLabel('Название области',{exact:true}).fill('Сохранённый зал')
  await drag(page,{x:475,y:225},{x:30,y:20})
  const prompt=page.getByRole('dialog',{name:'Несохранённые изменения области'})
  await expect(prompt).toBeVisible(); await control(page,'Продолжить редактирование').click()
  expect(await stored(page)).toEqual(original); await expect(page.getByLabel('Название области',{exact:true})).toHaveValue('Сохранённый зал')
  await drag(page,{x:475,y:225},{x:30,y:20}); await control(page,'Сохранить и продолжить').click(); await expect(prompt).toHaveCount(0)
  const savedText=await stored(page); expect(savedText.regions[0].title).toBe('Сохранённый зал'); expect(savedText.regions[1].vertices).toEqual(original.regions[1].vertices)
  const view=await camera(page)
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; Object.defineProperty(window, 'originalPut', { value: put, configurable: true }); IDBObjectStore.prototype.put = function (...args) { if (this.name === 'projects') throw new DOMException('Нет места', 'QuotaExceededError'); return put.apply(this, args) } })
  await drag(page,{x:475,y:225},{x:30,y:20}); await expect(page.getByRole('alert')).toContainText('Нет места')
  expect(await stored(page)).toEqual(savedText); expect(await camera(page)).toEqual(view)
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { originalPut: typeof IDBObjectStore.prototype.put }).originalPut })
  await control(page,'Повторить запись объектов карты').click(); await expect.poll(async ()=>(await stored(page)).regions[1].vertices[0].x).toBeCloseTo(400+30/view.scale)
  const saved=await stored(page)
  await canvas(page).focus(); await page.keyboard.down('Space'); await drag(page,{x:175,y:225},{x:45,y:25}); await page.keyboard.up('Space')
  expect((await camera(page)).x).toBeCloseTo(view.x+45); expect(await stored(page)).toEqual(saved)
  const beforeMiddle=await camera(page); const p=await screen(page,{x:700,y:500})
  await page.mouse.move(p.x,p.y); await page.mouse.down({button:'middle'}); await page.mouse.move(p.x+30,p.y+10,{steps:8}); await page.mouse.up({button:'middle'})
  expect((await camera(page)).x).toBeCloseTo(beforeMiddle.x+30); expect(await stored(page)).toEqual(saved)
  await control(page,'Игра').click(); await expect(control(page,'Игра')).toHaveAttribute('aria-pressed','true')
  await expect(control(page,'Снять выделение')).toHaveCount(0)
  await drag(page,{x:175,y:225},{x:20,y:10}); expect(await stored(page)).toEqual(saved)
})

test('compact menus work by keyboard, overlays stay accessible beside panels and do not pass clicks to canvas', async ({ page }, info) => {
  await seed(page)
  await control(page, 'Меню проекта').focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Проекты', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Импорт проекта', exact: true })).toBeFocused(); await page.keyboard.press('Escape')
  await expect(control(page, 'Меню проекта')).toBeFocused()
  await control(page, 'Карты проекта').focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: 'Новая карта', exact: true })).toBeFocused(); await page.keyboard.press('Escape')
  const initial = await stored(page); const view = await camera(page)
  await clickWorld(page, { x: 175, y: 225 }); await control(page, 'Навигация и поиск').click(); await paint(page)
  expect(await camera(page)).toEqual(view)
  const checkOverlays = async () => {
    const panels = await page.locator('.region-card, .navigation-panel:not([hidden])').all()
    for (const group of await page.locator('.workspace-controls').all()) {
      const box = (await group.boundingBox())!; const workspace = (await page.getByRole('main').boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(workspace.x); expect(box.x + box.width).toBeLessThanOrEqual(workspace.x + workspace.width)
      for (const panel of panels) { const other = (await panel.boundingBox())!; expect(box.x >= other.x + other.width || box.x + box.width <= other.x || box.y >= other.y + other.height || box.y + box.height <= other.y).toBe(true) }
    }
  }
  await checkOverlays(); await page.screenshot({ path: info.outputPath('desktop.png') })
  await page.setViewportSize({ width: 1050, height: 780 }); await paint(page); await checkOverlays()
  await page.setViewportSize({ width: 375, height: 780 }); await paint(page); await checkOverlays(); await page.screenshot({ path: info.outputPath('narrow.png') })
  await control(page, 'Увеличить масштаб').click(); await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(view.scale * 1.25)
  await control(page, 'Уменьшить масштаб').click(); await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(view.scale)
  expect(await stored(page)).toEqual(initial)
  await control(page, 'Закрыть навигацию').click(); await control(page, 'Закрыть карточку области').click()
  await control(page, 'Добавить область').click(); await control(page, 'Увеличить масштаб').click()
  await expect(page.getByRole('group', { name: 'Создание области' })).toContainText('0 вершин')
  await control(page, 'Отменить контур').click()
  await control(page, 'Добавить маркер').click(); await page.getByRole('group', { name: 'Тип нового маркера' }).getByRole('button', { name: 'NPC', exact: true }).click()
  await control(page, 'Уменьшить масштаб').click(); await expect(page.getByRole('group', { name: 'Размещение маркера' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Карточка маркера' })).toHaveCount(0); expect(await stored(page)).toEqual(initial)
  await control(page, 'Отменить размещение').click()
  await control(page, 'Игра').click(); await expect(control(page, 'Добавить маркер')).toBeDisabled()
  await control(page, 'Карты проекта').click(); await expect(page.getByRole('menuitem', { name: 'Новая карта', exact: true })).toBeDisabled(); await expect(page.getByRole('menuitem', { name: 'Загрузить карту', exact: true })).toBeDisabled()
})
