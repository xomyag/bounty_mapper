import { test, expect, type Page } from '@playwright/test'
import type Konva from 'konva'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { emptyRegionContent } from '../../src/domain/region'
import type { Region } from '../../src/domain/region'
import type { MarkerPlacement } from '../../src/domain/marker'
import type { Camera, Point } from '../../src/domain/viewport'
import { worldToScreen } from '../../src/domain/viewport'

const canvas=(page:Page)=>page.locator('[data-map-canvas]')
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true})
async function paint(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
async function camera(page:Page):Promise<Camera>{return page.evaluate(()=>{const s=(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0];return{x:s.x(),y:s.y(),scale:s.scaleX()}})}
async function screen(page:Page,p:Point){const box=(await canvas(page).boundingBox())!;const point=worldToScreen(p,await camera(page));return{x:box.x+point.x,y:box.y+point.y}}
async function drag(page:Page,p:Point,delta:Point){const from=await screen(page,p);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+delta.x,from.y+delta.y,{steps:10});await page.mouse.up();await paint(page)}
async function data(page:Page){const mapId=await canvas(page).getAttribute('data-map-id');return page.evaluate(async(mapId)=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('bounty-mapper');r.onsuccess=()=>resolve(r.result)});const tx=db.transaction(['regions','markerPlacements']);const get=<T,>(name:string)=>new Promise<T[]>(resolve=>{const r=tx.objectStore(name).index('mapId').getAll(mapId!);r.onsuccess=()=>resolve(r.result)});const [regions,markers]=await Promise.all([get<Region>('regions'),get<MarkerPlacement>('markerPlacements')]);db.close();return{regions:regions.sort((a,b)=>a.order-b.order),markers:markers.sort((a,b)=>a.order-b.order)}},mapId)}
async function menu(page:Page,name:string){const panel=page.getByRole('menu',{name:'Project menu',exact:true});if(!await panel.isVisible())await button(page,'Project menu').click();await page.getByRole('menuitem',{name,exact:true}).click()}
async function seed(page:Page){
  await page.goto('/');await menu(page,'Projects');await page.getByLabel('New project name',{exact:true}).fill('Selection regression');await button(page,'Create').click()
  const info=page.getByRole('region',{name:'Adventure context',exact:true});await info.getByRole('button',{name:'Save',exact:true}).click();await expect(info.getByRole('status')).toHaveText('Saved on this device');await button(page,'Close adventure context').click()
  await button(page,'Create map').click();await page.getByLabel('New map name',{exact:true}).fill('Board');await page.getByRole('dialog').getByRole('button',{name:'Create map',exact:true}).click();await expect(canvas(page)).toBeVisible()
  await page.evaluate(async(content)=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('bounty-mapper');r.onsuccess=()=>resolve(r.result)})
    const tx=db.transaction(['maps','regions','entities','markerPlacements'],'readwrite');const r=tx.objectStore('maps').getAll();r.onsuccess=()=>{
      const map=r.result[0]
      for(const [i,id]of ['a','b'].entries()){const x=100+i*300;tx.objectStore('regions').add({...content,id,mapId:map.id,number:i+1,title:`Area ${id}`,titleCustomized:true,color:'#d7ad62',fillOpacity:.4,order:i,vertices:[{x,y:150},{x:x+150,y:150},{x:x+150,y:300},{x,y:300}]})}
      tx.objectStore('entities').add({id:'guard',projectId:map.projectId,kind:'enemy',name:'Guard',status:'alive',description:content.gmNotes,tags:[],checks:[]})
      for(const [i,id]of ['m0','m1','locked'].entries())tx.objectStore('markerPlacements').add({id,entityId:'guard',mapId:map.id,x:600+i*50,y:i===1?300:400,locked:i===2,regionIds:['a','b'],color:'#aabbcc',order:i})
    };await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close()
  },emptyRegionContent());await page.reload();await expect(button(page,'Add region')).toBeEnabled();await paint(page)
}

