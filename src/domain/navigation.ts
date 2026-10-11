import { message } from '../i18n/message'
import type { Map } from './project'
import type { Region } from './region'
import { markerTypes, statusLabel, statusesOf } from './marker'
import type { Entity, MarkerKind, MarkerPlacement } from './marker'

export interface NavigationData { maps: Map[]; regions: Region[]; entities: Entity[]; markers: MarkerPlacement[]; tagHistory?: string[] }
export type NavigationTab = 'regions' | 'markers'
export type NavigationTarget = { mapId: string } | { mapId: string; kind: 'region' | 'marker'; id: string }
export interface NavigationFilters { query: string; scope: 'map' | 'project'; mapId: string; tags: string[]; tagMatch: 'any' | 'all'; type: '' | MarkerKind; status: string; regionId: string }
export type NavigationGrouping = 'none' | 'map' | 'tag' | 'type' | 'status' | 'region'
export interface NavigationResult { id: string; mapId: string; kind: 'region' | 'marker'; title: string; tags: string[]; region?: Region; marker?: MarkerPlacement; entity?: Entity }
export interface NavigationGroup { key: string; title: string; results: NavigationResult[] }
export const emptyNavigationData = (): NavigationData => ({ maps: [], regions: [], entities: [], markers: [] })
export const defaultFilters = (): NavigationFilters => ({ query: '', scope: 'map', mapId: '', tags: [], tagMatch: 'any', type: '', status: '', regionId: '' })
export const normalizeSearch = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru').trim()
export function filterNavigation(data: NavigationData, tab: NavigationTab, filters: NavigationFilters, currentMapId?: string): NavigationResult[] {
  const entities = new globalThis.Map(data.entities.map((e) => [e.id, e]))
  const candidates: NavigationResult[] = tab === 'regions' ? data.regions.map((r) => ({ id: r.id, mapId: r.mapId, kind: 'region', title: `${r.number}. ${r.title}`, tags: r.tags, region: r })) : data.markers.flatMap((m) => {
    const entity = entities.get(m.entityId)
    return entity ? [{ id: m.id, mapId: m.mapId, kind: 'marker' as const, title: entity.name, tags: entity.tags, marker: m, entity }] : []
  })
  const query = normalizeSearch(filters.query)
  const tags = filters.tags.map(normalizeSearch)
  return candidates.filter((item) => {
    if (filters.scope === 'map' && item.mapId !== currentMapId || filters.mapId && item.mapId !== filters.mapId) return false
    if (query && ![item.title, ...item.tags].some((text) => normalizeSearch(text).includes(query))) return false
    const matchesTag = (tag: string) => item.tags.some((t) => normalizeSearch(t) === tag)
    if (tags.length && !(filters.tagMatch === 'all' ? tags.every(matchesTag) : tags.some(matchesTag))) return false
    if (item.marker && (filters.type && item.entity!.kind !== filters.type || filters.status && item.entity!.status !== filters.status || filters.regionId && (filters.regionId === 'unbound' ? item.marker.regionIds.length !== 0 : !item.marker.regionIds.includes(filters.regionId)))) return false
    return true
  }).sort((a, b) => a.mapId.localeCompare(b.mapId) || (a.region && b.region ? a.region.number - b.region.number : a.title.localeCompare(b.title, 'ru')) || a.id.localeCompare(b.id))
}
export function groupNavigation(results: NavigationResult[], grouping: NavigationGrouping, data: NavigationData): NavigationGroup[] {
  if (grouping === 'none') return [{ key: 'all', title: '', results }]
  const groups = new globalThis.Map<string, NavigationGroup>()
  const mapName = (id: string) => data.maps.find((m) => m.id === id)?.name ?? message("ui.map")
  for (const item of results) {
    let keys: { key: string; title: string }[]
    if (grouping === 'map') keys = [{ key: item.mapId, title: mapName(item.mapId) }]
    else if (grouping === 'tag') keys = item.tags.length ? item.tags.map((t) => ({ key: `tag:${normalizeSearch(t)}`, title: t })) : [{ key: 'untagged', title: message("ui.no.tags.1bbe13") }]
    else if (grouping === 'type') keys = [{ key: item.entity!.kind, title: markerTypes[item.entity!.kind].label }]
    else if (grouping === 'status') keys = [{ key: item.entity!.status, title: navigationStatuses()[item.entity!.status] }]
    else keys = item.marker!.regionIds.length ? item.marker!.regionIds.map((id) => { const r = data.regions.find((r) => r.id === id)!; return { key: id, title: `${r.number}. ${r.title} · ${mapName(r.mapId)}` } }) : [{ key: 'unbound', title: message("ui.no.region") }]
    for (const { key, title } of keys) {
      const group = groups.get(key) ?? { key, title, results: [] }
      if (!group.results.some((r) => r.id === item.id)) group.results.push(item)
      groups.set(key, group)
    }
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}
export function navigationStatuses(kind?: MarkerKind): Record<string, string> {
  if (kind) return statusesOf(kind)
  const labels: Record<string, Set<string>> = {}
  for (const type of Object.keys(markerTypes) as MarkerKind[]) for (const [value, label] of Object.entries(statusesOf(type))) (labels[value] ??= new Set()).add(label)
  return Object.fromEntries(Object.entries(labels).map(([value, label]) => [value, [...label].join(' / ')]))
}
export const resultStatus = (item: NavigationResult) => item.entity ? statusLabel(item.entity) : ''
