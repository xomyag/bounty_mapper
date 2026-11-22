import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createProject } from '../domain/project'
import { moveListItem } from '../domain/listOrder'
import { filterNavigation, groupNavigation, defaultFilters } from '../domain/navigation'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbNavigationRepository } from '../storage/indexedDbNavigationRepository'
import { IndexedDbWorkspaceRepository } from '../storage/indexedDbWorkspaceRepository'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { IndexedDbMapImageRepository } from '../storage/indexedDbMapImageRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbInformationRepository } from '../storage/indexedDbInformationRepository'
import { IndexedDbModeRepository } from '../storage/indexedDbModeRepository'
import { IndexedDb, requestResult } from '../storage/indexedDb'
import { workspaceKey } from '../storage/workspaceSettings'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive } from '../storage/backup/archive'
import { independentCopy } from './projectBackupRepository'
import { levelSubset } from './levelImport'
import { ProjectSession } from './projectSession'
import { NavigationSession } from './navigationSession'
import { MapImageSession } from './mapImageSession'
import { ViewportMemory } from './viewportMemory'
import { RegionSession } from './regionSession'
import { emptyRegionContent } from '../domain/region'

async function setup() {
  const factory = new IDBFactory(), db = new IndexedDb(()=>factory)
  const projects = new IndexedDbProjectRepository(()=>factory), navigation = new IndexedDbNavigationRepository(()=>factory)
  const backups = new IndexedDbProjectBackupRepository(()=>factory), workspace = new IndexedDbWorkspaceRepository(()=>factory)
  const source = await testSnapshot(); await backups.insertCopy(source)
  const session = new ProjectSession(projects); await session.initialize()
  return { factory,db,projects,navigation,backups,workspace,source,session }
}
const byOrder = <T extends {order:number}>(items:T[]) => [...items].sort((a,b)=>a.order-b.order)

