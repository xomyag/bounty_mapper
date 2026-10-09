import type { Asset, ImagePlacement, Map, Project } from '../domain/project'
import type { Region } from '../domain/region'
import { remapDocumentAssets } from '../domain/richText'

export interface ProjectSnapshot {
  project: Project
  maps: Map[]
  imagePlacements: ImagePlacement[]
  assets: Asset[]
  regions: Region[]
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
    regions: snapshot.regions.map((region) => ({ ...region, id: crypto.randomUUID(), mapId: mapIds.get(region.mapId)!, vertices: region.vertices.map((point) => ({ ...point })), tags: [...region.tags], checks: region.checks.map((check) => ({ ...check, id: crypto.randomUUID() })), gmNotes: remapDocumentAssets(region.gmNotes, assetIds), playerDescription: remapDocumentAssets(region.playerDescription, assetIds) })),
  }
}
