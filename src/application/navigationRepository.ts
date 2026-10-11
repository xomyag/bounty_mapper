import type { NavigationData } from '../domain/navigation'
import type { Map, Project } from '../domain/project'

export interface NavigationRepository {
  load(projectId: string): Promise<NavigationData>
  createMap(project: Project, name: string): Promise<{ project: Project; map: Map }>
  renameMap(project: Project, mapId: string, name: string): Promise<Project>
  deleteMap(project: Project, mapId: string): Promise<Project>
}
