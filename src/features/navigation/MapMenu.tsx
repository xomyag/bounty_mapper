import { useEffect, useId, useRef, useState } from 'react'
import type { Map } from '../../domain/project'

export type MapAction = { kind: 'create' } | { kind: 'rename' | 'delete'; map: Map }

export function MapMenu({ maps, currentMapId, disabled, writesDisabled, playing = false, onNavigate, onAction }: { maps: Map[]; currentMapId?: string; disabled: boolean; writesDisabled: boolean; playing?: boolean; onNavigate: (mapId: string) => void; onAction: (action: MapAction) => void }) {
  const id = useId()
  const popover = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = () => popover.current?.hidePopover()
  const action = (value: MapAction) => { close(); onAction(value) }
  return <div className="map-menu">
    <button ref={trigger} type="button" className="map-menu-trigger" aria-label="Карты проекта" aria-haspopup="menu" aria-expanded={open} popoverTarget={id} disabled={disabled} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); popover.current?.showPopover(); requestAnimationFrame(() => { const items = popover.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'); (event.key === 'ArrowUp' ? items?.[items.length - 1] : items?.[0])?.focus() }) }
    }}>{maps.find((map) => map.id === currentMapId)?.name ?? 'Нет карты'} <span aria-hidden="true">▾</span></button>
    <div ref={popover} id={id} popover="auto" role="menu" aria-label="Карты проекта" className="map-menu-popover" onToggle={(event) => { setOpen(event.newState === 'open'); if (event.newState === 'open') { const box = trigger.current!.getBoundingClientRect(); const panel = popover.current!; panel.style.top = `${box.bottom + 6}px`; panel.style.right = `${Math.max(8, window.innerWidth - box.right)}px` } }} onKeyDown={(event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus() }
      if (event.key === 'Escape') { event.preventDefault(); close(); trigger.current?.focus() }
    }}>
      <button type="button" role="menuitem" disabled={writesDisabled} onClick={() => action({ kind: 'create' })}>New map</button>
      <ul role="none">{maps.map((map) => <li key={map.id} role="none" className="map-menu-row" data-map-id={map.id}>
        <button type="button" role="menuitem" aria-current={map.id === currentMapId ? 'page' : undefined} aria-label={`Перейти на карту «${map.name}»`} disabled={disabled} onClick={() => { close(); onNavigate(map.id) }}><span aria-hidden="true">{map.id === currentMapId ? '✓ ' : ''}</span>{map.name}</button>
        <button type="button" role="menuitem" aria-label={`Переименовать карту «${map.name}»`} disabled={writesDisabled} onClick={() => action({ kind: 'rename', map })}>Переименовать</button>
        <button type="button" role="menuitem" aria-label={`Удалить карту «${map.name}»`} disabled={writesDisabled} onClick={() => action({ kind: 'delete', map })}>Удалить</button>
      </li>)}</ul>
      {writesDisabled && <p className="form-hint">{playing ? 'Изменение карт доступно в режиме «Подготовка». Переключение карт доступно в игре.' : 'Для изменения карт сохраните или отмените правки карточки и завершите текущую операцию.'}</p>}
    </div>
  </div>
}

export function MapActionDialog({ action, disabled, onSubmit, onClose }: { action: MapAction; disabled: boolean; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(action.kind === 'rename' ? action.map.name : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const blocked = disabled || busy
  const title = action.kind === 'create' ? 'Новая карта' : action.kind === 'rename' ? 'Переименование карты' : 'Удаление карты'
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="project-dialog" aria-label={title} onCancel={(event) => { if (blocked) event.preventDefault(); else onClose() }}>
    <h2>{title}</h2>
    {action.kind === 'delete' && <p>Удалить карту «{action.map.name}»? Её области, размещения маркеров и неиспользуемые изображения будут удалены. Сущности и изображения других карт и карточек сохранятся. Это действие нельзя отменить.</p>}
    <form onSubmit={(event) => { event.preventDefault(); if (blocked) return; setBusy(true); setError(''); void onSubmit(name).then(onClose).catch((error: unknown) => setError(error instanceof Error ? error.message : 'Не удалось изменить карту.')).finally(() => setBusy(false)) }}>
      {action.kind !== 'delete' && <label>{action.kind === 'create' ? 'Название новой карты' : 'Новое название карты'}<input autoFocus aria-label={action.kind === 'create' ? 'Название новой карты' : 'Новое название карты'} maxLength={512} value={name} disabled={blocked} onChange={(event) => setName(event.target.value)} /></label>}
      {error && <p role="alert" className="form-error">{error} Изменения не записаны.</p>}
      {busy && <p role="status">{action.kind === 'delete' ? 'Удаление карты…' : 'Сохранение карты…'}</p>}
      <div className="card-actions"><button type="submit" disabled={blocked || (action.kind !== 'delete' && !name.trim())}>{action.kind === 'create' ? 'Создать карту' : action.kind === 'rename' ? 'Переименовать карту' : 'Удалить карту'}</button><button type="button" autoFocus={action.kind === 'delete'} disabled={blocked} onClick={onClose}>Отмена</button></div>
    </form>
  </dialog>
}
