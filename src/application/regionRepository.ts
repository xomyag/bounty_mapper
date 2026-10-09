import type { Asset, Project } from '../domain/project'
import type { Region } from '../domain/region'

export interface RegionRepository {
  load(mapId: string): Promise<Region[]>
  loadAssets(mapId: string): Promise<Asset[]>
  save(project: Project, mapId: string, regions: Region[], newAssets?: Asset[]): Promise<Project>
}
