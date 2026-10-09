import type { Project } from '../domain/project'
import type { Region } from '../domain/region'

export interface RegionRepository {
  load(mapId: string): Promise<Region[]>
  save(project: Project, mapId: string, regions: Region[]): Promise<Project>
}