test('English selection stays temporary; mixed drag failure/retry has no camera flash, text stays independent and ZIP/reload keep geometry',async({page},info)=>{
  await seed(page);const original=await data(page);const view=await camera(page)
  await drag(page,{x:700,y:400},{x:35,y:20});await expect(page.locator('.region-card')).toHaveCount(0);expect(await data(page)).toEqual(original)
  await button(page,'Add marker').click();await button(page,'Enemy').click();const spot=await screen(page,{x:850,y:450});await page.mouse.click(spot.x,spot.y)
  const newMarker=page.getByRole('region',{name:'Marker card',exact:true});await expect(newMarker).toBeVisible()
  const start=await screen(page,{x:50,y:120}),end=await screen(page,{x:800,y:450});await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:10})
  expect(await page.evaluate(()=>(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0].find('.selection-box').length)).toBe(0)
  await page.mouse.up();await expect(button(page,'Clear selection')).toHaveCount(0);await newMarker.getByRole('button',{name:'Cancel',exact:true}).click();expect(await data(page)).toEqual(original)
  const a=await screen(page,{x:50,y:120}),b=await screen(page,{x:800,y:450});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up()
  await expect(page.getByText('4 objects selected',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('mixed-selection-en.png')})
  await page.setViewportSize({width:375,height:800});await paint(page)
  const tools=(await page.getByRole('group',{name:'Object selection',exact:true}).boundingBox())!,host=(await canvas(page).boundingBox())!
  expect(tools.x).toBeGreaterThanOrEqual(110);expect(tools.x+tools.width).toBeLessThanOrEqual(375);expect(tools.y+tools.height).toBeLessThanOrEqual(host.y+72)
  await page.screenshot({path:info.outputPath('mixed-selection-narrow-en.png')});await page.setViewportSize({width:1280,height:800});await paint(page);expect(await camera(page)).toEqual(view)
  await page.evaluate(()=>{
    const w=window as unknown as {Konva:{stages:Konva.Stage[]};captureSelection:boolean;selectionFrames:Camera[];restoreSelection:()=>void}
    w.captureSelection=true;w.selectionFrames=[];const tick=()=>{if(!w.captureSelection)return;const s=w.Konva.stages[0];w.selectionFrames.push({x:s.x(),y:s.y(),scale:s.scaleX()});requestAnimationFrame(tick)};requestAnimationFrame(tick)
    const put=IDBObjectStore.prototype.put;w.restoreSelection=()=>{IDBObjectStore.prototype.put=put};IDBObjectStore.prototype.put=function(...args){if(this.name==='projects')throw new DOMException('Test quota','QuotaExceededError');return put.apply(this,args)}
  })
  await drag(page,{x:175,y:225},{x:30,y:20});await expect(page.getByRole('alert')).toBeVisible();expect(await data(page)).toEqual(original)
  await page.evaluate(()=>(window as unknown as {restoreSelection:()=>void}).restoreSelection())
  await button(page,'Retry saving map objects').click();await expect.poll(async()=>(await data(page)).markers.find(m=>m.id==='m0')!.x).toBeCloseTo(600+30/view.scale)
  const saved=await data(page);expect(saved.markers.find(m=>m.id==='locked')).toEqual(original.markers.find(m=>m.id==='locked'))
  const frames=await page.evaluate(()=>{const w=window as unknown as {captureSelection:boolean;selectionFrames:Camera[]};w.captureSelection=false;return w.selectionFrames})
  expect(frames.length).toBeGreaterThan(0);for(const frame of frames)expect(frame).toEqual(view)
  await button(page,'Undo').click();await expect.poll(()=>data(page)).toEqual(original);await button(page,'Redo').click();await expect.poll(()=>data(page)).toEqual(saved)
  await button(page,'Clear selection').focus();await page.keyboard.press('Space');await expect(button(page,'Clear selection')).toHaveCount(0);expect(await camera(page)).toEqual(view)
  const region=saved.regions[0];const p=await screen(page,{x:region.vertices[0].x+70,y:region.vertices[0].y+70});await page.mouse.click(p.x,p.y)
  const card=page.getByRole('region',{name:'Region card',exact:true});await card.getByRole('button',{name:'Edit',exact:true}).click()
  const input=page.getByLabel('Region name',{exact:true});await input.fill('Typing');await input.press('Space');await expect(input).toHaveValue('Typing ');expect(await camera(page)).toEqual(view);expect(await data(page)).toEqual(saved)
  await input.press('Control+z');expect(await data(page)).toEqual(saved);await card.getByRole('button',{name:'Cancel',exact:true}).click();await button(page,'Close region card').click()
  const download=page.waitForEvent('download');await menu(page,'Export project');const path=info.outputPath('selection.zip');await(await download).saveAs(path)
  const json=JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(path)))['project.json'])) as {regions:Region[];markerPlacements:MarkerPlacement[]}
  expect(json.regions.sort((a,b)=>a.order-b.order)).toEqual(saved.regions);expect(json.markerPlacements.sort((a,b)=>a.order-b.order)).toEqual(saved.markers);expect(JSON.stringify(json)).not.toContain('selectionFrames');expect(Object.hasOwn(json,'selection')).toBe(false)
  await page.getByLabel('Project archive',{exact:true}).setInputFiles(path);await expect(page.getByText('The project copy was imported and saved on this device.',{exact:true})).toBeVisible()
  const restored=await data(page);expect(restored.regions.map(r=>r.vertices)).toEqual(saved.regions.map(r=>r.vertices));expect(restored.markers.map(m=>[m.x,m.y])).toEqual(saved.markers.map(m=>[m.x,m.y]))
  await page.reload();await expect(canvas(page)).toBeVisible();expect(await data(page)).toEqual(restored);await expect(button(page,'Clear selection')).toHaveCount(0)
  await expect(button(page,'Add region')).toBeEnabled()
  const target=restored.regions[0],targetPoint=await screen(page,{x:target.vertices[0].x+60,y:target.vertices[0].y+60});await page.mouse.click(targetPoint.x,targetPoint.y)
  await expect(card).toBeVisible();const empty=await screen(page,{x:-200,y:600});await page.mouse.click(empty.x,empty.y)
  await button(page,'Edit vertices').click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {Konva:{stages:Konva.Stage[]}}).Konva.stages[0].find('.region-vertex').length)).toBe(4)
  await button(page,'Finish vertex editing').click();await page.mouse.click(empty.x,empty.y)
  await card.getByRole('button',{name:'Delete region',exact:true}).click();await expect.poll(async()=>(await data(page)).regions.length).toBe(1)
  expect((await data(page)).markers.map(m=>[m.x,m.y])).toEqual(restored.markers.map(m=>[m.x,m.y]))
})
