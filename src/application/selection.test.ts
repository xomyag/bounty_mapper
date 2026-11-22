import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { emptyRegionContent, polygonIntersectsBounds, translateVertices } from '../domain/region'
import { emptyDocument } from '../domain/richText'
import { emptySelection, selectBounds, selectionBounds, translateSelection } from '../domain/selection'
import { RegionSession } from './regionSession'
import { ProjectSession } from './projectSession'
import { IndexedDbProjectBackupRepository } from '../storage/indexedDbProjectBackupRepository'
import { IndexedDbProjectRepository } from '../storage/indexedDbProjectRepository'
import { IndexedDbRegionRepository } from '../storage/indexedDbRegionRepository'
import { IndexedDbModeRepository } from '../storage/indexedDbModeRepository'
import { testSnapshot, testDecode } from '../storage/backup/testSnapshot'
import { buildArchive, parseArchive } from '../storage/backup/archive'
import { independentCopy } from './projectBackupRepository'

async function setup() {
  const factory=new IDBFactory(); const backups=new IndexedDbProjectBackupRepository(()=>factory)
  const source=await testSnapshot()
  source.regions=[0,1].map(i=>({...emptyRegionContent(),id:`r${i}`,mapId:source.maps[0].id,number:i+1,title:`Region ${i}`,titleCustomized:true,color:'#aabbcc',fillOpacity:.4,order:i,vertices:[{x:i*200,y:0},{x:i*200+100,y:0},{x:i*200+100,y:100},{x:i*200,y:100}]}))
  source.entities=[{id:'e',projectId:source.project.id,kind:'enemy',name:'Guard',status:'alive',checks:[],tags:[],description:emptyDocument()}]
  source.markerPlacements=[0,1,2].map(i=>({id:`m${i}`,entityId:'e',mapId:source.maps[0].id,x:i*100+50,y:50,locked:i===2,regionIds:['r0','r1'],color:'#aabbcc',order:i}))
  await backups.insertCopy(source)
  const projects=new ProjectSession(new IndexedDbProjectRepository(()=>factory)); await projects.initialize()
  const repository=new IndexedDbRegionRepository(()=>factory)
  const session=new RegionSession(repository,projects,new IndexedDbModeRepository(()=>factory)); await session.load(source.maps[0].id)
  return {source,session,repository,backups,projects,factory}
}

