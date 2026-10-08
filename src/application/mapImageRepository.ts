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
  load(projectId: string): Promise<MapImage>
  replace(project: Project, asset: Asset): Promise<MapImageResult>
  remove(project: Project): Promise<MapImageResult>
}
