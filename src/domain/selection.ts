import type { Point, Bounds } from './viewport'
import { polygonIntersectsBounds, translateVertices } from './region'
import type { Region } from './region'
import type { MarkerPlacement } from './marker'
import { message } from '../i18n/message'

export interface ObjectSelection { regionIds: string[]; markerIds: string[] }
export const emptySelection = (): ObjectSelection => ({ regionIds: [], markerIds: [] })
export const selectionSize = (selection: ObjectSelection) => selection.regionIds.length + selection.markerIds.length
export const selectionBounds = (a: Point, b: Point): Bounds => ({ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) })
export function validSelection(selection: ObjectSelection, regions: Region[], markers: MarkerPlacement[]): ObjectSelection {
  const allowedRegions=new Set(regions.map((r)=>r.id)), allowedMarkers=new Set(markers.filter((m)=>!m.locked).map((m)=>m.id))
  return { regionIds: [...new Set(selection.regionIds)].filter((id) => allowedRegions.has(id)), markerIds: [...new Set(selection.markerIds)].filter((id) => allowedMarkers.has(id)) }
}
export function selectBounds(bounds: Bounds, regions: Region[], markers: MarkerPlacement[], previous = emptySelection()): ObjectSelection {
  return validSelection({ regionIds: [...previous.regionIds, ...regions.filter((r) => polygonIntersectsBounds(r.vertices, bounds)).map((r) => r.id)], markerIds: [...previous.markerIds, ...markers.filter((m) => m.x >= bounds.x && m.x <= bounds.x+bounds.width && m.y >= bounds.y && m.y <= bounds.y+bounds.height).map((m) => m.id)] }, regions, markers)
}
export function translateSelection(regions: Region[], markers: MarkerPlacement[], selection: ObjectSelection, delta: Point) {
  const ids = validSelection(selection, regions, markers)
  const nextRegions = regions.map((r) => ids.regionIds.includes(r.id) ? { ...r, vertices: translateVertices(r.vertices, delta) } : r)
  const nextMarkers = markers.map((m) => ids.markerIds.includes(m.id) ? { ...m, x: m.x+delta.x, y: m.y+delta.y } : m)
  if (![delta.x,delta.y, ...nextRegions.flatMap((r) => r.vertices.flatMap((p) => [p.x,p.y])), ...nextMarkers.flatMap((m) => [m.x,m.y])].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e9)) throw new Error(message('selection.invalidOffset'))
  return { regions: nextRegions, markers: nextMarkers }
}
