import { test, expect, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { setLanguage, t, type Language, type MessageKey } from '../../src/i18n'
import type Konva from 'konva'
import type { Project } from '../../src/domain/project'
import type { Region } from '../../src/domain/region'
import type { MarkerPlacement } from '../../src/domain/marker'

const button = (page: Page, key: MessageKey) => page.getByRole('button', { name: t(key), exact: true })
const card = (page: Page) => page.getByRole('region', { name: t('ui.marker.card'), exact: true })
async function menuAction(page: Page, key: MessageKey) {
  const menu = page.getByRole('menu', { name: t('ui.project.menu'), exact: true })
  if (!await menu.isVisible()) await button(page, 'ui.project.menu').click()
  await expect(menu).toBeVisible()
  await page.getByRole('menuitem', { name: t(key), exact: true }).click()
}
async function rows(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('bounty-mapper'); r.onsuccess = () => resolve(r.result) })
    const stores = ['projects', 'maps', 'assets', 'imagePlacements', 'regions', 'entities', 'markerPlacements']
    const tx = db.transaction(stores)
    const all = (name: string) => new Promise<Record<string, unknown>[]>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result) })
    const data = Object.fromEntries(await Promise.all(stores.map(async (name) => [name, await all(name)])))
    db.close(); return data as Record<string, Record<string, unknown>[]>
  })
}
async function createProject(page: Page, name: string) {
  await menuAction(page, 'ui.projects'); await page.getByLabel(t('ui.new.project.name')).fill(name); await button(page, 'ui.create').click()
  await page.getByRole('textbox', { name: t('ui.general.adventure.context'), exact: true }).fill(`Context: ${name}`)
  const info = page.getByRole('region', { name: t('ui.adventure.context'), exact: true })
  await info.getByRole('button', { name: t('ui.save'), exact: true }).click(); await expect(info.getByRole('status')).toHaveText(t('ui.saved.on.this.device'))
  await info.getByRole('button', { name: t('ui.close.value', { p0: t('ui.adventure.context').toLowerCase() }), exact: true }).click()
}
async function createMap(page: Page, name: string) {
  await button(page, 'ui.project.maps').click(); await page.getByRole('menuitem', { name: t('ui.new.map'), exact: true }).click()
  await page.getByLabel(t('ui.new.map.name'), { exact: true }).fill(name)
  await page.getByRole('dialog').getByRole('button', { name: t('ui.create.map'), exact: true }).click()
  await expect(page.locator('[data-map-canvas]')).toBeVisible()
}
async function png(page: Page) {
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width=500; c.height=400; c.getContext('2d')!.fillRect(0,0,500,400); return c.toDataURL().split(',')[1] })
  return { name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}
