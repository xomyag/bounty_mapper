import { localize, message, t } from '../../i18n'
import { useState } from 'react'
import { defaultFilters, filterNavigation, groupNavigation, navigationStatuses, normalizeSearch, resultStatus } from '../../domain/navigation'
import type { NavigationData, NavigationFilters, NavigationGrouping, NavigationTab, NavigationTarget } from '../../domain/navigation'
import { markerTypes } from '../../domain/marker'
import type { MarkerKind } from '../../domain/marker'

interface Props {
  open: boolean; data: NavigationData; currentMapId?: string; loading: boolean; error?: string; disabled: boolean
  onClose: () => void; onNavigate: (target: NavigationTarget) => void; onRetry: () => void
}
interface TabOptions { filters: NavigationFilters; grouping: NavigationGrouping }
export function NavigationPanel({ open, data, currentMapId, loading, error, disabled, onClose, onNavigate, onRetry }: Props) {
  const [tab, setTab] = useState<NavigationTab>('regions')
  const [options, setOptions] = useState<Record<NavigationTab, TabOptions>>(() => ({ regions: { filters: defaultFilters(), grouping: 'none' }, markers: { filters: defaultFilters(), grouping: 'none' } }))
  const [expanded, setExpanded] = useState(false)
  const settings = options[tab]; const filters = settings.filters
  const edit = (change: Partial<NavigationFilters>) => setOptions((current) => ({ ...current, [tab]: { ...current[tab], filters: { ...current[tab].filters, ...change } } }))
  const results = filterNavigation(data, tab, filters, currentMapId)
  const groups = groupNavigation(results, settings.grouping, data)
  const allTags = [...new Map([...(tab === 'regions' ? data.regions.flatMap((r) => r.tags) : data.entities.flatMap((e) => e.tags)), ...filters.tags].map((t) => [normalizeSearch(t), t])).values()].sort((a, b) => a.localeCompare(b, 'ru'))
  const groupOptions: Partial<Record<NavigationGrouping, string>> = tab === 'regions' ? { none: message("ui.no.grouping"), map: message("ui.by.map"), tag: message("ui.by.tag") } : { none: message("ui.no.grouping"), map: message("ui.by.map"), type: message("ui.by.type"), status: message("ui.by.status"), region: message("ui.by.linked.region") }
  const activeFilters = [filters.mapId, filters.type, filters.status, filters.regionId, ...filters.tags].filter(Boolean).length
  return <aside className="navigation-panel" aria-label={t("ui.navigation.and.search")} hidden={!open} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <div className="card-heading"><h2>{t("ui.navigation.and.search")}</h2><button type="button" aria-label={t("ui.close.navigation")} onClick={onClose}>×</button></div>
    <div className="navigation-tabs" role="tablist" aria-label={t("ui.map.objects")} onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'regions' : e.key === 'End' ? 'markers' : tab === 'regions' ? 'markers' : 'regions'; setTab(next); (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLButtonElement)?.focus() } }}>
      {(['regions', 'markers'] as const).map((value) => <button id={`nav-${value}-tab`} aria-controls="navigation-results" key={value} data-tab={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{localize(value === 'regions' ? message("ui.regions") : message("ui.markers"))}</button>)}
    </div>
    <section id="navigation-results" role="tabpanel" aria-labelledby={`nav-${tab}-tab`}>
      <label>{t("ui.search")}<input data-navigation-search type="search" aria-label={t("ui.search.objects")} placeholder={localize(tab === 'regions' ? message("ui.name.number.or.tag") : message("ui.name.or.tag"))} value={filters.query} onChange={(e) => edit({ query: e.target.value })} /></label>
      <label>{t("ui.search.scope")}<select aria-label={t("ui.search.scope")} value={filters.scope} onChange={(e) => edit({ scope: e.target.value as NavigationFilters['scope'] })}><option value="map">{t("ui.current.map")}</option><option value="project">{t("ui.entire.current.project")}</option></select></label>
      <div className="navigation-filter-actions"><button type="button" aria-expanded={expanded} aria-controls="navigation-filters" onClick={() => setExpanded(!expanded)}>{t("ui.filters.and.grouping")}{localize(activeFilters ? ` (${activeFilters})` : '')}{localize(settings.grouping !== 'none' ? message("ui.grouping") : '')}</button><button type="button" onClick={() => setOptions((current) => ({ ...current, [tab]: { ...current[tab], filters: defaultFilters() } }))}>{t("ui.reset.filters")}</button></div>
      <div id="navigation-filters" hidden={!expanded}>
      <label>{t("ui.map")}<select aria-label={t("ui.filter.by.map")} value={filters.mapId} onChange={(e) => edit({ mapId: e.target.value })}><option value="">{t("ui.all.maps")}</option>{filters.mapId && !data.maps.some((m) => m.id === filters.mapId) && <option value={filters.mapId}>{t("ui.deleted.map")}</option>}{data.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      {tab === 'markers' && <>
        <label>{t("ui.type")}<select aria-label={t("ui.marker.type.in.search")} value={filters.type} onChange={(e) => { const type = e.target.value as '' | MarkerKind; edit({ type, status: Object.hasOwn(navigationStatuses(type || undefined), filters.status) ? filters.status : '' }) }}><option value="">{t("ui.all.types")}</option>{Object.entries(markerTypes).map(([key, type]) => <option key={key} value={key}>{localize(type.label)}</option>)}</select></label>
        <label>{t("ui.status")}<select aria-label={t("ui.marker.status.in.search")} value={filters.status} onChange={(e) => edit({ status: e.target.value })}><option value="">{t("ui.all.statuses")}</option>{Object.entries(navigationStatuses(filters.type || undefined)).map(([key, label]) => <option key={key} value={key}>{localize(label)}</option>)}</select></label>
        <label>{t("ui.linked.region")}<select aria-label={t("ui.linked.region.in.search")} value={filters.regionId} onChange={(e) => edit({ regionId: e.target.value })}><option value="">{t("ui.any.binding")}</option><option value="unbound">{t("ui.no.region")}</option>{filters.regionId && filters.regionId !== 'unbound' && !data.regions.some((r) => r.id === filters.regionId) && <option value={filters.regionId}>{t("ui.deleted.region")}</option>}{data.regions.map((r) => <option key={r.id} value={r.id}>{r.number}. {r.title} · {localize(data.maps.find((m) => m.id === r.mapId)?.name)}</option>)}</select></label>
      </>}
      <fieldset className="navigation-tags"><legend>{t("ui.tags")}</legend>
        <label>{t("ui.tag.matching")}<select aria-label={t("ui.tag.filter.logic")} value={filters.tagMatch} onChange={(e) => edit({ tagMatch: e.target.value as 'any' | 'all' })}><option value="any">{t("ui.any.selected.tag")}</option><option value="all">{t("ui.all.selected.tags")}</option></select></label>
        <div className="navigation-tag-options">{allTags.map((tag) => <label key={normalizeSearch(tag)}><input type="checkbox" aria-label={t("ui.filter.by.tag.value", { p0: tag })} checked={filters.tags.some((t) => normalizeSearch(t) === normalizeSearch(tag))} onChange={(e) => edit({ tags: e.target.checked ? [...filters.tags, tag] : filters.tags.filter((t) => normalizeSearch(t) !== normalizeSearch(tag)) })} />{tag}</label>)}</div>
        {!allTags.length && <p>{t("ui.objects.have.no.tags.yet")}</p>}
      </fieldset>
      <label>{t("ui.grouping.a97550")}<select aria-label={t("ui.result.grouping")} value={settings.grouping} onChange={(e) => setOptions((current) => ({ ...current, [tab]: { ...current[tab], grouping: e.target.value as NavigationGrouping } }))}>{Object.entries(groupOptions).map(([key, title]) => <option key={key} value={key}>{localize(title)}</option>)}</select></label>
      </div>
      {loading && <p role="status">{t("ui.reading.project.objects")}</p>}
      {error && <div role="alert"><p>{localize(error)}</p><button type="button" disabled={loading || disabled} onClick={onRetry}>{t("ui.retry.reading.navigation")}</button></div>}
      <p role="status">{t('counts.results', { count: results.length })}</p>
      {settings.grouping === 'region' && <p className="form-hint">{t("ui.a.marker.can.appear.in.multiple.groups.the.count")}</p>}
      {!results.length && !loading && <p>{t("ui.no.results.change.your.search.or.reset.the.filters")}</p>}
      {groups.map((group) => <section className="navigation-group" aria-label={localize(group.title || message("ui.search.results"))} key={group.key}>{group.title && <h3>{localize(group.title)}</h3>}<ul>{group.results.map((item) => <li key={item.id}><button type="button" data-object-id={item.id} disabled={disabled || loading} onClick={() => onNavigate({ mapId: item.mapId, kind: item.kind, id: item.id })}><strong>{item.title}</strong><span>{localize(data.maps.find((m) => m.id === item.mapId)?.name)}{localize(item.entity ? ` · ${markerTypes[item.entity.kind].label} · ${resultStatus(item)}` : '')}</span>{item.tags.length > 0 && <small>{item.tags.join(', ')}</small>}</button></li>)}</ul></section>)}
    </section>
  </aside>
}
