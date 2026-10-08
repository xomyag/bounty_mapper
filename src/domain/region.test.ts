import { describe, expect, it } from 'vitest'
import { projectOnEdge, signedArea, translateVertices, validatePolygon } from './region'
import { screenToWorld, worldToScreen, zoomAt } from './viewport'

const square = [{ x: -10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 40 }, { x: -10, y: 40 }]
describe('Simple polygon geometry in map coordinates', () => {
  it('accepts clockwise, counterclockwise and concave contours, including collinear adjacent edges', () => {
    expect(signedArea(square)).toBe(1200)
    expect(signedArea([...square].reverse())).toBe(-1200)
    for (const vertices of [square, [...square].reverse(), [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 1 }, { x: 0, y: 4 }]]) expect(() => validatePolygon(vertices)).not.toThrow()
  })
  it('rejects too few/distinct vertices, zero area, crossings, touching and overlapping edges', () => {
    const invalid = [
      square.slice(0, 2), [...square, square[0]],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 }],
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 }],
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 0 }, { x: 0, y: 4 }],
      [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: 4 }],
    ]
    for (const vertices of invalid) expect(() => validatePolygon(vertices)).toThrow()
  })
  it('keeps shape and area during translation and converts a drag under pan/zoom', () => {
    const camera = { x: -200, y: 180, scale: 3.5 }
    const start = worldToScreen(square[0], camera)
    const end = screenToWorld({ x: start.x + 35, y: start.y - 70 }, camera)
    const moved = translateVertices(square, { x: end.x - square[0].x, y: end.y - square[0].y })
    expect(moved).toEqual(square.map((p) => ({ x: p.x + 10, y: p.y - 20 })))
    expect(signedArea(moved)).toBe(signedArea(square))
    const zoomed = zoomAt(camera, start, 0.3)
    expect(screenToWorld(start, zoomed).x).toBeCloseTo(square[0].x)
    expect(square[0]).toEqual({ x: -10, y: 10 })
  })
  it('projects a new vertex onto an edge without changing the contour', () => {
    expect(projectOnEdge({ x: 7, y: 9 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 7, y: 0 })
    expect(projectOnEdge({ x: 20, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 10, y: 0 })
    const inserted = [square[0], projectOnEdge({ x: 10, y: 11 }, square[0], square[1]), ...square.slice(1)]
    expect(signedArea(inserted)).toBe(signedArea(square))
    expect(() => validatePolygon(inserted)).not.toThrow()
  })
})
