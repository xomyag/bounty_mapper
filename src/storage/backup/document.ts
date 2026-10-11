import type { Asset, ImagePlacement, Map as ProjectMap, Project } from '../../domain/project'
import { PROJECT_SCHEMA_VERSION } from '../../domain/project'
import { emptyRegionContent, MAX_REGIONS, MAX_REGION_VERTICES, validateRegion } from '../../domain/region'
import type { Region } from '../../domain/region'
import { documentAssetIds, validateRichDocument } from '../../domain/richText'
import { markdownToDocument } from '../migrateRegionText'
import type { ProjectSnapshot } from '../../application/projectBackupRepository'
import { BACKUP_LIMITS } from './zip'
import type { BackupLimits } from './zip'
import { MAX_ENTITIES, MAX_MARKERS, validateEntity, validateMarker } from '../../domain/marker'
import type { Entity, MarkerPlacement, MarkerKind } from '../../domain/marker'

export type AssetRecord = Omit<Asset, 'blob'> & { path: string }
export interface BackupDocument {
  project: Project
  maps: ProjectMap[]
  imagePlacements: ImagePlacement[]
  assets: AssetRecord[]
  regions: Region[]
  entities: Entity[]
  markerPlacements: MarkerPlacement[]
}
function invalid(): never { throw new Error('Некорректная структура данных проекта.') }
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const object = value as Record<string, unknown>
  if (required.some((key) => !Object.hasOwn(object, key)) || Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key))) return invalid()
  return object
}
function string(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) return invalid()
  return value
}
function number(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) return invalid()
  return value
}
function integer(value: unknown, min = 0): number {
  const result = number(value)
  if (!Number.isSafeInteger(result) || result < min) return invalid()
  return result
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value }
function array(value: unknown, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) return invalid(); return value }
function date(value: unknown): string { const text = string(value); if (!Number.isFinite(Date.parse(text))) return invalid(); return text }
function bounds(value: unknown) {
  const b = record(value, ['x', 'y', 'width', 'height'])
  return { x: number(b.x), y: number(b.y), width: number(b.width, true), height: number(b.height, true) }
}
function unique(items: { id: string }[]) { if (new Set(items.map((item) => item.id)).size !== items.length) return invalid() }

