import type { Bounds, Camera, Point } from './viewport'
import { screenToWorld, worldToScreen } from './viewport'

// Copy is deliberately identical in both interface languages.
export function availableCopyName(name: string, names: string[], alwaysCopy = false): string {
  const occupied = new Set(names.map((value) => value.trim().toLowerCase()))
  const base = name.trim()
  if (!alwaysCopy && !occupied.has(base.toLowerCase())) return base
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' Copy' : ` Copy ${n}`
    const candidate = base.slice(0, 512 - suffix.length).trimEnd() + suffix
    if (!occupied.has(candidate.toLowerCase())) return candidate
  }
}

// Reserve names in source order so collisions within the same import are visible
// before confirmation and use exactly the same policy inside the transaction.
export function availableCopyNames(names: string[], existing: string[]): string[] {
  const occupied = [...existing]
  return names.map((name) => {
    const result = availableCopyName(name, occupied)
    occupied.push(result)
    return result
  })
}

export function markerCopyPosition(point: Point, camera: Camera, visible: Bounds): Point {
  const screen = worldToScreen(point, camera)
  const clamp = (value: number, start: number, length: number) => Math.max(start + Math.min(24, length / 2), Math.min(start + length - Math.min(24, length / 2), value))
  return screenToWorld({ x: clamp(screen.x + 36, visible.x, visible.width), y: clamp(screen.y + 36, visible.y, visible.height) }, camera)
}
