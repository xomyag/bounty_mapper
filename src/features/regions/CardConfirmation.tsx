import { localize, t } from '../../i18n'
import { useEffect, useRef } from 'react'
import type { RegionSession, RegionState } from '../../application/regionSession'

export function CardConfirmation({ state, session, label, error }: { state: RegionState; session: RegionSession; label: string; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (state.pendingIntent && dialog.current && !dialog.current.open) dialog.current.showModal() }, [state.pendingIntent])
  return state.pendingIntent && <dialog ref={dialog} className="project-dialog" aria-label={localize(label)} onCancel={(event) => { event.preventDefault(); void session.resolveCardIntent('stay') }}>
    <h2>{t("ui.unsaved.changes.382dd6")}</h2><p>{t("ui.save.the.card.before.continuing")}</p>
    {error && <p role="alert">{localize(error)}</p>}
    <div className="card-actions"><button type="button" disabled={session.busy() || session.detailsSaving()} onClick={() => { void session.resolveCardIntent('save') }}>{t("ui.save.and.continue")}</button><button type="button" disabled={session.busy() || session.detailsSaving()} onClick={() => { void session.resolveCardIntent('discard') }}>{t("ui.discard.changes")}</button><button type="button" disabled={session.busy() || session.detailsSaving()} onClick={() => { void session.resolveCardIntent('stay') }}>{t("ui.continue.editing")}</button></div>
  </dialog>
}