export function validateDocument(value: unknown, limits: BackupLimits = BACKUP_LIMITS, formatVersion = 7): BackupDocument {
  const root = record(value, ['project', 'maps', 'imagePlacements', 'assets', ...(formatVersion === 1 ? [] : ['regions']), ...(formatVersion < 5 ? [] : ['entities', 'markerPlacements'])])
  const p = record(root.project, ['id', 'name', 'contextMd', 'schemaVersion', 'revision', 'createdAt', 'updatedAt'])
  if (p.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия данных проекта не поддерживается.')
  const project: Project = { id: string(p.id, true), name: string(p.name, true), contextMd: string(p.contextMd), schemaVersion: PROJECT_SCHEMA_VERSION, revision: integer(p.revision, 1), createdAt: date(p.createdAt), updatedAt: date(p.updatedAt) }
  const maps: ProjectMap[] = array(root.maps, limits.maps).map((value) => {
    const m = record(value, ['id', 'projectId', 'name', 'notesMd', 'order', 'coordinateBounds'])
    return { id: string(m.id, true), projectId: string(m.projectId, true), name: string(m.name, true), notesMd: string(m.notesMd), order: integer(m.order), coordinateBounds: bounds(m.coordinateBounds) }
  })
  const assets: AssetRecord[] = array(root.assets, limits.assets).map((value) => {
    const a = record(value, ['id', 'projectId', 'mimeType', 'byteSize', 'pixelWidth', 'pixelHeight', 'checksum', 'tags', 'path'], ['caption'])
    const mimeType = string(a.mimeType)
    const path = string(a.path)
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[mimeType]
    if (!extension || !new RegExp(`^assets/[0-9]+\\.${extension}$`).test(path)) return invalid()
    const byteSize = integer(a.byteSize, 1)
    const checksum = string(a.checksum)
    if (byteSize > limits.assetBytes || !/^[a-f0-9]{64}$/.test(checksum)) return invalid()
    const pixelWidth = integer(a.pixelWidth, 1); const pixelHeight = integer(a.pixelHeight, 1)
    // Bound image decoding too; metadata is checked against actual decoded dimensions later.
    if (pixelWidth * pixelHeight > 64 * 1024 * 1024) throw new Error('Изображение превышает лимит 64 мегапикселей.')
    return { id: string(a.id, true), projectId: string(a.projectId, true), mimeType, path, byteSize, pixelWidth, pixelHeight, checksum, tags: array(a.tags, 1024).map((tag) => string(tag)), ...(a.caption === undefined ? {} : { caption: string(a.caption) }) }
  })
  const imagePlacements: ImagePlacement[] = array(root.imagePlacements, limits.maps).map((value) => {
    const i = record(value, ['id', 'mapId', 'assetId', 'x', 'y', 'width', 'height', 'rotation', 'order', 'locked', 'visible'])
    return { id: string(i.id, true), mapId: string(i.mapId, true), assetId: string(i.assetId, true), x: number(i.x), y: number(i.y), width: number(i.width, true), height: number(i.height, true), rotation: number(i.rotation), order: integer(i.order), locked: boolean(i.locked), visible: boolean(i.visible) }
  })
  let vertexCount = 0
  const regions: Region[] = (formatVersion === 1 ? [] : array(root.regions, MAX_REGIONS)).map((value) => {
    const r = record(value, ['id', 'mapId', 'vertices', 'order', 'number', 'title', 'color', 'fillOpacity', ...(formatVersion < 3 ? [] : formatVersion === 3 ? ['gmNotesMd', 'playerDescriptionMd', 'checks', 'tags'] : ['gmNotes', 'playerDescription', 'titleCustomized', 'checks', 'tags']), ...(formatVersion < 7 ? [] : ['shortDescription'])])
    const vertices = array(r.vertices, MAX_REGION_VERTICES).map((value) => {
      const p = record(value, ['x', 'y'])
      return { x: number(p.x), y: number(p.y) }
    })
    vertexCount += vertices.length
    if (vertexCount > 65536) throw new Error('Превышен лимит вершин проекта: 65536.')
    if (formatVersion >= 4) { validateRichDocument(r.gmNotes); validateRichDocument(r.playerDescription) }
    const content = formatVersion < 3 ? emptyRegionContent() : {
      gmNotes: formatVersion === 3 ? markdownToDocument(string(r.gmNotesMd)) : r.gmNotes as Region['gmNotes'], playerDescription: formatVersion === 3 ? markdownToDocument(string(r.playerDescriptionMd)) : r.playerDescription as Region['playerDescription'], tags: array(r.tags, 256).map((tag) => string(tag, true)),
      checks: array(r.checks, 256).map((value) => {
        const c = record(value, ['id', 'condition', 'ability', 'result'], ['dc'])
        return { id: string(c.id, true), condition: string(c.condition), ability: string(c.ability), result: string(c.result), ...(c.dc === undefined ? {} : { dc: integer(c.dc) }) }
      }),
    }
    const region: Region = { ...content, shortDescription: formatVersion < 7 ? '' : string(r.shortDescription), titleCustomized: formatVersion < 4 ? r.title !== `Область ${r.number}` : boolean(r.titleCustomized), id: string(r.id, true), mapId: string(r.mapId, true), vertices, order: integer(r.order), number: integer(r.number, 1), title: string(r.title, true), color: string(r.color), fillOpacity: number(r.fillOpacity) }
    validateRegion(region)
    return region
  })
  const entities: Entity[] = (formatVersion < 5 ? [] : array(root.entities, MAX_ENTITIES)).map((value) => {
    const e = record(value, ['id', 'projectId', 'kind', 'name', 'description', 'status', 'tags', ...(formatVersion < 7 ? [] : ['checks'])])
    validateRichDocument(e.description)
    if (formatVersion < 7 && e.kind === 'trap') return invalid()
    const checks = formatVersion < 7 ? [] : array(e.checks, 256).map((value) => { const c = record(value, ['id', 'condition', 'ability', 'result'], ['dc']); return { id: string(c.id, true), condition: string(c.condition), ability: string(c.ability), result: string(c.result), ...(c.dc === undefined ? {} : { dc: integer(c.dc, 1) }) } })
    const entity: Entity = { checks, id: string(e.id, true), projectId: string(e.projectId, true), kind: string(e.kind) as MarkerKind, name: string(e.name, true), description: e.description, status: string(e.status, true), tags: array(e.tags, 256).map((tag) => string(tag, true)) }
    validateEntity(entity); return entity
  })
  const markerPlacements: MarkerPlacement[] = (formatVersion < 5 ? [] : array(root.markerPlacements, MAX_MARKERS)).map((value) => {
    const m = record(value, ['id', 'mapId', 'entityId', 'x', 'y', 'color', 'locked', 'order', ...(formatVersion < 6 ? [] : ['regionIds'])], formatVersion < 6 ? ['regionId'] : [])
    const regionIds = formatVersion < 6 ? m.regionId === undefined ? [] : [string(m.regionId, true)] : array(m.regionIds, MAX_REGIONS).map((id) => string(id, true))
    const marker = { id: string(m.id, true), mapId: string(m.mapId, true), entityId: string(m.entityId, true), x: number(m.x), y: number(m.y), color: string(m.color), locked: boolean(m.locked), order: integer(m.order), regionIds }
    validateMarker(marker); return marker
  })
  unique(maps); unique(assets); unique(imagePlacements); unique(regions); unique(entities); unique(markerPlacements)
  if (new Set(assets.map((asset) => asset.path)).size !== assets.length || new Set(imagePlacements.map((placement) => placement.mapId)).size !== imagePlacements.length) return invalid()
  if (maps.some((map) => map.projectId !== project.id) || assets.some((asset) => asset.projectId !== project.id)) throw new Error('Карта или изображение относится к другому проекту.')
  const mapIds = new Set(maps.map((map) => map.id)); const assetIds = new Set(assets.map((asset) => asset.id))
  if (imagePlacements.some((placement) => !mapIds.has(placement.mapId) || !assetIds.has(placement.assetId))) throw new Error('В проекте есть ссылка на отсутствующую карту или изображение.')
  if (regions.some((region) => !mapIds.has(region.mapId))) throw new Error('Область ссылается на отсутствующую карту.')
  if (regions.some((region) => [...documentAssetIds(region.gmNotes), ...documentAssetIds(region.playerDescription)].some((id) => !assetIds.has(id)))) throw new Error('Текст области ссылается на отсутствующее изображение.')
  const entityIds = new Set(entities.map((e) => e.id))
  if (entities.some((e) => e.projectId !== project.id || documentAssetIds(e.description).some((id) => !assetIds.has(id)))) throw new Error('Сущность ссылается на другой проект или отсутствующее изображение.')
  if (markerPlacements.some((m) => !mapIds.has(m.mapId) || !entityIds.has(m.entityId) || m.regionIds.some((id) => !regions.some((r) => r.id === id && r.mapId === m.mapId)))) throw new Error('Некорректная ссылка размещения маркера.')
  return { project, maps, assets, imagePlacements, regions, entities, markerPlacements }
}

// Explicit field projection: storage/UI extras and secrets never enter the archive.
export function documentFromSnapshot(snapshot: ProjectSnapshot): BackupDocument {
  const p = snapshot.project
  return validateDocument({
    project: { id: p.id, name: p.name, contextMd: p.contextMd, schemaVersion: p.schemaVersion, revision: p.revision, createdAt: p.createdAt, updatedAt: p.updatedAt },
    entities: snapshot.entities.map((e) => ({ id: e.id, projectId: e.projectId, kind: e.kind, name: e.name, description: e.description, status: e.status, tags: [...e.tags], checks: e.checks.map((c) => ({ id: c.id, condition: c.condition, ability: c.ability, result: c.result, ...(c.dc === undefined ? {} : { dc: c.dc }) })) })),
    markerPlacements: snapshot.markerPlacements.map((m) => ({ id: m.id, mapId: m.mapId, entityId: m.entityId, x: m.x, y: m.y, color: m.color, locked: m.locked, order: m.order, regionIds: [...m.regionIds] })),
    maps: snapshot.maps.map((m) => ({ id: m.id, projectId: m.projectId, name: m.name, notesMd: m.notesMd, order: m.order, coordinateBounds: { x: m.coordinateBounds.x, y: m.coordinateBounds.y, width: m.coordinateBounds.width, height: m.coordinateBounds.height } })),
    imagePlacements: snapshot.imagePlacements.map((i) => ({ id: i.id, mapId: i.mapId, assetId: i.assetId, x: i.x, y: i.y, width: i.width, height: i.height, rotation: i.rotation, order: i.order, locked: i.locked, visible: i.visible })),
    regions: snapshot.regions.map((r) => ({ shortDescription: r.shortDescription, id: r.id, mapId: r.mapId, vertices: r.vertices.map((p) => ({ x: p.x, y: p.y })), order: r.order, number: r.number, title: r.title, titleCustomized: r.titleCustomized, color: r.color, fillOpacity: r.fillOpacity, gmNotes: r.gmNotes, playerDescription: r.playerDescription, tags: [...r.tags], checks: r.checks.map((c) => ({ id: c.id, condition: c.condition, ability: c.ability, result: c.result, ...(c.dc === undefined ? {} : { dc: c.dc }) })) })),
    assets: snapshot.assets.map((a, index) => ({ id: a.id, projectId: a.projectId, mimeType: a.mimeType, byteSize: a.byteSize, pixelWidth: a.pixelWidth, pixelHeight: a.pixelHeight, checksum: a.checksum, tags: [...a.tags], ...(a.caption === undefined ? {} : { caption: a.caption }), path: `assets/${index}.${a.mimeType === 'image/jpeg' ? 'jpg' : a.mimeType === 'image/png' ? 'png' : 'webp'}` })),
  })
}