describe('Transient object selection and atomic movement',()=>{
  it('intersects the actual polygon including concavities, contained rectangles, crossing edges and boundaries',()=>{
    const l=[{x:0,y:0},{x:10,y:0},{x:10,y:3},{x:3,y:3},{x:3,y:10},{x:0,y:10}]
    expect(polygonIntersectsBounds(l,{x:5,y:5,width:1,height:1})).toBe(false)
    expect(polygonIntersectsBounds(l,{x:1,y:1,width:1,height:1})).toBe(true)
    expect(polygonIntersectsBounds(l,{x:-1,y:-1,width:12,height:12})).toBe(true)
    expect(polygonIntersectsBounds(l,{x:2.9,y:6,width:.2,height:.1})).toBe(true)
    expect(polygonIntersectsBounds(l,{x:10,y:0,width:2,height:1})).toBe(true)
    expect(polygonIntersectsBounds([{x:-10,y:4},{x:10,y:4},{x:10,y:6},{x:-10,y:6}],{x:-1,y:0,width:2,height:10})).toBe(true)
    expect(selectionBounds({x:4,y:6},{x:-2,y:1})).toEqual({x:-2,y:1,width:6,height:5})
  })
  it('selects intersected regions and marker centers only; deduplicates additive selection and excludes locks',async()=>{
    const {source}=await setup()
    const first=selectBounds({x:45,y:45,width:10,height:10},source.regions,source.markerPlacements)
    expect(first).toEqual({regionIds:['r0'],markerIds:['m0']})
    expect(selectBounds({x:65,y:45,width:10,height:10},[],source.markerPlacements)).toEqual(emptySelection())
    expect(selectBounds({x:0,y:0,width:400,height:100},source.regions,source.markerPlacements,first)).toEqual({regionIds:['r0','r1'],markerIds:['m0','m1']})
  })
  it('translates selected shapes once without mutating originals or implicitly moving linked/locked markers',async()=>{
    const {source}=await setup(); const before=structuredClone(source)
    const next=translateSelection(source.regions,source.markerPlacements,{regionIds:['r0','r1','r0'],markerIds:['m0','m0','m2']},{x:12,y:-8})
    expect(next.regions[0].vertices).toEqual(translateVertices(source.regions[0].vertices,{x:12,y:-8}))
    expect(next.markers[0]).toMatchObject({x:62,y:42,regionIds:['r0','r1']})
    expect(next.markers[1]).toEqual(source.markerPlacements[1]); expect(next.markers[2]).toEqual(source.markerPlacements[2])
    expect(source).toEqual(before)
    expect(()=>translateSelection(source.regions,source.markerPlacements,{regionIds:['r0'],markerIds:[]},{x:Infinity,y:0})).toThrow()
  })
  it('saves a mixed group once, undoes/redoes the entire group and round-trips geometry without exporting selection',async()=>{
    const {source,session,repository,backups}=await setup()
    session.boxSelect({x:-1,y:-1,width:400,height:102}); const selection=session.getSnapshot().selection
    const save=vi.spyOn(repository,'save')
    expect(session.prepareObjectMove()).toBe(true)
    await session.moveObjects(selection,{x:21,y:13})
    expect(save).toHaveBeenCalledTimes(1)
    const after=await backups.snapshot(source.project.id)
    expect(after.markerPlacements.find(m=>m.id==='m0')).toMatchObject({x:71,y:63})
    expect(after.markerPlacements.find(m=>m.id==='m2')).toEqual(source.markerPlacements[2])
    expect(session.getSnapshot().cardId).toBeUndefined()
    await session.undo(); expect((await backups.snapshot(source.project.id)).regions).toEqual(source.regions)
    expect((await backups.snapshot(source.project.id)).markerPlacements).toEqual(source.markerPlacements)
    await session.redo(); expect((await backups.snapshot(source.project.id)).regions).toEqual(after.regions)
    const decoded=await parseArchive(new Blob([new Uint8Array(await buildArchive(after))]),testDecode)
    const copy=independentCopy(decoded); await backups.insertCopy(copy)
    expect(copy.regions[0].vertices).toEqual(after.regions[0].vertices)
    expect(copy.markerPlacements.map(m=>[m.x,m.y])).toEqual(after.markerPlacements.map(m=>[m.x,m.y]))
    expect(JSON.stringify(decoded)).not.toContain('selection')
  })
  it('rolls back a late failed write, retaining original UI coordinates and a single retryable group command',async()=>{
    const {source,session,backups}=await setup()
    const selection={regionIds:['r0','r1'],markerIds:['m0','m1']}; session.setSelection(selection)
    const put=IDBObjectStore.prototype.put
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<typeof put>){if(this.name==='projects')throw new DOMException('Test quota','QuotaExceededError');return put.apply(this,args)})
    await session.moveObjects(selection,{x:10,y:20}); fail.mockRestore()
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    expect(session.getSnapshot()).toMatchObject({phase:'error',regions:source.regions,markers:source.markerPlacements,canUndo:false,canRetry:true})
    await session.retry(); expect(session.getSnapshot().phase).toBe('saved')
    await session.undo(); expect((await backups.snapshot(source.project.id)).regions).toEqual(source.regions)
    expect((await backups.snapshot(source.project.id)).markerPlacements).toEqual(source.markerPlacements)
  })
  it('resolves dirty cards before movement and drops clean stale geometry before starting',async()=>{
    const {source,session,backups}=await setup()
    session.openCard('r0'); session.beginEdit(); session.editDetails('r0',{title:'New text'})
    expect(session.prepareObjectMove()).toBe(false); expect(session.getSnapshot().pendingIntent?.kind).toBe('action')
    await session.resolveCardIntent('stay'); expect(session.getSnapshot().details.r0.fields.title).toBe('New text')
    expect(await backups.snapshot(source.project.id)).toEqual(source)
    expect(session.prepareObjectMove()).toBe(false); await session.resolveCardIntent('save')
    expect(session.prepareObjectMove()).toBe(true); await session.moveObjects({regionIds:['r0'],markerIds:[]},{x:8,y:4})
    session.beginEdit(); session.editDetails('r0',{title:'After drag'}); await session.saveDetails()
    expect((await backups.snapshot(source.project.id)).regions[0]).toMatchObject({title:'After drag',vertices:translateVertices(source.regions[0].vertices,{x:8,y:4})})
  })
  it('clears selection on map/mode/tool transitions and blocks game movement without changing saved data',async()=>{
    const {source,session,backups}=await setup()
    session.boxSelect({x:0,y:0,width:400,height:100}); session.requestMode('play')
    await vi.waitFor(()=>expect(session.getSnapshot().mode).toBe('play'))
    expect(session.getSnapshot().selection).toEqual(emptySelection())
    await session.moveObjects({regionIds:['r0'],markerIds:['m0']},{x:100,y:100})
    expect((await backups.snapshot(source.project.id)).regions).toEqual(source.regions)
    session.requestMode('prepare'); await vi.waitFor(()=>expect(session.getSnapshot().mode).toBe('prepare'))
    session.boxSelect({x:0,y:0,width:400,height:100}); session.startMarker('npc'); expect(session.getSnapshot().selection).toEqual(emptySelection()); session.cancelMarkerTool()
    session.boxSelect({x:0,y:0,width:400,height:100}); await session.load(source.maps[1].id); expect(session.getSnapshot().selection).toEqual(emptySelection())
  })
  it('keeps explicit card actions and vertex mode usable after clearing selection',async()=>{
    const {session,source,backups}=await setup()
    session.openCard('r0');session.clearSelection()
    expect(session.getSnapshot()).toMatchObject({cardId:'r0',selectedId:undefined})
    session.setVertexMode(true);expect(session.getSnapshot()).toMatchObject({vertexMode:true,selectedId:'r0'})
    session.setVertexMode(false);session.clearSelection();await session.remove('r0')
    const after=await backups.snapshot(source.project.id)
    expect(after.regions.map(r=>r.id)).toEqual(['r1']);expect(after.markerPlacements.every(m=>m.regionIds.length===1&&m.regionIds[0]==='r1')).toBe(true)
  })
})
