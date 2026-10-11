import { legacyContextDocument } from '../storage/migrateProjectContext'
import { describe, expect, it } from 'vitest'
import { defaultFilters, filterNavigation, groupNavigation, navigationStatuses } from './navigation'
import type { NavigationData } from './navigation'
import { emptyRegionContent } from './region'
import { emptyDocument } from './richText'

const data: NavigationData = {
  maps: ['a', 'b'].map((id) => ({ id, projectId: 'project', name: `Карта ${id}`, description: legacyContextDocument(''), order: 0, coordinateBounds: { x: 0, y: 0, width: 100, height: 100 } })),
  regions: [
    { ...emptyRegionContent(), id: 'r1', mapId: 'a', number: 12, title: 'Башня', titleCustomized: true, tags: ['Тайна', 'Север'], color: '#ffffff', fillOpacity: .4, order: 0, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
    { ...emptyRegionContent(), id: 'r2', mapId: 'b', number: 8, title: 'Подвал', titleCustomized: true, tags: ['тайна'], color: '#ffffff', fillOpacity: .4, order: 0, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
    { ...emptyRegionContent(), id: 'r3', mapId: 'a', number: 3, title: 'Двор', titleCustomized: true, tags: [], color: '#ffffff', fillOpacity: .4, order: 1, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
  ],
  entities: [
    { checks: [], id: 'e1', projectId: 'project', kind: 'enemy', name: 'Страж башни', tags: ['тайна', 'Север'], status: 'hidden', description: emptyDocument() },
    { checks: [], id: 'e2', projectId: 'project', kind: 'enemy', name: 'Страж ворот', tags: ['север'], status: 'alive', description: emptyDocument() },
    { checks: [], id: 'e3', projectId: 'project', kind: 'door', name: 'Ворота', tags: ['Тайна'], status: 'hidden', description: emptyDocument() },
  ],
  markers: [
    { id: 'm1', entityId: 'e1', mapId: 'a', x: 10, y: 10, regionIds: ['r1', 'r3'], color: '#ffffff', locked: false, order: 0 },
    { id: 'm2', entityId: 'e2', mapId: 'b', x: 10, y: 10, regionIds: [], color: '#ffffff', locked: false, order: 0 },
    { id: 'm3', entityId: 'e3', mapId: 'a', x: 10, y: 10, regionIds: ['r3'], color: '#ffffff', locked: false, order: 1 },
  ],
}
describe('Navigation search, intersecting filters and groups', () => {
  it('searches title, region number and tags case-insensitively with map/project scope', () => {
    for (const query of ['БАШНЯ', '12', ' сЕвЕр ']) expect(filterNavigation(data, 'regions', { ...defaultFilters(), query }, 'a').map((r) => r.id)).toEqual(['r1'])
    expect(filterNavigation(data, 'regions', { ...defaultFilters(), query: 'тайна' }, 'a')).toHaveLength(1)
    expect(filterNavigation(data, 'regions', { ...defaultFilters(), scope: 'project', query: 'ТАЙНА' }, 'a')).toHaveLength(2)
    expect(filterNavigation(data, 'markers', { ...defaultFilters(), scope: 'project', query: 'СтРаЖ' }, 'a')).toHaveLength(2)
    expect(filterNavigation(data, 'markers', { ...defaultFilters(), query: 'сЕВЕР' }, 'a')).toHaveLength(1)
  })
  it('combines map, kind, status, tags and region without automatically choosing an overlap', () => {
    const filters = { ...defaultFilters(), scope: 'project' as const, mapId: 'a', type: 'enemy' as const, status: 'hidden', tags: ['ТАЙНА', 'север'], tagMatch: 'all' as const, regionId: 'r3' }
    expect(filterNavigation(data, 'markers', filters, 'b').map((r) => r.id)).toEqual(['m1'])
    for (const change of [{ mapId: 'b' }, { type: 'boss' as const }, { status: 'alive' }, { tags: ['нет'] }, { regionId: 'r2' }]) expect(filterNavigation(data, 'markers', { ...filters, ...change }, 'a')).toEqual([])
    expect(filterNavigation(data, 'markers', { ...defaultFilters(), scope: 'project', regionId: 'unbound' }, 'a').map((r) => r.id)).toEqual(['m2'])
  })
  it('explicit any/all logic also applies to region tags and never mutates data', () => {
    const before = structuredClone(data)
    const filters = { ...defaultFilters(), scope: 'project' as const, tags: ['тайна', 'СЕВЕР'] }
    expect(filterNavigation(data, 'regions', filters, 'a')).toHaveLength(2)
    expect(filterNavigation(data, 'regions', { ...filters, tagMatch: 'all' }, 'a')).toHaveLength(1)
    for (const grouping of ['none', 'map', 'tag'] as const) groupNavigation(filterNavigation(data, 'regions', filters, 'a'), grouping, data)
    expect(data).toEqual(before)
  })
  it('groups a multi-bound placement twice while keeping one unique result and the same object identity', () => {
    const results = filterNavigation(data, 'markers', { ...defaultFilters(), scope: 'project' }, 'a')
    const groups = groupNavigation(results, 'region', data)
    expect(results).toHaveLength(3)
    expect(groups.find((g) => g.key === 'unbound')?.results.map((r) => r.id)).toEqual(['m2'])
    const copies = groups.flatMap((g) => g.results).filter((r) => r.id === 'm1')
    expect(copies).toHaveLength(2); expect(copies[0]).toBe(copies[1])
    expect(new Set(groups.flatMap((g) => g.results.map((r) => r.id))).size).toBe(3)
  })
  it('groups by map/type/status and tags, retaining an untagged group and shared status labels', () => {
    const markers = filterNavigation(data, 'markers', { ...defaultFilters(), scope: 'project' }, 'a')
    expect(groupNavigation(markers, 'map', data)).toHaveLength(2)
    expect(groupNavigation(markers, 'type', data).find((g) => g.key === 'enemy')?.results).toHaveLength(2)
    expect(groupNavigation(markers, 'status', data).find((g) => g.key === 'hidden')?.results).toHaveLength(2)
    const regions = filterNavigation(data, 'regions', { ...defaultFilters(), scope: 'project' }, 'a')
    expect(groupNavigation(regions, 'tag', data).find((g) => g.key === 'tag:тайна')?.results).toHaveLength(2)
    expect(groupNavigation(regions, 'tag', data).find((g) => g.title === 'Без тегов')?.results).toHaveLength(1)
    expect(navigationStatuses('door')).toEqual({ open: 'Открыта', locked: 'Заперта', hidden: 'Скрыта' })
    expect(navigationStatuses().hidden).toContain('Скрыт')
  })
})
