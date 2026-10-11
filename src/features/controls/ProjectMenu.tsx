import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Menu, FolderOpen, Upload, Download } from 'lucide-react'

export function ProjectMenu({ disabled, importDisabled, exportDisabled, onProjects, onImport, onExport, children }: { disabled: boolean; importDisabled: boolean; exportDisabled: boolean; onProjects: () => void; onImport: () => void; onExport: () => void; children?: ReactNode }) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const act = (callback: () => void) => { panel.current?.hidePopover(); callback() }
  const focusItem = (last = false) => requestAnimationFrame(() => { const items = panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'); (last ? items?.[items.length - 1] : items?.[0])?.focus() })
  return <div className="project-menu">
    <button ref={trigger} type="button" className="icon-button" title="Меню проекта" aria-label="Меню проекта" aria-haspopup="menu" aria-expanded={open} popoverTarget={id} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); panel.current?.showPopover(); focusItem(event.key === 'ArrowUp') } }}><Menu size={20} aria-hidden="true" /></button>
    <div id={id} ref={panel} popover="auto" className="project-menu-popover" role="menu" aria-label="Меню проекта" onToggle={(event) => { setOpen(event.newState === 'open'); if (event.newState === 'open') { const box = trigger.current!.getBoundingClientRect(); panel.current!.style.top = `${box.bottom + 6}px`; panel.current!.style.left = `${box.left}px` } }} onKeyDown={(event) => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }
      if (event.key === 'Escape') { event.preventDefault(); panel.current?.hidePopover(); trigger.current?.focus() }
    }}>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => act(onProjects)}><FolderOpen aria-hidden="true" size={18} />Проекты</button>
      <button type="button" role="menuitem" disabled={importDisabled} onClick={() => act(onImport)}><Upload aria-hidden="true" size={18} />Импорт проекта</button>
      <button type="button" role="menuitem" disabled={exportDisabled} onClick={() => act(onExport)}><Download aria-hidden="true" size={18} />Экспорт проекта</button>
      {children}
    </div>
  </div>
}
