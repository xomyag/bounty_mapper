import type { WorkspaceMode } from '../domain/workspaceMode'

export interface ModeRepository {
  load(projectId: string): Promise<WorkspaceMode>
  save(projectId: string, mode: WorkspaceMode): Promise<void>
}
