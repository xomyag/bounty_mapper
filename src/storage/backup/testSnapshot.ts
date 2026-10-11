import { legacyContextDocument } from '../migrateProjectContext'
import { createProject } from '../../domain/project'
import type { ProjectSnapshot } from '../../application/projectBackupRepository'
import type { Asset } from '../../domain/project'
import { sha256 } from './archive'

export async function testSnapshot(): Promise<ProjectSnapshot> {
  const project = { ...createProject('Тестовое приключение'), revision: 1, context: legacyContextDocument('# Контекст\nЗаметки ведущего') }
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD9sAAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'image/png' })
  const assets: Asset[] = [0, 1].map((n) => ({ id: `asset-${n}`, projectId: project.id, mimeType: 'image/png', byteSize: blob.size, pixelWidth: 1, pixelHeight: 1, checksum: '', caption: `Изображение ${n}`, tags: ['карта'], blob }))
  for (const asset of assets) asset.checksum = await sha256(bytes)
  const maps = [0, 1, 2].map((n) => ({ id: `map-${n}`, projectId: project.id, name: `Этаж ${n}`, description: legacyContextDocument(`Заметки карты ${n}`), order: n, coordinateBounds: { x: n ? n * -10 : 0, y: 12, width: 2, height: 2 } }))
  const imagePlacements = assets.map((asset, n) => ({ id: `placement-${n}`, mapId: maps[n].id, assetId: asset.id, x: n ? n * -10 : 0, y: 12, width: 2, height: 2, rotation: 15, order: n, locked: true, visible: n === 0 }))
  return { project, maps, assets, imagePlacements, regions: [], entities: [], markerPlacements: [] }
}

export async function testDecode(blob: Blob, projectId: string): Promise<Asset> {
  return { id: 'decoded', projectId, mimeType: blob.type, byteSize: blob.size, pixelWidth: 1, pixelHeight: 1, checksum: await sha256(new Uint8Array(await blob.arrayBuffer())), tags: [], blob }
}
