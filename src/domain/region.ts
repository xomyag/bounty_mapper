import type { Point } from './viewport'

export const MAX_REGION_VERTICES = 512
export const MAX_REGIONS = 2048
export interface Region {
  id: string
  mapId: string
  vertices: Point[]
  order: number
  number: number
  title: string
  color: string
  fillOpacity: number
}

const EPS = 1e-8
export const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const onSegment = (a: Point, b: Point, p: Point) => Math.abs(cross(a, b, p)) < EPS &&
  p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
function intersects(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c); const abD = cross(a, b, d)
  const cdA = cross(c, d, a); const cdB = cross(c, d, b)
  return ((abC > EPS && abD < -EPS || abC < -EPS && abD > EPS) && (cdA > EPS && cdB < -EPS || cdA < -EPS && cdB > EPS)) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

export function signedArea(vertices: Point[]): number {
  if (vertices.length < 3) return 0
  const origin = vertices[0]
  return vertices.reduce((sum, point, i) => sum + cross(origin, point, vertices[(i + 1) % vertices.length]), 0) / 2
}

export function validatePolygon(vertices: Point[]): void {
  if (vertices.length < 3) throw new Error('Нужны минимум три различные вершины.')
  if (vertices.length > MAX_REGION_VERTICES) throw new Error(`Допустимо не более ${MAX_REGION_VERTICES} вершин области.`)
  if (vertices.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9)) throw new Error('Некорректные координаты области.')
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) if (samePoint(vertices[i], vertices[j])) throw new Error('Вершины области должны различаться.')
    const a = vertices[i]; const b = vertices[(i + 1) % vertices.length]; const c = vertices[(i + 2) % vertices.length]
    if (Math.abs(cross(a, b, c)) < EPS && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) throw new Error('Контур не должен пересекать себя.')
    for (let j = i + 2; j < vertices.length; j++) {
      if (i === 0 && j === vertices.length - 1) continue
      if (intersects(a, b, vertices[j], vertices[(j + 1) % vertices.length])) throw new Error('Контур не должен пересекать себя.')
    }
  }
  if (Math.abs(signedArea(vertices)) < EPS) throw new Error('Площадь области должна быть больше нуля.')
}

export function validateRegion(region: Region): void {
  if (!region.id || !region.mapId || !Number.isSafeInteger(region.number) || region.number < 1 ||
      !Number.isSafeInteger(region.order) || region.order < 0 || typeof region.title !== 'string' || !region.title.trim() ||
      !/^#[a-f0-9]{6}$/i.test(region.color) || !Number.isFinite(region.fillOpacity) || region.fillOpacity < 0 || region.fillOpacity > 1) throw new Error('Некорректные свойства области.')
  validatePolygon(region.vertices)
}

export const translateVertices = (vertices: Point[], offset: Point): Point[] => vertices.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }))
export function projectOnEdge(point: Point, a: Point, b: Point): Point {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length)) : 0
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
}

// Centroids may fall outside concave polygons; a vertex average gives a stable label anchor.
export function labelAnchor(vertices: Point[]): Point {
  return { x: vertices.reduce((sum, p) => sum + p.x, 0) / vertices.length, y: vertices.reduce((sum, p) => sum + p.y, 0) / vertices.length }
}
