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
  const groupOptions: Partial<Record<NavigationGrouping, string>> = tab === 'regions' ? { none: 'Без группировки', map: 'По карте', tag: 'По тегу' } : { none: 'Без группировки', map: 'По карте', type: 'По типу', status: 'По статусу', region: 'По связанной области' }
  const activeFilters = [filters.mapId, filters.type, filters.status, filters.regionId, ...filters.tags].filter(Boolean).length
  return <aside className="navigation-panel" aria-label="Навигация и поиск" hidden={!open} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <div className="card-heading"><h2>Навигация и поиск</h2><button type="button" aria-label="Закрыть навигацию" onClick={onClose}>×</button></div>
    <div className="navigation-tabs" role="tablist" aria-label="Объекты карты" onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'regions' : e.key === 'End' ? 'markers' : tab === 'regions' ? 'markers' : 'regions'; setTab(next); (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLButtonElement)?.focus() } }}>
      {(['regions', 'markers'] as const).map((value) => <button id={`nav-${value}-tab`} aria-controls="navigation-results" key={value} data-tab={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{value === 'regions' ? 'Области' : 'Маркеры'}</button>)}
    </div>
    <section id="navigation-results" role="tabpanel" aria-labelledby={`nav-${tab}-tab`}>
      <label>Поиск<input type="search" aria-label="Поиск объектов" placeholder={tab === 'regions' ? 'Название, номер или тег' : 'Название или тег'} value={filters.query} onChange={(e) => edit({ query: e.target.value })} /></label>
      <label>Область поиска<select aria-label="Область поиска" value={filters.scope} onChange={(e) => edit({ scope: e.target.value as NavigationFilters['scope'] })}><option value="map">Текущая карта</option><option value="project">Весь текущий проект</option></select></label>
      <div className="navigation-filter-actions"><button type="button" aria-expanded={expanded} aria-controls="navigation-filters" onClick={() => setExpanded(!expanded)}>Фильтры и группировка{activeFilters ? ` (${activeFilters})` : ''}{settings.grouping !== 'none' ? ' · Группировка' : ''}</button><button type="button" onClick={() => setOptions((current) => ({ ...current, [tab]: { ...current[tab], filters: defaultFilters() } }))}>Сбросить фильтры</button></div>
      <div id="navigation-filters" hidden={!expanded}>
      <label>Карта<select aria-label="Фильтр по карте" value={filters.mapId} onChange={(e) => edit({ mapId: e.target.value })}><option value="">Все карты</option>{filters.mapId && !data.maps.some((m) => m.id === filters.mapId) && <option value={filters.mapId}>Карта удалена</option>}{data.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      {tab === 'markers' && <>
        <label>Тип<select aria-label="Тип маркера в поиске" value={filters.type} onChange={(e) => { const type = e.target.value as '' | MarkerKind; edit({ type, status: Object.hasOwn(navigationStatuses(type || undefined), filters.status) ? filters.status : '' }) }}><option value="">Все типы</option>{Object.entries(markerTypes).map(([key, type]) => <option key={key} value={key}>{type.label}</option>)}</select></label>
        <label>Статус<select aria-label="Статус маркера в поиске" value={filters.status} onChange={(e) => edit({ status: e.target.value })}><option value="">Все статусы</option>{Object.entries(navigationStatuses(filters.type || undefined)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Связанная область<select aria-label="Связанная область в поиске" value={filters.regionId} onChange={(e) => edit({ regionId: e.target.value })}><option value="">Любая привязка</option><option value="unbound">Без области</option>{filters.regionId && filters.regionId !== 'unbound' && !data.regions.some((r) => r.id === filters.regionId) && <option value={filters.regionId}>Область удалена</option>}{data.regions.map((r) => <option key={r.id} value={r.id}>{r.number}. {r.title} · {data.maps.find((m) => m.id === r.mapId)?.name}</option>)}</select></label>
      </>}
      <fieldset className="navigation-tags"><legend>Теги</legend>
        <label>Совпадение тегов<select aria-label="Логика фильтра тегов" value={filters.tagMatch} onChange={(e) => edit({ tagMatch: e.target.value as 'any' | 'all' })}><option value="any">Любой из выбранных</option><option value="all">Все выбранные</option></select></label>
        <div className="navigation-tag-options">{allTags.map((tag) => <label key={normalizeSearch(tag)}><input type="checkbox" aria-label={`Фильтр по тегу «${tag}»`} checked={filters.tags.some((t) => normalizeSearch(t) === normalizeSearch(tag))} onChange={(e) => edit({ tags: e.target.checked ? [...filters.tags, tag] : filters.tags.filter((t) => normalizeSearch(t) !== normalizeSearch(tag)) })} />{tag}</label>)}</div>
        {!allTags.length && <p>У объектов пока нет тегов</p>}
      </fieldset>
      <label>Группировка<select aria-label="Группировка результатов" value={settings.grouping} onChange={(e) => setOptions((current) => ({ ...current, [tab]: { ...current[tab], grouping: e.target.value as NavigationGrouping } }))}>{Object.entries(groupOptions).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
      </div>
      {loading && <p role="status">Чтение объектов проекта…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" disabled={loading || disabled} onClick={onRetry}>Повторить чтение навигации</button></div>}
      <p role="status">Найдено: {results.length}</p>
      {settings.grouping === 'region' && <p className="form-hint">Маркер может быть в нескольких группах; количество считает уникальные размещения.</p>}
      {!results.length && !loading && <p>Ничего не найдено. Измените поиск или сбросьте фильтры.</p>}
      {groups.map((group) => <section className="navigation-group" aria-label={group.title || 'Результаты поиска'} key={group.key}>{group.title && <h3>{group.title}</h3>}<ul>{group.results.map((item) => <li key={item.id}><button type="button" data-object-id={item.id} disabled={disabled || loading} onClick={() => onNavigate({ mapId: item.mapId, kind: item.kind, id: item.id })}><strong>{item.title}</strong><span>{data.maps.find((m) => m.id === item.mapId)?.name}{item.entity ? ` · ${markerTypes[item.entity.kind].label} · ${resultStatus(item)}` : ''}</span>{item.tags.length > 0 && <small>{item.tags.join(', ')}</small>}</button></li>)}</ul></section>)}
    </section>
  </aside>
}
