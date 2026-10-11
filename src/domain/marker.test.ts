import { describe, expect, it } from 'vitest'
import { markerTypes, statusesOf, statusBadge, validateEntity, validateMarker } from './marker'
import type { MarkerKind } from './marker'
import { emptyDocument } from './richText'
import { markerScreenScale, markerIcons } from '../features/map/markerIcons'

describe('Marker invariants', () => {
  it('has distinct icons and non-color status symbols, with constant screen size under zoom', () => {
    expect(new Set(Object.values(markerIcons)).size).toBe(9)
    for (const kind of Object.keys(markerTypes) as MarkerKind[]) for (const status of Object.keys(statusesOf(kind))) {
      expect(statusBadge(status)).toBeTruthy()
      expect(() => validateEntity({ checks: [], id: 'e', projectId: 'p', kind, status, name: 'Имя', description: emptyDocument(), tags: [] })).not.toThrow()
    }
    for (const scale of [.125, .5, 1, 4, 16]) expect(markerScreenScale(scale) * scale * 40).toBe(40)
  })
  it('rejects nonfinite coordinates, bad tags, unsafe descriptions and statuses incompatible with the type', () => {
    const entity = { checks: [], id: 'e', projectId: 'p', kind: 'door' as const, status: 'open', name: 'Дверь', description: emptyDocument(), tags: [] }
    expect(() => validateEntity({ ...entity, status: 'defeated' })).toThrow()
    expect(() => validateEntity({ ...entity, tags: ['x', 'x'] })).toThrow()
    expect(() => validateEntity({ ...entity, description: { type: 'doc', content: [{ type: 'script' }] } })).toThrow()
    for (const x of [NaN, Infinity, 1e10]) expect(() => validateMarker({ id: 'm', mapId: 'map', entityId: 'e', regionIds: [], x, y: 0, locked: false, color: '#000000', order: 0 })).toThrow()
    expect(() => validateMarker({ id: 'm', mapId: 'map', entityId: 'e', regionIds: ['r', 'r'], x: 0, y: 0, locked: false, color: '#000000', order: 0 })).toThrow()
  })
})
