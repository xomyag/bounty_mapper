import type { Asset, ImagePlacement, Map, Project } from '../domain/project'

export interface ProjectSnapshot {
  project: Project
  maps: Map[]
  imagePlacements: ImagePlacement[]
  assets: Asset[]
}
export interface ProjectBackupRepository {
  snapshot(projectId: string): Promise<ProjectSnapshot>
  insertCopy(snapshot: ProjectSnapshot): Promise<Project>
}

export function independentCopy(snapshot: ProjectSnapshot): ProjectSnapshot {
  const now = new Date().toISOString()
  const projectId = crypto.randomUUID()
  const mapIds = new globalThis.Map(snapshot.maps.map((map) => [map.id, crypto.randomUUID()]))
  const assetIds = new globalThis.Map(snapshot.assets.map((asset) => [asset.id, crypto.randomUUID()]))
  return {
    project: { ...snapshot.project, id: projectId, name: `${snapshot.project.name} (копия)`, revision: 1, createdAt: now, updatedAt: now },
    maps: snapshot.maps.map((map) => ({ ...map, id: mapIds.get(map.id)!, projectId })),
    assets: snapshot.assets.map((asset) => ({ ...asset, id: assetIds.get(asset.id)!, projectId })),
    imagePlacements: snapshot.imagePlacements.map((placement) => ({ ...placement, id: crypto.randomUUID(), mapId: mapIds.get(placement.mapId)!, assetId: assetIds.get(placement.assetId)! })),
  }
}
