export interface Point { x: number; y: number }
export interface Camera extends Point { scale: number }
export interface Bounds extends Point { width: number; height: number }
export const MIN_SCALE = 0.001
export const MAX_SCALE = 64

export function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }
}
export function worldToScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y }
}
export function centerOn(camera: Camera, point: Point, view: { width: number; height: number }): Camera {
  return { scale: camera.scale, x: view.width / 2 - point.x * camera.scale, y: view.height / 2 - point.y * camera.scale }
}
export function zoomAt(camera: Camera, pointer: Point, requestedScale: number): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale))
  const world = screenToWorld(pointer, camera)
  return { scale, x: pointer.x - world.x * scale, y: pointer.y - world.y * scale }
}
export function fitBounds(bounds: Bounds, view: { width: number; height: number }, padding = 24): Camera {
  const scale = Math.min((Math.max(1, view.width - padding * 2)) / bounds.width, (Math.max(1, view.height - padding * 2)) / bounds.height)
  return { scale, x: (view.width - bounds.width * scale) / 2 - bounds.x * scale, y: (view.height - bounds.height * scale) / 2 - bounds.y * scale }
}
