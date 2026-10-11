import { useEffect, useRef } from 'react'
import type { RegionSession, RegionState } from '../../application/regionSession'

export function CardConfirmation({ state, session, label, error }: { state: RegionState; session: RegionSession; label: string; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (state.pendingIntent && dialog.current && !dialog.current.open) dialog.current.showModal() }, [state.pendingIntent])
  return state.pendingIntent && <dialog ref={dialog} className="project-dialog" aria-label={label} onCancel={(event) => { event.preventDefault(); void session.resolveCardIntent('stay') }}>
    <h2>Есть несохранённые изменения</h2><p>Сохранить карточку перед продолжением?</p>
    {error && <p role="alert">{error}</p>}
    <div className="card-actions"><button type="button" disabled={session.busy() || session.detailsSaving()} onClick={() => { void session.resolveCardIntent('save') }}>Сохранить и продолжить</button><button type="button" disabled={session.busy() || session.detailsSaving()} onClick={() => { void session.resolveCardIntent('discard') }}>Отбросить изменения</button><button type="button" disabled={session.busy() || session.detailsSaving()} onClick={() => { void session.resolveCardIntent('stay') }}>Продолжить редактирование</button></div>
  </dialog>
}
