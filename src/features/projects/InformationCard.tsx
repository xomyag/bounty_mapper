import { localize, message, t } from '../../i18n'
import { lazy, Suspense } from 'react'
import type { RegionSession, RegionState } from '../../application/regionSession'
import { documentHasContent } from '../../domain/richText'
import { RichTextView } from '../regions/RichTextView'
import { CardConfirmation } from '../regions/CardConfirmation'
import { prepareCardImage } from '../regions/cardImage'

const RichTextEditor = lazy(() => import('../regions/RichTextEditor').then((module) => ({ default: module.RichTextEditor })))
export function InformationCard({ state, session, disabled, mapName, onCancelCreation }: { state: RegionState; session: RegionSession; disabled: boolean; mapName?: string; onCancelCreation: () => void }) {
  const info = state.information!
  const creating = info.kind === 'new-project'
  const label = info.kind === 'map' ? t("ui.map.description") : t("ui.adventure.context")
  const draft = info.draft
  const editing = !!draft && (creating || session.isPreparation())
  const busy = disabled || session.detailsSaving() || !!state.imagePending
  const assets = { ...info.assets, ...Object.fromEntries((draft?.assets ?? []).map((a) => [a.id, a])) }
  return <section className="region-card" aria-label={localize(label)}>
    <div className="card-heading"><h2>{localize(label)}: {localize(mapName ?? info.name)}</h2><button type="button" aria-label={t("ui.close.value", { p0: label.toLowerCase() })} disabled={busy} onClick={session.closeCard}>×</button></div>
    <p role="status">{localize(draft?.phase === 'saving' ? message("ui.saving") : draft?.phase === 'error' ? message("ui.save.failed") : session.isInformationDirty() ? message("ui.unsaved.changes.382dd6") : editing ? message("ui.editing") : message("ui.saved.on.this.device"))}</p>
    {draft?.error && <p role="alert" className="form-error">{localize(draft.error)}  {t("ui.text.and.images.remain.in.the.draft.retry.saving")}</p>}
    {state.imagePending > 0 && <p role="status">{t("ui.inserting.image")}</p>}
    {state.imageError && <p role="alert" className="form-error">{localize(state.imageError)}</p>}
    {editing ? <fieldset disabled={busy}>
      {info.kind !== 'map' && <label>{t("ui.project.name")}<input aria-label={t("ui.project.name")} value={draft.name} onChange={(event) => session.editInformation({ name: event.target.value })} /></label>}
      <Suspense fallback={<p role="status">{t("ui.preparing.editor")}</p>}><RichTextEditor label={localize(info.kind === 'map' ? message("ui.map.description.text") : message("ui.general.adventure.context"))} value={draft.document} assets={assets} disabled={busy} onChange={(document) => session.editInformation({ document })} insertImage={(file) => prepareCardImage(file, session, session.addInformationDraftAsset)} onError={session.reportImageError} /></Suspense>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveInformation() }}>{t("ui.save")}</button><button type="button" onClick={() => { session.cancelInformationEdit(); if (creating) onCancelCreation() }}>{t("ui.cancel")}</button></div>
    </fieldset> : <>
      {documentHasContent(info.document) ? <RichTextView document={info.document} assets={assets} /> : <p className="form-hint">{localize(info.kind === 'map' ? message("ui.no.map.description.yet") : message("ui.no.adventure.context.yet"))}</p>}
      {session.isPreparation() && <button type="button" disabled={busy} onClick={session.beginInformationEdit}>{localize(documentHasContent(info.document) ? message("ui.edit") : message("ui.fill.in"))}</button>}
    </>}
    <CardConfirmation state={state} session={session} label={t("ui.unsaved.context.changes")} error={draft?.error ?? state.modeError} />
  </section>
}
