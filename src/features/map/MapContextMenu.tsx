import { localize, t } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { markerTypes } from '../../domain/marker'
import type { MarkerKind } from '../../domain/marker'
import type { Point } from '../../domain/viewport'
import { markerIcons } from './markerIcons'

export function MapContextMenu({ position, size, disabled, onClose, onRegion, onMarker }: { position: Point; size: { width: number; height: number }; disabled: boolean; onClose: () => void; onRegion: () => void; onMarker: (kind: MarkerKind) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const parent = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const submenuLeft = Math.max(-position.x + 4, position.x + 396 <= size.width ? 194 : -194)
  const submenuTop = Math.max(-position.y + 4, Math.min(38, size.height - position.y - 350))
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [onClose])
  return <div ref={root} className="map-context-menu" role="menu" aria-label={t("ui.map.actions")} style={{ left: position.x, top: position.y }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); document.querySelector<HTMLElement>('[data-map-canvas]')?.focus() }
    if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); setExpanded(false); parent.current?.focus() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const level = (event.target as HTMLElement).closest('[role="menu"]')
      const items = Array.from(level?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? [])
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (items.length) items[(index + items.length + (event.key === 'ArrowDown' ? 1 : -1)) % items.length].focus()
    }
  }}>
    <button type="button" role="menuitem" disabled={disabled} onMouseEnter={() => setExpanded(false)} onClick={onRegion}>{t("ui.add.region")}</button>
    <button ref={parent} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={expanded} disabled={disabled} onMouseEnter={() => setExpanded(true)} onClick={() => setExpanded(true)} onKeyDown={(event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); setExpanded(true); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('.marker-submenu button')?.focus()) }
    }}>{t("ui.add.marker")} <span aria-hidden="true">▸</span></button>
    {expanded && <div className="marker-submenu" role="menu" aria-label={t("ui.marker.type")} style={{ left: submenuLeft, top: submenuTop, maxHeight: Math.max(80, size.height - 8) }}>{Object.entries(markerTypes).map(([kind, type]) => <button key={kind} type="button" role="menuitem" disabled={disabled} onClick={() => onMarker(kind as MarkerKind)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={markerIcons[kind as MarkerKind]} /></svg>{localize(type.label)}</button>)}</div>}
  </div>
}
