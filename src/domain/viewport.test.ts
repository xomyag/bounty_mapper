import { describe, expect, it } from 'vitest'
import { fitBounds, MAX_SCALE, MIN_SCALE, screenToWorld, worldToScreen, zoomAt } from './viewport'

describe('Camera coordinates', () => {
  it('round-trips world and screen with offsets and different scales', () => {
    for (const scale of [0.001, 0.25, 1, 4, 64]) {
      const camera = { x: -173, y: 91, scale }
      const point = { x: 432.5, y: -102.75 }
      const restored = screenToWorld(worldToScreen(point, camera), camera)
      expect(restored.x).toBeCloseTo(point.x)
      expect(restored.y).toBeCloseTo(point.y)
    }
  })
  it('keeps the world point under the pointer stable while zooming', () => {
    const camera = { x: -300, y: 217, scale: 0.8 }
    const pointer = { x: 411, y: 196 }
    const before = screenToWorld(pointer, camera)
    const after = screenToWorld(pointer, zoomAt(camera, pointer, 2.4))
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
  it('limits zoom without moving the anchored world point', () => {
    const pointer = { x: 10, y: 20 }
    for (const requested of [0, 1e6]) {
      const camera = { x: 30, y: 40, scale: 1 }
      const next = zoomAt(camera, pointer, requested)
      expect([MIN_SCALE, MAX_SCALE]).toContain(next.scale)
      const before = screenToWorld(pointer, camera)
      const after = screenToWorld(pointer, next)
      expect(after.x).toBeCloseTo(before.x)
      expect(after.y).toBeCloseTo(before.y)
    }
  })
  it('fits an offset rectangular image inside the viewport and preserves proportions', () => {
    const rect = Object.freeze({ x: -90, y: 35, width: 1600, height: 800 })
    const view = { width: 900, height: 500 }
    const camera = fitBounds(rect, view)
    const topLeft = worldToScreen(rect, camera)
    const bottomRight = worldToScreen({ x: rect.x + rect.width, y: rect.y + rect.height }, camera)
    expect(topLeft.x).toBeGreaterThanOrEqual(24)
    expect(topLeft.y).toBeGreaterThanOrEqual(24)
    expect(bottomRight.x).toBeLessThanOrEqual(view.width - 24)
    expect(bottomRight.y).toBeLessThanOrEqual(view.height - 24)
    expect((bottomRight.x - topLeft.x) / (bottomRight.y - topLeft.y)).toBeCloseTo(2)
    zoomAt(camera, { x: 12, y: 98 }, camera.scale * 3)
    expect(rect).toEqual({ x: -90, y: 35, width: 1600, height: 800 })
  })
})
