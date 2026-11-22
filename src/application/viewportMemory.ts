import type { Camera } from '../domain/viewport'
import type { WorkspaceRepository } from './workspaceRepository'
import { message } from '../i18n/message'

// Local UI metadata, excluded from project data and archives.
export class ViewportMemory {
  private cameras = new Map<string, Camera>()
  private projectId?: string
  private pending = new Map<string, { projectId: string; camera: Camera }>()
  private writing = false
  private owners = new Map<string,string>()
  private forgotten = new Set<string>()
  private state: { error?: string } = {}
  private listeners = new Set<() => void>()
  constructor(private repository?: WorkspaceRepository) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private update(error?: string) { this.state = { error }; this.listeners.forEach(listener => listener()) }
  hydrate(projectId: string, cameras: Record<string,Camera>) {
    this.projectId = projectId
    for (const [id,camera] of Object.entries(cameras)) { this.owners.set(id,projectId); if (!this.cameras.has(id)) this.cameras.set(id,{ ...camera }) }
  }
  forgetMap(mapId: string) { this.forgotten.add(mapId);this.cameras.delete(mapId);this.pending.delete(mapId);this.owners.delete(mapId);if(!this.pending.size&&this.state.error)this.update() }
  forgetProject(projectId: string) { for (const [id,owner] of this.owners) if(owner===projectId)this.forgetMap(id);if(this.projectId===projectId)this.projectId=undefined }
  get(mapId: string) { const camera = this.cameras.get(mapId); return camera ? { ...camera } : undefined }
  set(mapId: string, camera: Camera) {
    if (this.forgotten.has(mapId)) return
    const previous = this.cameras.get(mapId)
    if (previous && previous.x === camera.x && previous.y === camera.y && previous.scale === camera.scale) return
    this.cameras.set(mapId, { ...camera })
    if (!this.repository || !this.projectId) return
    this.owners.set(mapId,this.projectId)
    this.pending.set(mapId,{ projectId: this.projectId, camera: { ...camera } })
    // Coalesce renders without performing storage work or React updates in render.
    queueMicrotask(() => { if (!this.state.error) void this.flush() })
  }
  flush = async () => {
    if (this.writing || !this.repository) return
    this.writing = true
    try {
      while (this.pending.size) {
        const [id,item] = this.pending.entries().next().value!
        try { await this.repository.saveCamera(item.projectId,id,item.camera) }
        catch (error) { if (!this.pending.has(id)) continue; throw error }
        if (this.pending.get(id) === item) this.pending.delete(id)
      }
      if (this.state.error) this.update()
    } catch (error) { this.update(message('order.cameraFailed', { detail: error instanceof Error ? error.message : '' })) }
    finally { this.writing = false }
  }
}
