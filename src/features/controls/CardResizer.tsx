import { t } from '../../i18n'
import { useRef } from 'react'
import { cardWidthBounds } from '../../application/cardLayoutSession'
import type { CardLayoutSession } from '../../application/cardLayoutSession'

export function CardResizer({ width, viewWidth, session }: { width: number; viewWidth: number; session: CardLayoutSession }) {
  const drag = useRef<{ pointerId: number; startX: number; width: number } | undefined>(undefined)
  const { min, max } = cardWidthBounds(viewWidth)
  const resize = (next: number) => session.resize(Math.min(max, Math.max(min, next)))
  return <div className="card-resizer" role="separator" tabIndex={0} aria-label={t("ui.card.width")} aria-orientation="vertical" aria-controls="object-card" aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(width)} aria-valuetext={t("ui.value.pixels", { p0: Math.round(width) })} title={t("ui.drag.the.edge.adjust.width.home.end.limits")} onPointerDown={(event) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, width }
  }} onPointerMove={(event) => { const current = drag.current; if (!current || current.pointerId !== event.pointerId) return; event.preventDefault(); event.stopPropagation(); resize(current.width + current.startX - event.clientX) }} onPointerUp={(event) => { if (drag.current?.pointerId !== event.pointerId) return; event.preventDefault(); event.stopPropagation(); drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); void session.save() }} onLostPointerCapture={() => { if (drag.current) { drag.current = undefined; void session.save() } }} onKeyDown={(event) => {
    const next = event.key === 'ArrowLeft' ? width + 24 : event.key === 'ArrowRight' ? width - 24 : event.key === 'Home' ? min : event.key === 'End' ? max : undefined
    if (next === undefined) return
    event.preventDefault(); event.stopPropagation(); resize(next); void session.save()
  }} />
}
