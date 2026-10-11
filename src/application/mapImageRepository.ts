import type { Asset, ImagePlacement, Map, Project } from '../domain/project'

export interface MapImage {
  map?: Map
  background?: { placement: ImagePlacement; asset: Asset }
}
export interface MapImageResult {
  project: Project
  image: MapImage
}
export interface MapImageRepository {
  load(projectId: string, mapId?: string): Promise<MapImage>
  replace(project: Project, asset: Asset, mapId?: string): Promise<MapImageResult>
  remove(project: Project, mapId?: string): Promise<MapImageResult>
}