describe('Local list order and last successfully opened map',()=>{
  it('moves before/after without duplicates and ignores invalid/self drops',()=>{
    expect(moveListItem(['a','b','c'],'c','a')).toEqual(['c','a','b'])
    expect(moveListItem(['a','b','c'],'a','c',true)).toEqual(['b','c','a'])
    expect(moveListItem(['a','b'],'a','a',true)).toEqual(['a','b'])
    expect(moveListItem(['a','b'],'missing','b')).toEqual(['a','b'])
  })
  it('seeds the old project sequence once, persists manual order and appends new/imported projects without timestamp resorting',async()=>{
    const {db,factory,projects,backups,source}=await setup()
    const second=await projects.save(createProject('Second')),third=await projects.save(createProject('Third'))
    await db.transaction(['settings','projects'],'readwrite',async tx=>{
      await requestResult(tx.objectStore('settings').delete('projectOrder'))
      for(const [index,project]of [second,third,source.project].entries())await requestResult(tx.objectStore('projects').put({...project,updatedAt:`2026-01-0${3-index}T00:00:00.000Z`}))
    })
    expect((await projects.list()).map(p=>p.id)).toEqual([second.id,third.id,source.project.id])
    await projects.save({...await projects.open(source.project.id),name:'Recently edited'})
    expect((await projects.list()).map(p=>p.id)).toEqual([second.id,third.id,source.project.id])
    await projects.reorder([third.id,source.project.id,second.id])
    const fourth=await projects.save(createProject('Fourth')),copy=independentCopy(source);await backups.insertCopy(copy)
    expect((await new IndexedDbProjectRepository(()=>factory).list()).map(p=>p.id)).toEqual([third.id,source.project.id,second.id,fourth.id,copy.project.id])
    expect((await projects.list()).map(p=>p.id)).toEqual([third.id,source.project.id,second.id,fourth.id,copy.project.id])
    await projects.remove(await projects.open(source.project.id))
    expect((await projects.list()).map(p=>p.id)).toEqual([third.id,second.id,fourth.id,copy.project.id])
  })
  it('rolls back failed project ordering and rejects a stale membership list',async()=>{
    const {projects,source}=await setup();const other=await projects.save(createProject('Other'))
    const put=IDBObjectStore.prototype.put
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){if(this.name==='settings'&&args[1]==='projectOrder')throw new DOMException('Order quota','QuotaExceededError');return put.apply(this,args)})
    await expect(projects.reorder([other.id,source.project.id])).rejects.toThrow('Order quota')
    expect((await projects.list()).map(p=>p.id)).toEqual([source.project.id,other.id]);fail.mockRestore()
    await expect(projects.reorder([source.project.id])).rejects.toThrow()
    await expect(projects.reorder([other.id,other.id])).rejects.toThrow()
  })
  it('writes only fresh map rows, retains workspace and data, archives order and appends an imported batch in source order',async()=>{
    const {factory,navigation,projects,backups,workspace,source}=await setup()
    const description={type:'doc' as const,content:[{type:'paragraph',content:[{type:'text',text:'Latest map text'}]}]}
    const changed=await new IndexedDbInformationRepository(()=>factory).save(source.project,{mapId:'map-1',name:'Unused',document:description},[])
    await workspace.select(source.project.id,'map-1');await workspace.saveCamera(source.project.id,'map-1',{x:91,y:-53,scale:2.3})
    const view=await workspace.load(source.project.id)
    await expect(navigation.reorderMaps(source.project,['map-2','map-1','map-0'])).rejects.toThrow()
    const reordered=await navigation.reorderMaps(changed,['map-2','map-1','map-0'])
    const after=await backups.snapshot(source.project.id)
    expect(after.maps.find(m=>m.id==='map-1')!.description).toEqual(description)
    expect(after.assets).toEqual(source.assets);expect(after.imagePlacements).toEqual(source.imagePlacements)
    expect(await workspace.load(source.project.id)).toEqual(view)
    const restored=independentCopy(await parseArchive(new Blob([new Uint8Array(await buildArchive(after))]),testDecode))
    expect(byOrder(restored.maps).map(m=>m.name)).toEqual(byOrder(after.maps).map(m=>m.name))
    expect(JSON.stringify(restored)).not.toContain('mapWorkspace')
    await backups.insertCopy(restored)
    const added=await navigation.createMap(reordered,'Last new map')
    const batch=await backups.insertLevels(added.project,independentCopy(levelSubset(after,['map-0','map-2']),source.project.id))
    expect(batch.snapshot.maps.map(m=>m.order)).toEqual([4,5])
    expect(batch.snapshot.maps.map(m=>m.name)).toEqual([source.maps[2].name+' Copy',source.maps[0].name+' Copy'])
    expect((await projects.open(source.project.id)).context).toEqual(source.project.context)
  })
  it('rolls back all map-order writes and exposes a failed reorder without changing the displayed map list',async()=>{
    const {navigation,session,backups,source}=await setup();const nav=new NavigationSession(navigation,session);await nav.load()
    const before=await backups.snapshot(source.project.id),put=IDBObjectStore.prototype.put;let count=0
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){if(this.name==='maps'&&++count===2)throw new DOMException('Map order quota','QuotaExceededError');return put.apply(this,args)})
    await nav.reorderMaps(['map-2','map-1','map-0']);expect(nav.getSnapshot().orderError).toBeTruthy()
    expect(nav.getSnapshot().data.maps.map(m=>m.id)).toEqual(['map-0','map-1','map-2'])
    expect(await backups.snapshot(source.project.id)).toEqual(before);fail.mockRestore()
    await nav.reorderMaps(['map-2','map-1','map-0']);expect(nav.getSnapshot().orderError).toBeUndefined()
    const data=nav.getSnapshot().data
    const regions=data.maps.map((m,i)=>({...emptyRegionContent(),id:'r'+i,mapId:m.id,number:i+1,title:m.name,titleCustomized:true,order:i,color:'#123456',fillOpacity:.4,vertices:[{x:0,y:0},{x:100,y:0},{x:0,y:100}]}))
    const results=filterNavigation({...data,regions},'regions',{...defaultFilters(),scope:'project'})
    expect(results.map(r=>r.mapId)).toEqual(['map-2','map-1','map-0'])
    expect(groupNavigation(results,'map',data).map(g=>g.key)).toEqual(['map-2','map-1','map-0'])
  })
  it('remembers two projects independently, falls back after deletion and removes only the deleted project settings',async()=>{
    const {projects,workspace,backups,source,navigation,db}=await setup();const copy=independentCopy(source);await backups.insertCopy(copy)
    await workspace.select(source.project.id,'map-2');await workspace.select(copy.project.id,copy.maps[1].id)
    await workspace.saveCamera(source.project.id,'map-2',{x:11,y:22,scale:3})
    await workspace.saveCamera(copy.project.id,copy.maps[1].id,{x:-3,y:7,scale:.5})
    expect((await workspace.load(source.project.id)).mapId).toBe('map-2')
    expect((await workspace.load(copy.project.id)).mapId).toBe(copy.maps[1].id)
    const reordered=await navigation.reorderMaps(source.project,['map-1','map-0','map-2'])
    const nonactive=await navigation.deleteMap(reordered,'map-0');expect((await workspace.load(source.project.id)).mapId).toBe('map-2')
    await navigation.deleteMap(nonactive,'map-2');expect(await workspace.load(source.project.id)).toEqual({mapId:'map-1',cameras:{}})
    await db.transaction(['settings'],'readwrite',tx=>requestResult(tx.objectStore('settings').put({mapId:'deleted-map',cameras:{}},workspaceKey(source.project.id))))
    expect((await workspace.load(source.project.id)).mapId).toBe('map-1')
    await projects.remove(await projects.open(source.project.id))
    expect(await db.transaction(['settings'],'readonly',tx=>requestResult(tx.objectStore('settings').get(workspaceKey(source.project.id))))).toBeUndefined()
    expect((await workspace.load(copy.project.id)).mapId).toBe(copy.maps[1].id)
  })
  it('loads the last map and camera before exposing a map; load/decode failure never writes the first map as selection',async()=>{
    const {factory,session,workspace,source}=await setup();await workspace.select(source.project.id,'map-2')
    await workspace.saveCamera(source.project.id,'map-2',{x:33,y:44,scale:1.7})
    const select=vi.spyOn(workspace,'select'),viewports=new ViewportMemory(workspace),repo=new IndexedDbMapImageRepository(()=>factory)
    const maps=new MapImageSession(repo,session,async()=>{throw new Error('unused')},()=>true,{workspace,viewports})
    const seen:(string|undefined)[]=[];maps.subscribe(()=>seen.push(maps.getSnapshot().image.map?.id))
    await maps.load(source.project.id);expect(seen.every(id=>!id||id==='map-2')).toBe(true)
    expect(viewports.get('map-2')).toEqual({x:33,y:44,scale:1.7});expect(select).not.toHaveBeenCalled()
    await maps.confirmSelection();expect(select).toHaveBeenCalledWith(source.project.id,'map-2')
    await maps.confirmSelection();expect(select).toHaveBeenCalledTimes(1)
    const failed=new MapImageSession(repo,session,async()=>{throw new Error('unused')},()=>true,{workspace,prepareOpen:async()=>{throw new Error('Decode failed')}})
    await failed.load(source.project.id);expect(failed.getSnapshot().phase).toBe('error')
    expect((await workspace.load(source.project.id)).mapId).toBe('map-2');expect(select).toHaveBeenCalledTimes(1)
  })
  it('does not remember a cancelled or failed dirty-card transition, but remembers successful shared navigation',async()=>{
    const {factory,session,workspace,source,db}=await setup()
    const region={...emptyRegionContent(),id:'r',mapId:'map-0',number:1,title:'Room',titleCustomized:true,order:0,color:'#123456',fillOpacity:.4,vertices:[{x:0,y:0},{x:100,y:0},{x:0,y:100}]}
    await db.transaction(['regions'],'readwrite',tx=>requestResult(tx.objectStore('regions').add(region)))
    const regions=new RegionSession(new IndexedDbRegionRepository(()=>factory),session,new IndexedDbModeRepository(()=>factory))
    const maps=new MapImageSession(new IndexedDbMapImageRepository(()=>factory),session,async()=>{throw new Error('unused')},()=>true,{workspace})
    await workspace.select(source.project.id,'map-0');await maps.load(source.project.id);await regions.load('map-0')
    regions.setMapNavigator(async target=>{const image=await maps.readSelection(target.mapId),objects=await regions.readMap(target.mapId);regions.adoptMap(target,objects);maps.adoptSelection(image);await maps.confirmSelection()})
    regions.openCard('r');regions.beginEdit();regions.editDetails('r',{title:'Unsaved'})
    regions.navigate({mapId:'map-1'});await regions.resolveCardIntent('stay');expect((await workspace.load(source.project.id)).mapId).toBe('map-0')
    regions.navigate({mapId:'missing'});await regions.resolveCardIntent('discard');expect((await workspace.load(source.project.id)).mapId).toBe('map-0')
    regions.navigate({mapId:'map-1'});await regions.resolveCardIntent('discard');await vi.waitFor(async()=>expect((await workspace.load(source.project.id)).mapId).toBe('map-1'))
  })
  it('retains the confirmed selection on settings failure and retries only when requested',async()=>{
    const {factory,workspace,session,source}=await setup();await workspace.select(source.project.id,'map-0')
    const repo=new IndexedDbMapImageRepository(()=>factory),maps=new MapImageSession(repo,session,async()=>{throw new Error('unused')},()=>true,{workspace})
    await maps.load(source.project.id);maps.adoptSelection(await repo.load(source.project.id,'map-1'))
    const fail=vi.spyOn(workspace,'select').mockRejectedValueOnce(new Error('Selection quota'))
    await maps.confirmSelection();expect(maps.getSnapshot().selectionError).toContain('Selection quota')
    expect((await workspace.load(source.project.id)).mapId).toBe('map-0')
    await maps.confirmSelection();expect(fail).toHaveBeenCalledTimes(1)
    await maps.retrySelection();expect((await workspace.load(source.project.id)).mapId).toBe('map-1')
    expect(maps.getSnapshot().selectionError).toBeUndefined();fail.mockRestore()
  })
  it('coalesces camera writes, reports failures, retries and never recreates metadata for a forgotten map',async()=>{
    const workspace={load:vi.fn(),select:vi.fn(),saveCamera:vi.fn().mockRejectedValueOnce(new Error('Camera quota')).mockResolvedValue(undefined)}
    const views=new ViewportMemory(workspace);views.hydrate('p',{});views.set('a',{x:1,y:2,scale:1});await vi.waitFor(()=>expect(views.getSnapshot().error).toBeTruthy())
    views.set('a',{x:7,y:8,scale:2});await views.flush();expect(views.getSnapshot().error).toBeUndefined()
    expect(workspace.saveCamera).toHaveBeenLastCalledWith('p','a',{x:7,y:8,scale:2})
    views.forgetMap('a');views.set('a',{x:99,y:99,scale:1});await views.flush();expect(workspace.saveCamera).toHaveBeenCalledTimes(2)
    expect(views.get('a')).toBeUndefined()
  })
})
