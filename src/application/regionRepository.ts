import type { Asset, Project } from '../domain/project'
import type { Region } from '../domain/region'
import type { MapObjects } from '../domain/marker'

export interface RegionRepository {
  load(mapId: string): Promise<Region[]>
  loadAssets(mapId: string): Promise<Asset[]>
  loadObjects(mapId: string): Promise<MapObjects>
  save(project: Project, mapId: string, regions: Region[], newAssets?: Asset[], objects?: MapObjects, usedTags?: string[]): Promise<Project>
}
