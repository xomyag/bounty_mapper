import type { Camera } from '../domain/viewport'

// UI state for this app session only; excluded from project data and archives.
export class ViewportMemory {
  private cameras = new Map<string, Camera>()
  get(mapId: string) { const camera = this.cameras.get(mapId); return camera ? { ...camera } : undefined }
  set(mapId: string, camera: Camera) { this.cameras.set(mapId, { ...camera }) }
}
