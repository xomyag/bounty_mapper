import { message, t } from '../i18n'
import { emptyDocument } from '../domain/richText'
import type { MapImage, MapImageRepository, MapImageResult } from '../application/mapImageRepository'
import { RevisionConflictError } from '../application/projectRepository'
import type { Asset, ImagePlacement, Map, Project } from '../domain/project'
import { IndexedDb, requestResult, DATABASE_NAME } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'
import type { Region } from '../domain/region'
import { documentAssetIds } from '../domain/richText'
import type { Entity } from '../domain/marker'

const stores = ['projects', 'maps', 'assets', 'imagePlacements', 'regions', 'entities']

async function loadMap(tx: IDBTransaction, projectId: string, mapId?: string): Promise<MapImage> {
  const maps = await requestResult(tx.objectStore('maps').index('projectId').getAll(projectId)) as Map[]
  const map = mapId ? maps.find((m) => m.id === mapId) : maps.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0]
  if (mapId && !map) throw new Error(message("ui.map.not.found.in.the.current.project"))
  if (!map) return {}
  const placement = await requestResult(tx.objectStore('imagePlacements').index('mapId').get(map.id)) as ImagePlacement | undefined
  if (!placement) return { map }
  const asset = await requestResult(tx.objectStore('assets').get(placement.assetId)) as Asset | undefined
  if (!asset || asset.projectId !== projectId || !asset.blob || asset.blob.size !== asset.byteSize ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) ||
      ![placement.x, placement.y, placement.width, placement.height, placement.rotation].every(Number.isFinite) ||
      placement.width <= 0 || placement.height <= 0) throw new Error(message("ui.could.not.read.the.saved.image.invalid.map.data"))
  return { map, background: { placement, asset } }
}

export class IndexedDbMapImageRepository implements MapImageRepository {
  private readonly db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) {
    this.db = new IndexedDb(factory, name)
  }

  load(projectId: string, mapId?: string): Promise<MapImage> {
    return this.db.transaction(stores, 'readonly', (tx) => loadMap(tx, projectId, mapId))
  }

  private mutate(project: Project, asset?: Asset, mapId?: string): Promise<MapImageResult> {
    return this.db.transaction(stores, 'readwrite', async (tx) => {
      const projectStore = tx.objectStore('projects')
      const stored = readProject(await requestResult(projectStore.get(project.id)))
      if (stored.revision !== project.revision) throw new RevisionConflictError()
      const previous = await loadMap(tx, project.id, mapId)
      const nextProject = { ...stored, revision: stored.revision + 1, updatedAt: new Date().toISOString() }
      if (!asset && !previous.background) return { project: stored, image: previous }
      let image: MapImage
      if (asset) {
        if (asset.projectId !== project.id || asset.byteSize !== asset.blob.size || asset.byteSize === 0 ||
            !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) ||
            !Number.isInteger(asset.pixelWidth) || !Number.isInteger(asset.pixelHeight) || asset.pixelWidth <= 0 || asset.pixelHeight <= 0) {
          throw new Error(message("ui.invalid.image.metadata"))
        }
        const placement: ImagePlacement = {
          id: previous.background?.placement.id ?? crypto.randomUUID(),
          mapId: previous.map?.id ?? crypto.randomUUID(), assetId: asset.id,
          x: previous.background?.placement.x ?? 0, y: previous.background?.placement.y ?? 0,
          width: asset.pixelWidth, height: asset.pixelHeight, rotation: 0, order: 0, locked: true, visible: true,
        }
        const map: Map = {
          ...(previous.map ?? { id: placement.mapId, projectId: project.id, name: t("ui.map.1"), description: emptyDocument(), order: 0 }),
          coordinateBounds: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
        }
        await requestResult(tx.objectStore('assets').add(asset))
        await requestResult(tx.objectStore('maps').put(map))
        await requestResult(tx.objectStore('imagePlacements').put(placement))
        image = { map, background: { placement, asset } }
      } else {
        await requestResult(tx.objectStore('imagePlacements').delete(previous.background!.placement.id))
        image = { map: previous.map }
      }
      if (previous.background) {
        const remaining = await requestResult(tx.objectStore('imagePlacements').getAll()) as ImagePlacement[]
        const regions = await requestResult(tx.objectStore('regions').getAll()) as Region[]
        const entities = await requestResult(tx.objectStore('entities').getAll()) as Entity[]
        const projects = await requestResult(projectStore.getAll()) as Project[]
        const maps = await requestResult(tx.objectStore('maps').getAll()) as Map[]
        const usedInText = [...projects.map((p) => p.context), ...maps.map((m) => m.description)].some((doc) => documentAssetIds(doc).includes(previous.background!.asset.id)) || regions.some((r) => [...documentAssetIds(r.gmNotes), ...documentAssetIds(r.playerDescription)].includes(previous.background!.asset.id)) || entities.some((e) => documentAssetIds(e.description).includes(previous.background!.asset.id))
        if (!usedInText && !remaining.some((item) => item.assetId === previous.background!.asset.id)) await requestResult(tx.objectStore('assets').delete(previous.background.asset.id))
      }
      await requestResult(projectStore.put(nextProject))
      return { project: nextProject, image }
    })
  }

  replace(project: Project, asset: Asset, mapId?: string) { return this.mutate(project, asset, mapId) }
  remove(project: Project, mapId?: string) { return this.mutate(project, undefined, mapId) }
}
