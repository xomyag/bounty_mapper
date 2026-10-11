import { message } from '../i18n/message'
import { validateMarker } from '../domain/marker'
import type { MarkerPlacement } from '../domain/marker'

// IndexedDB 6 / ZIP 5 stored one optional regionId. Keep the old link and
// everything else, removing the legacy field rather than storing two copies.
export function migrateMarkerPlacement(value: unknown): MarkerPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message("ui.invalid.saved.marker.data"))
  const { regionId, ...rest } = value as Record<string, unknown>
  const marker = { ...rest, regionIds: rest.regionIds ?? (regionId === undefined ? [] : [regionId]) } as unknown as MarkerPlacement
  validateMarker(marker)
  return marker
}
