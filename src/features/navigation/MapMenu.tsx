import { localize, message, t } from '../../i18n'
import { useEffect, useId, useRef, useState } from 'react'
import type { Map } from '../../domain/project'
import { Plus, Check, Pencil, Trash2, ImagePlus, ChevronDown, Map as MapIcon } from 'lucide-react'

export type MapAction = { kind: 'create' } | { kind: 'rename' | 'delete'; map: Map }

export function MapMenu({ maps, currentMapId, disabled, writesDisabled, playing = false, onNavigate, onAction, imageDisabled, hasImage, onUpload, onRemoveImage }: { maps: Map[]; currentMapId?: string; disabled: boolean; writesDisabled: boolean; playing?: boolean; onNavigate: (mapId: string) => void; onAction: (action: MapAction) => void; imageDisabled: boolean; hasImage: boolean; onUpload: () => void; onRemoveImage: () => void }) {
  const id = useId()
  const popover = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = () => popover.current?.hidePopover()
  const action = (value: MapAction) => { close(); onAction(value) }
  return <div className="map-menu">
    <button ref={trigger} type="button" className="map-menu-trigger" aria-label={t("ui.project.maps")} aria-haspopup="menu" aria-expanded={open} popoverTarget={id} disabled={disabled} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); popover.current?.showPopover(); requestAnimationFrame(() => { const items = popover.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'); (event.key === 'ArrowUp' ? items?.[items.length - 1] : items?.[0])?.focus() }) }
    }}><span>{localize(maps.find((map) => map.id === currentMapId)?.name ?? message("ui.no.map"))}</span><ChevronDown size={16} aria-hidden="true" /></button>
    <div ref={popover} id={id} popover="auto" role="menu" aria-label={t("ui.project.maps")} className="map-menu-popover" onToggle={(event) => { setOpen(event.newState === 'open'); if (event.newState === 'open') { const box = trigger.current!.getBoundingClientRect(); const panel = popover.current!; panel.style.top = `${box.bottom + 6}px`; panel.style.right = `${Math.max(8, window.innerWidth - box.right)}px` } }} onKeyDown={(event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus() }
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current?.focus() }
    }}>
      <button type="button" role="menuitem" disabled={writesDisabled} onClick={() => action({ kind: 'create' })}><Plus size={18} aria-hidden="true" />{t('ui.new.map')}</button>
      <ul role="none">{maps.map((map) => <li key={map.id} role="none" className="map-menu-row" data-map-id={map.id}>
        <button type="button" role="menuitem" aria-current={map.id === currentMapId ? 'page' : undefined} aria-label={t("ui.go.to.map.value", { p0: map.name })} disabled={disabled} onClick={() => { close(); onNavigate(map.id) }}>{map.id === currentMapId ? <Check size={18} aria-hidden="true" /> : <MapIcon size={18} aria-hidden="true" />}{map.name}</button>
        <button type="button" role="menuitem" aria-label={t("ui.rename.map.value", { p0: map.name })} disabled={writesDisabled} onClick={() => action({ kind: 'rename', map })}><Pencil size={16} aria-hidden="true" />{t("ui.rename")}</button>
        <button type="button" role="menuitem" aria-label={t("ui.delete.map.value", { p0: map.name })} disabled={writesDisabled} onClick={() => action({ kind: 'delete', map })}><Trash2 size={16} aria-hidden="true" />{t("ui.delete")}</button>
      </li>)}</ul>
      <section className="map-image-actions" aria-label={t("ui.current.map.image")}><p>{t("ui.image.3103e4")} {localize(maps.find((map) => map.id === currentMapId)?.name ?? message("ui.first.map"))}</p>
        <button type="button" role="menuitem" disabled={imageDisabled} onClick={() => { close(); onUpload() }}><ImagePlus size={18} aria-hidden="true" />{localize(hasImage ? message("ui.replace.image") : message("ui.upload.map"))}</button>
        {hasImage && <button type="button" role="menuitem" disabled={imageDisabled} onClick={() => { close(); onRemoveImage() }}><Trash2 size={18} aria-hidden="true" />{t("ui.remove.image")}</button>}
      </section>
      {writesDisabled && <p className="form-hint">{localize(playing ? message("ui.map.changes.are.available.in.preparation.you.can.switch") : message("ui.to.change.maps.save.or.discard.card.changes.and"))}</p>}
    </div>
  </div>
}

export function MapActionDialog({ action, disabled, onSubmit, onClose }: { action: MapAction; disabled: boolean; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(action.kind === 'rename' ? action.map.name : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blocked = disabled || busy
  const title = action.kind === 'create' ? message("ui.new.map") : action.kind === 'rename' ? message("ui.rename.map") : message("ui.delete.map")
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="project-dialog" aria-label={localize(title)} onCancel={(event) => { if (blocked) event.preventDefault(); else onClose() }}>
    <h2>{localize(title)}</h2>
    {action.kind === 'delete' && <p>{t('map.deleteConfirm', { name: action.map.name })}</p>}
    <form onSubmit={(event) => { event.preventDefault(); if (blocked) return; setBusy(true); setError(''); void onSubmit(name).then(onClose).catch((error: unknown) => setError(error instanceof Error ? error.message : message("ui.could.not.change.the.map"))).finally(() => setBusy(false)) }}>
      {action.kind !== 'delete' && <label>{localize(action.kind === 'create' ? message("ui.new.map.name") : message("ui.new.map.name.8dfb3b"))}<input autoFocus aria-label={localize(action.kind === 'create' ? message("ui.new.map.name") : message("ui.new.map.name.8dfb3b"))} maxLength={512} value={name} disabled={blocked} onChange={(event) => setName(event.target.value)} /></label>}
      {error && <p role="alert" className="form-error">{localize(error)}  {t("ui.changes.were.not.saved")}</p>}
      {busy && <p role="status">{localize(action.kind === 'delete' ? message("ui.deleting.map") : message("ui.saving.map"))}</p>}
      <div className="card-actions"><button type="submit" disabled={blocked || (action.kind !== 'delete' && !name.trim())}>{localize(action.kind === 'create' ? message("ui.create.map") : action.kind === 'rename' ? message("ui.rename.map.89b030") : message("ui.delete.map.52a00e"))}</button><button type="button" autoFocus={action.kind === 'delete'} disabled={blocked} onClick={onClose}>{t("ui.cancel")}</button></div>
    </form>
  </dialog>
}