async function point(page: Page, x: number, y: number, options = {}) { const box = (await page.locator('[data-map-canvas]').boundingBox())!; await page.mouse.click(box.x+x, box.y+y, options) }
async function camera(page: Page) { return page.evaluate(() => { const s=(window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; return { x:s.x(), y:s.y(), scale:s.scaleX() } }) }
async function markerScreen(page: Page, id: string) { return page.evaluate((id) => { const s=(window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages[0]; const m=s.find('.map-marker').find((n) => n.getAttr('markerId')===id)!; return { x:m.x()*s.scaleX()+s.x(), y:m.y()*s.scaleY()+s.y() } }, id) }
async function drag(page: Page, p: {x:number;y:number}, dx: number, dy: number) { const b=(await page.locator('[data-map-canvas]').boundingBox())!; await page.mouse.move(b.x+p.x,b.y+p.y); await page.mouse.down(); await page.mouse.move(b.x+p.x+dx,b.y+p.y+dy,{steps:8}); await page.mouse.up() }

for (const language of ['en', 'ru'] as Language[]) test(`${language}: duplicate draft, alignment and single/batch level import preserve data, assets and cameras`, async ({ page }) => {
  test.setTimeout(90000)
  setLanguage(language, { setItem: () => {} })
  await page.addInitScript((lang) => localStorage.setItem('bounty-mapper:interface-language', lang), language)
  await page.goto('/'); await createProject(page, 'Source'); await createMap(page, 'Level 8')
  const chooser=page.waitForEvent('filechooser'); await button(page,'empty.addImageAction').click(); await(await chooser).setFiles(await png(page))
  await expect(page.getByRole('region',{name:t('empty.addImageTitle'),exact:true})).toHaveCount(0)
  await button(page,'ui.add.region').click(); await point(page,150,150); await point(page,450,150); await point(page,450,420)
  await page.locator('[data-map-canvas]').focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('group',{name:t('ui.creating.region')})).toHaveCount(0)
  await button(page,'ui.add.marker').click(); await page.getByRole('button',{name:t('ui.enemy'),exact:true}).click(); await point(page,300,200)
  await page.getByLabel(t('ui.marker.name'),{exact:true}).fill('Guard')
  await page.getByRole('textbox',{name:t('ui.marker.description'),exact:true}).fill('Original marker text')
  await card(page).getByRole('button',{name:t('ui.more'),exact:true}).click()
  const embedded=page.waitForEvent('filechooser'); await card(page).getByRole('button',{name:t('ui.insert.image'),exact:true}).click(); await(await embedded).setFiles(await png(page))
  await expect(card(page).locator('.text-image img')).toBeVisible()
  await card(page).getByRole('button',{name:t('ui.save'),exact:true}).click(); await expect(card(page).getByRole('status')).toHaveText(t('ui.saved.on.this.device'))
  const original = await rows(page); const sourceMarker=original.markerPlacements[0] as unknown as MarkerPlacement
  const beforeZoom=await camera(page)
  await button(page,'ui.zoom.in').click(); await expect.poll(async () => (await camera(page)).scale).toBe(beforeZoom.scale*1.25)
  let initialCamera=await camera(page)
  await button(page,'marker.duplicate').click(); await expect(page.getByLabel(t('ui.marker.name'),{exact:true})).toHaveValue('Guard Copy')
  expect((await rows(page)).markerPlacements).toHaveLength(1)
  // The draft is the last marker node; move it before any write.
  const draftPoint = await page.evaluate(() => { const s=(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0]; const m=s.find('.map-marker').at(-1)!; return {id:m.getAttr('markerId') as string,x:m.x()*s.scaleX()+s.x(),y:m.y()*s.scaleY()+s.y()} })
  expect(draftPoint.id).not.toBe(sourceMarker.id)
  await drag(page,draftPoint,24,30); await card(page).getByRole('button',{name:t('ui.cancel'),exact:true}).click()
  expect((await rows(page)).markerPlacements).toHaveLength(1); expect(await camera(page)).toEqual(initialCamera)
  const sourcePoint=await markerScreen(page,sourceMarker.id)
  await point(page,sourcePoint.x,sourcePoint.y); await button(page,'ui.edit').click()
  await page.getByRole('textbox',{name:t('ui.marker.description'),exact:true}).fill('Unsaved source edit')
  await point(page,sourcePoint.x,sourcePoint.y,{button:'right'}); await page.getByRole('menuitem',{name:t('marker.duplicate'),exact:true}).click()
  const decision=page.getByRole('dialog',{name:t('ui.unsaved.marker.changes'),exact:true})
  await decision.getByRole('button',{name:t('ui.continue.editing'),exact:true}).click()
  await expect(page.getByRole('textbox',{name:t('ui.marker.description'),exact:true})).toContainText('Unsaved source edit')
  await point(page,sourcePoint.x,sourcePoint.y,{button:'right'}); await page.getByRole('menuitem',{name:t('marker.duplicate'),exact:true}).click()
  await decision.getByRole('button',{name:t('ui.discard.changes'),exact:true}).click()
  await expect(page.getByRole('textbox',{name:t('ui.marker.description'),exact:true})).toContainText('Original marker text')
  await page.getByLabel(t('ui.marker.name'),{exact:true}).fill('Guard Copy')
  await card(page).getByRole('button',{name:t('ui.save'),exact:true}).click(); await expect(card(page).getByRole('status')).toHaveText(t('ui.saved.on.this.device'))
  const duplicated=await rows(page); expect(duplicated.entities).toHaveLength(2); expect(duplicated.markerPlacements).toHaveLength(2)
  expect(new Set(duplicated.entities.map(e=>e.id)).size).toBe(2); expect(await camera(page)).toEqual(initialCamera)
  await page.setViewportSize({width:375,height:800})
  await button(page,'marker.duplicate').click()
  const narrowDraft = await page.evaluate(() => { const s=(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0]; const m=s.find('.map-marker').at(-1)!; return {x:m.x()*s.scaleX()+s.x(),y:m.y()*s.scaleY()+s.y()} })
  expect(narrowDraft.x).toBeGreaterThan(104); expect(narrowDraft.x).toBeLessThan(355); expect(narrowDraft.y).toBeLessThan(72)
  await page.screenshot({path:test.info().outputPath(`narrow-copy-${language}.png`)})
  await card(page).getByRole('button',{name:t('ui.cancel'),exact:true}).click(); await page.setViewportSize({width:1280,height:800})
  await point(page,(await markerScreen(page,sourceMarker.id)).x,(await markerScreen(page,sourceMarker.id)).y)
  await button(page,'ui.close.marker.card').click()
  await button(page,'ui.project.maps').click(); await page.getByRole('menuitem',{name:t('alignment.action'),exact:true}).click()
  const align=page.getByRole('region',{name:t('alignment.title'),exact:true}); await expect(align).toBeVisible()
  const beforeAlign=await rows(page)
  await drag(page,await markerScreen(page,sourceMarker.id),65,35)
  expect(await camera(page)).toEqual(initialCamera)
  expect((await rows(page)).imagePlacements).toEqual(beforeAlign.imagePlacements)
  await align.getByRole('button',{name:t('ui.cancel'),exact:true}).click()
  await button(page,'ui.project.maps').click(); await page.getByRole('menuitem',{name:t('alignment.action'),exact:true}).click()
  await drag(page,await markerScreen(page,sourceMarker.id),65,35)
  await button(page,'ui.play').click(); await page.getByRole('dialog').getByRole('button',{name:t('ui.continue.editing'),exact:true}).click(); await expect(align).toBeVisible()
  await align.getByRole('button',{name:t('alignment.pan'),exact:true}).click()
  await drag(page,{x:600,y:180},40,20); await expect.poll(async () => (await camera(page)).x).not.toBe(initialCamera.x)
  initialCamera=await camera(page)
  await align.getByRole('button',{name:t('alignment.move'),exact:true}).click()
  await page.evaluate(() => {
    const w=window as unknown as {Konva:{stages:Konva.Stage[]};alignmentFrames:{x:number;y:number;scale:number}[];captureAlignment:boolean}
    w.alignmentFrames=[]; w.captureAlignment=true
    const tick=()=>{if(!w.captureAlignment)return; const s=w.Konva.stages[0]; w.alignmentFrames.push({x:s.x(),y:s.y(),scale:s.scaleX()});requestAnimationFrame(tick)}
    requestAnimationFrame(tick)
  })
  await page.evaluate(() => {
    const put=IDBObjectStore.prototype.put
    ;(window as unknown as {restoreAlignment:()=>void}).restoreAlignment=()=>{IDBObjectStore.prototype.put=put}
    IDBObjectStore.prototype.put=function(...args){if(this.name==='projects') throw new DOMException('Test quota','QuotaExceededError');return put.apply(this,args)}
  })
  await align.getByRole('button',{name:t('ui.save'),exact:true}).click(); await expect(align.getByRole('alert')).toBeVisible()
  expect((await rows(page)).imagePlacements).toEqual(beforeAlign.imagePlacements); expect(await camera(page)).toEqual(initialCamera)
  await page.evaluate(() => (window as unknown as {restoreAlignment:()=>void}).restoreAlignment())
  await align.getByRole('button',{name:t('ui.save'),exact:true}).click(); await expect(align).toHaveCount(0)
  const frames=await page.evaluate(() => {const w=window as unknown as {captureAlignment:boolean;alignmentFrames:{x:number;y:number;scale:number}[]};w.captureAlignment=false;return w.alignmentFrames})
  expect(frames.length).toBeGreaterThan(0); for(const frame of frames) expect(frame).toEqual(initialCamera)
  const shifted=await rows(page); expect(shifted.imagePlacements[0].x).not.toBe(beforeAlign.imagePlacements[0].x)
  expect(shifted.regions as unknown as Region[]).toEqual(beforeAlign.regions); expect(shifted.markerPlacements).toEqual(beforeAlign.markerPlacements); expect(await camera(page)).toEqual(initialCamera)
  await createMap(page,'Other level')
  // A source entity/background/document image is shared by two levels. The UI
  // intentionally has no cross-map placement creation command yet.
  await page.evaluate(async () => {
    const db=await new Promise<IDBDatabase>((resolve)=>{const r=indexedDB.open('bounty-mapper');r.onsuccess=()=>resolve(r.result)})
    const tx=db.transaction(['maps','entities','markerPlacements','imagePlacements'],'readwrite')
    const all=<T,>(store:string)=>new Promise<T[]>((resolve)=>{const r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result)})
    const [maps,markers,entities,images]=await Promise.all([all<{id:string;name:string;description:unknown}>('maps'),all<MarkerPlacement>('markerPlacements'),all<{id:string;description:unknown}>('entities'),all<{id:string;mapId:string}>('imagePlacements')])
    const other=maps.find(map=>map.name==='Other level')!, marker=markers[0]
    tx.objectStore('markerPlacements').add({...marker,id:crypto.randomUUID(),mapId:other.id,regionIds:[]})
    tx.objectStore('imagePlacements').add({...images[0],id:crypto.randomUUID(),mapId:other.id})
    tx.objectStore('maps').put({...other,description:entities.find(entity=>entity.id===marker.entityId)!.description})
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)})
    db.close()
  })
  await page.reload(); await expect(page.locator('[data-map-canvas]')).toBeVisible()
  const download=page.waitForEvent('download'); await menuAction(page,'ui.export.project'); const zip=await download
  const zipPath=test.info().outputPath('levels.zip'); await zip.saveAs(zipPath)
  await createProject(page,'Target'); await createMap(page,'Level 8')
  const targetBefore=await rows(page); const targetProject=(targetBefore.projects as unknown as Project[]).find(p=>p.name==='Target')!
  let targetCamera=await camera(page)
  const file=page.waitForEvent('filechooser'); await menuAction(page,'level.import'); await(await file).setFiles(zipPath)
  const dialog=page.getByRole('dialog',{name:t('level.import'),exact:true})
  await expect(dialog.getByRole('group',{name:t('level.select'),exact:true})).toBeVisible()
  await expect(dialog.getByRole('checkbox',{name:'Level 8',exact:true})).toBeChecked()
  await dialog.getByRole('button',{name:t('ui.cancel'),exact:true}).click(); expect(await camera(page)).toEqual(targetCamera)
  expect(await rows(page)).toEqual(targetBefore)
  const second=page.waitForEvent('filechooser'); await menuAction(page,'level.import'); await(await second).setFiles(zipPath)
  await dialog.getByRole('button',{name:t('level.clear'),exact:true}).click()
  await expect(dialog.getByRole('button',{name:t('level.confirm',{count:0}),exact:true})).toBeDisabled()
  await dialog.getByRole('checkbox',{name:'Level 8',exact:true}).check()
  await expect(dialog.getByRole('note')).toContainText(t('level.excludedLinks',{count:1}))
  await expect(dialog.getByText(t('level.finalName',{name:'Level 8 Copy'}),{exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:t('level.confirm',{count:1}),exact:true}).click(); await expect(dialog).toHaveCount(0)
  await expect(page.locator('.map-menu-trigger')).toContainText('Level 8 Copy')
  const imported=await rows(page); const targetMaps=imported.maps.filter(m=>m.projectId===targetProject.id)
  expect(targetMaps.map(m=>m.name).sort()).toEqual(['Level 8','Level 8 Copy'])
  expect((imported.projects as unknown as Project[]).find(p=>p.id===targetProject.id)!.context).toEqual(targetProject.context)
  const importedMap=targetMaps.find(m=>m.name==='Level 8 Copy')!
  expect(imported.markerPlacements.filter(m=>m.mapId===importedMap.id)).toHaveLength(2)
  expect(imported.imagePlacements.find(p=>p.mapId===importedMap.id)).toMatchObject({x:shifted.imagePlacements[0].x,y:shifted.imagePlacements[0].y})
  await page.screenshot({path:test.info().outputPath(`imported-${language}.png`)})
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang',language)
  expect((await rows(page)).imagePlacements).toEqual(imported.imagePlacements)
  await button(page,'ui.project.maps').click(); await page.getByRole('menuitem',{name:t('ui.go.to.map.value',{p0:'Level 8'}),exact:true}).click()
  await expect(page.locator('.map-menu-trigger')).toHaveText('Level 8')
  await expect(page.locator('[data-map-canvas]')).toHaveAttribute('data-map-id',String(targetMaps.find(map=>map.name==='Level 8')!.id))
  await expect(page.locator('[data-map-canvas] canvas').first()).toBeVisible()
  const beforeTargetZoom=await camera(page); await button(page,'ui.zoom.in').click()
  await expect.poll(async()=>(await camera(page)).scale).toBe(beforeTargetZoom.scale*1.25)
  targetCamera=await camera(page)
  // Resolve a live card before choosing the same archive for a batch.
  await button(page,'ui.project.maps').click(); await page.getByRole('menuitem',{name:t('ui.go.to.map.value',{p0:'Level 8 Copy'}),exact:true}).click()
  const importedMarker=imported.markerPlacements.find(marker=>marker.mapId===importedMap.id)!
  await expect.poll(()=>page.evaluate((id)=>(window as unknown as {Konva?:{stages:Konva.Stage[]}}).Konva?.stages[0]?.find('.map-marker').some(marker=>marker.getAttr('markerId')===id)??false,String(importedMarker.id))).toBe(true)
  const importedPoint=await markerScreen(page,String(importedMarker.id)); await point(page,importedPoint.x,importedPoint.y)
  await button(page,'ui.edit').click(); await page.getByLabel(t('ui.marker.name'),{exact:true}).fill('Unsaved import draft')
  await menuAction(page,'level.import'); await decision.getByRole('button',{name:t('ui.continue.editing'),exact:true}).click()
  await expect(page.getByLabel(t('ui.marker.name'),{exact:true})).toHaveValue('Unsaved import draft')
  await menuAction(page,'level.import')
  const batchFile=page.waitForEvent('filechooser'); await decision.getByRole('button',{name:t('ui.discard.changes'),exact:true}).click(); await(await batchFile).setFiles(zipPath)
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  for(const checkbox of await dialog.getByRole('checkbox').all())await expect(checkbox).toBeChecked()
  await expect(dialog.getByRole('note')).toHaveCount(0)
  await dialog.getByRole('button',{name:t('level.clear'),exact:true}).click()
  await expect(dialog.getByRole('button',{name:t('level.confirm',{count:0}),exact:true})).toBeDisabled()
  await dialog.getByRole('button',{name:t('level.selectAll'),exact:true}).click()
  await expect(dialog.getByText(t('level.selected',{count:2}),{exact:true})).toBeVisible()
  await expect(dialog.getByText(t('level.finalName',{name:'Level 8 Copy 2'}),{exact:true})).toBeVisible()
  await page.setViewportSize({width:375,height:800})
  expect(await dialog.evaluate((element)=>{const box=element.getBoundingClientRect();return [...element.querySelectorAll('button')].every(button=>{const bounds=button.getBoundingClientRect();return bounds.left>=box.left&&bounds.right<=box.right})})).toBe(true)
  await page.screenshot({path:test.info().outputPath(`batch-import-${language}.png`)}); await page.setViewportSize({width:1280,height:800})
  const beforeBatch=await rows(page), beforeBatchCamera=await camera(page)
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;(window as unknown as {restoreImport:()=>void}).restoreImport=()=>{IDBObjectStore.prototype.put=put};IDBObjectStore.prototype.put=function(...args){if(this.name==='projects')throw new DOMException('Test quota','QuotaExceededError');return put.apply(this,args)}})
  await dialog.getByRole('button',{name:t('level.confirm',{count:2}),exact:true}).click(); await expect(dialog.getByRole('alert')).toBeVisible()
  expect(await rows(page)).toEqual(beforeBatch); expect(await camera(page)).toEqual(beforeBatchCamera)
  await expect(page.getByText(t('level.success',{count:2}),{exact:true})).toHaveCount(0)
  await page.evaluate(()=>(window as unknown as {restoreImport:()=>void}).restoreImport())
  await dialog.getByRole('button',{name:t('level.confirm',{count:2}),exact:true}).click(); await expect(dialog).toHaveCount(0)
  await expect(page.getByText(t('level.success',{count:2}),{exact:true})).toBeVisible()
  await expect(page.locator('.map-menu-trigger')).toContainText('Level 8 Copy 2')
  const batch=await rows(page),batchMaps=batch.maps.filter(map=>map.projectId===targetProject.id).sort((a,b)=>Number(a.order)-Number(b.order)).slice(-2)
  expect(batchMaps.map(map=>map.name)).toEqual(['Level 8 Copy 2','Other level'])
  const placements=batch.markerPlacements.filter(marker=>batchMaps.some(map=>map.id===marker.mapId))
  expect(placements).toHaveLength(3); expect(new Set(placements.map(marker=>marker.entityId)).size).toBe(2)
  expect(batch.entities.filter(entity=>placements.some(marker=>marker.entityId===entity.id))).toHaveLength(2)
  const backgrounds=batch.imagePlacements.filter(image=>batchMaps.some(map=>map.id===image.mapId))
  expect(backgrounds).toHaveLength(2); expect(new Set(backgrounds.map(image=>image.assetId)).size).toBe(1)
  expect(await page.evaluate(()=>(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0].find('.map-marker').length)).toBe(2)
  await button(page,'ui.project.maps').click(); await page.getByRole('menuitem',{name:t('ui.go.to.map.value',{p0:'Level 8'}),exact:true}).click()
  await expect(page.locator('.map-menu-trigger')).toHaveText('Level 8')
  await expect(page.locator('[data-map-canvas]')).toHaveAttribute('data-map-id',String(targetMaps.find(map=>map.name==='Level 8')!.id))
  await expect(page.locator('[data-map-canvas] canvas').first()).toBeVisible()
  await expect.poll(()=>camera(page)).toEqual(targetCamera)
  const repeat=page.waitForEvent('filechooser'); await menuAction(page,'level.import'); await(await repeat).setFiles(zipPath)
  await expect(dialog.getByText(t('level.finalName',{name:'Level 8 Copy 3'}),{exact:true})).toBeVisible()
  await expect(dialog.getByText(t('level.finalName',{name:'Other level Copy'}),{exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:t('level.confirm',{count:2}),exact:true}).click(); await expect(dialog).toHaveCount(0)
  const repeated=await rows(page); expect(repeated.maps.filter(map=>map.projectId===targetProject.id)).toHaveLength(6)
  const exported=page.waitForEvent('download'); await menuAction(page,'ui.export.project'); const batchPath=test.info().outputPath('batch-result.zip'); await(await exported).saveAs(batchPath)
  await page.getByLabel(t('ui.project.archive'),{exact:true}).setInputFiles(batchPath)
  await expect(page.getByText(t('ui.the.project.copy.was.imported.and.saved.on.this'),{exact:true})).toBeVisible()
  const restored=await rows(page); expect(restored.maps).toHaveLength(repeated.maps.length+6)
  await page.reload(); expect(await rows(page)).toEqual(restored)
})
