import type { WorkspaceRepository, MapWorkspace } from '../application/workspaceRepository'
import type { Map } from '../domain/project'
import type { Camera } from '../domain/viewport'
import { IndexedDb, DATABASE_NAME, requestResult } from './indexedDb'
import { workspaceKey } from './workspaceSettings'
import { message } from '../i18n/message'

export function readWorkspace(value: unknown): MapWorkspace {
  const state = value as Partial<MapWorkspace> | undefined
  const cameras: Record<string, Camera> = Object.create(null)
  if (state?.cameras && typeof state.cameras === 'object') for (const [id, camera] of Object.entries(state.cameras)) {
    if (camera && [camera.x,camera.y,camera.scale].every(Number.isFinite) && camera.scale > 0) cameras[id] = { x: camera.x, y: camera.y, scale: camera.scale }
  }
  return { mapId: typeof state?.mapId === 'string' ? state.mapId : undefined, cameras }
}
export class IndexedDbWorkspaceRepository implements WorkspaceRepository {
  private db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) { this.db = new IndexedDb(factory,name) }
  load(projectId: string): Promise<MapWorkspace> {
    return this.db.transaction(['settings','maps'], 'readonly', async tx => {
      const state = readWorkspace(await requestResult(tx.objectStore('settings').get(workspaceKey(projectId))))
      const maps = await requestResult(tx.objectStore('maps').index('projectId').getAll(projectId)) as Map[]
      maps.sort((a,b) => a.order-b.order || a.id.localeCompare(b.id))
      return { mapId: maps.find(map => map.id === state.mapId)?.id ?? maps[0]?.id, cameras: Object.fromEntries(maps.filter(map => state.cameras[map.id]).map(map => [map.id,state.cameras[map.id]])) }
    })
  }
  private change(projectId: string, mapId: string, update: (state: MapWorkspace) => MapWorkspace) {
    return this.db.transaction(['settings','maps','projects'], 'readwrite', async tx => {
      const map = await requestResult(tx.objectStore('maps').get(mapId)) as Map | undefined
      if (!await requestResult(tx.objectStore('projects').get(projectId)) || map?.projectId !== projectId) throw new Error(message('order.mapMissing'))
      const settings = tx.objectStore('settings')
      const current = readWorkspace(await requestResult(settings.get(workspaceKey(projectId))))
      await requestResult(settings.put(update(current), workspaceKey(projectId)))
    })
  }
  select(projectId: string, mapId: string) { return this.change(projectId,mapId,state => ({ ...state,mapId })) }
  saveCamera(projectId: string, mapId: string, camera: Camera) { return this.change(projectId,mapId,state => ({ ...state,cameras: { ...state.cameras,[mapId]:camera } })) }
}
