import type { Camera } from '../domain/viewport'
export interface MapWorkspace { mapId?: string; cameras: Record<string, Camera> }
export interface WorkspaceRepository {
  load(projectId: string): Promise<MapWorkspace>
  select(projectId: string, mapId: string): Promise<void>
  saveCamera(projectId: string, mapId: string, camera: Camera): Promise<void>
}
