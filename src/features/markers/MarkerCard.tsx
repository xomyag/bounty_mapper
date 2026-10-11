import { localize, message, t } from '../../i18n'
import { lazy, Suspense } from 'react'
import { markerDetailsOf } from '../../application/regionSession'
import type { RegionSession, RegionState, MarkerDetails } from '../../application/regionSession'
import type { Entity, MarkerPlacement } from '../../domain/marker'
import { markerTypes, statusesOf, statusLabel, statusBadge, trapCheckProblem } from '../../domain/marker'
import { RichTextView } from '../regions/RichTextView'
import { CardConfirmation } from '../regions/CardConfirmation'
import { prepareCardImage } from '../regions/cardImage'
import { ColorPicker } from '../map/ColorPicker'
import { TagsInput } from '../tags/TagsInput'
import { documentHasContent } from '../../domain/richText'

const RichTextEditor = lazy(() => import('../regions/RichTextEditor').then((module) => ({ default: module.RichTextEditor })))

export function MarkerCard({ entity, marker, state, session, disabled, geometryDisabled, tagCatalog = [] }: { entity: Entity; marker: MarkerPlacement; state: RegionState; session: RegionSession; disabled: boolean; geometryDisabled: boolean; tagCatalog?: string[] }) {
  const draft = state.markerDraft
  const fields = draft?.fields ?? markerDetailsOf(entity, marker)
  const assets = { ...state.assets, ...Object.fromEntries((draft?.assets ?? []).map((a) => [a.id, a])) }
  const playing = state.mode === 'play'
  const readOnly = !session.canEditProject()
  const editing = !playing && !readOnly && state.cardMode === 'edit'
  const statusAction = state.statusAction?.entityId === entity.id ? state.statusAction : undefined
  const busy = disabled || session.detailsSaving() || !!state.imagePending
  const edit = (change: Partial<MarkerDetails>) => session.editMarkerDetails(change)
  const linkedRegions = state.regions.filter((r) => fields.regionIds.includes(r.id))
  return <section className="region-card marker-card" aria-label={t("ui.marker.card")}>
    <div className="card-heading"><h2>{entity.name}</h2><button type="button" disabled={busy} aria-label={t("ui.close.marker.card")} onClick={session.closeCard}>×</button></div>
    <p className="marker-kind">{localize(markerTypes[entity.kind].label)}</p>
    <p role="status" className="card-status">{localize(statusAction?.phase === 'saving' ? message("ui.saving.status") : statusAction?.phase === 'error' ? message("ui.status.save.failed.saved.data.is.shown") : draft?.phase === 'saving' ? message("ui.saving.card") : draft?.phase === 'error' ? message("ui.card.save.failed") : draft?.isNew ? message("ui.new.marker.not.saved") : session.isMarkerDirty() ? message("ui.unsaved.card.changes.b7e15f") : editing ? message("ui.editing.card") : message("ui.saved.on.this.device"))}</p>
    {draft?.error && <p className="form-error" role="alert">{localize(draft.error)}  {t("ui.your.data.remains.in.the.draft")}</p>}
    {state.imagePending > 0 && <p role="status">{t("ui.inserting.image")}</p>}
    {state.imageError && <p className="form-error" role="alert">{localize(state.imageError)}  {t("ui.card.text.remains.in.the.draft")}</p>}
    {editing ? <fieldset disabled={busy}>
      <label>{t("ui.name")}<input aria-label={t("ui.marker.name")} value={fields.name} maxLength={512} onChange={(event) => edit({ name: event.target.value })} /></label>
      <Suspense fallback={<p role="status">{t("ui.preparing.editor")}</p>}><RichTextEditor label={t("ui.marker.description")} value={fields.description} assets={assets} disabled={busy} onChange={(description) => edit({ description })} insertImage={(file) => prepareCardImage(file, session, session.addMarkerDraftAsset)} onError={session.reportImageError} /></Suspense>
      <label>{t("ui.status")}<select aria-label={t("ui.marker.status")} value={fields.status} onChange={(event) => edit({ status: event.target.value })}>{Object.entries(statusesOf(entity.kind)).map(([value, label]) => <option key={value} value={value}>{localize(label)}</option>)}</select></label>
      {entity.kind === 'trap' && <section aria-label={t("ui.trap.checks")}><h3>{t("ui.checks")}</h3>
        {fields.checks.map((check, index) => {
          const problem = trapCheckProblem({ ...check, dc: check.dc.trim() ? Number(check.dc) : undefined })
          const update = (change: Partial<typeof check>) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, ...change } : c) })
          return <fieldset className="region-check" key={check.id}><legend>{t("ui.check")} {index + 1}</legend>
            <label>{t("ui.purpose")}<input aria-label={t("ui.check.value.purpose", { p0: index + 1 })} value={check.condition} onChange={(e) => update({ condition: e.target.value })} /></label>
            <label>{t("ui.skill.ability")}<input aria-label={t("ui.trap.check.value.skill", { p0: index + 1 })} value={check.ability} onChange={(e) => update({ ability: e.target.value })} /></label>
            <label>{t("ui.difficulty")}<input aria-label={t("ui.check.value.difficulty", { p0: index + 1 })} type="text" inputMode="numeric" aria-invalid={!check.dc.trim() || !Number.isSafeInteger(Number(check.dc)) || Number(check.dc) <= 0} value={check.dc} onChange={(e) => update({ dc: e.target.value })} /></label>
            <label>{t("ui.explanation.optional")}<textarea aria-label={t("ui.check.value.explanation", { p0: index + 1 })} rows={2} value={check.result} onChange={(e) => update({ result: e.target.value })} /></label>
            {problem && <p className="form-error" role="alert">{localize(problem)}</p>}
            <button type="button" onClick={() => edit({ checks: fields.checks.filter((c) => c.id !== check.id) })}>{t("ui.delete.check")} {index + 1}</button>
          </fieldset>
        })}
        <button type="button" disabled={fields.checks.length >= 256} onClick={() => edit({ checks: [...fields.checks, { id: crypto.randomUUID(), condition: '', ability: '', dc: '', result: '' }] })}>{t("ui.add.check")}</button>
      </section>}
      <section aria-label={t("ui.marker.tags")}><h3>{t("ui.tags")}</h3><TagsInput values={fields.tags} catalog={tagCatalog} onChange={(tags) => edit({ tags })} disabled={busy} /></section>
      <fieldset className="marker-region-links" aria-label={t("ui.region.bindings")}><legend>{t("ui.marker.regions")}</legend>
        <p className="form-hint">{t("ui.you.can.select.several.moving.does.not.change.bindings")}</p>
        {state.regions.map((r) => <label className="marker-lock" key={r.id}><input type="checkbox" aria-label={t("ui.bind.to.region.value.value", { p0: r.number, p1: r.title })} checked={fields.regionIds.includes(r.id)} onChange={(event) => edit({ regionIds: event.target.checked ? [...fields.regionIds, r.id] : fields.regionIds.filter((id) => id !== r.id) })} /> {r.number}. {r.title}</label>)}
        {!state.regions.length && <p>{t("ui.no.regions.on.this.map.yet")}</p>}
        <button type="button" disabled={!fields.regionIds.length} onClick={() => edit({ regionIds: [] })}>{t("ui.unbound")}</button>
      </fieldset>
      <ColorPicker value={fields.color} disabled={busy} label={t("ui.marker.color")} paletteLabel={t("ui.marker.color.palette")} onChange={(color) => edit({ color })} />
      <label className="marker-lock"><input aria-label={t("ui.lock.position")} type="checkbox" checked={fields.locked} onChange={(event) => edit({ locked: event.target.checked })} />  {t("ui.lock.position")}</label>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveMarkerDetails() }}>{t("ui.save")}</button><button type="button" onClick={session.cancelMarkerEdit}>{t("ui.cancel")}</button></div>
    </fieldset> : <>
      <p className="marker-status"><span aria-hidden="true">{statusBadge(entity.status)}</span> {localize(statusLabel(entity))}</p>
      <section aria-label={t("ui.quick.status.change")}><label>{t("ui.status")}<select aria-label={t("ui.quick.status.change")} value={entity.status} disabled={readOnly || busy} onChange={(event) => { void session.changeStatus(entity.id, event.target.value) }}>{Object.entries(statusesOf(entity.kind)).map(([value, label]) => <option key={value} value={value}>{localize(label)}</option>)}</select></label>{statusAction?.phase === 'error' && <p className="form-error">{localize(statusAction.error)}</p>}{!playing && <button type="button" disabled={readOnly || busy || !state.canUndoStatus} onClick={() => { void session.undoStatus() }}>{t("ui.undo.status")}</button>}</section>
      <h3>{t("ui.description")}</h3>{documentHasContent(entity.description) ? <RichTextView document={entity.description} assets={state.assets} /> : <p>{t("ui.no.description.yet")}{localize(playing ? message("ui.switch.to.preparation.to.edit.it") : '')}</p>}
      {entity.kind === 'trap' && <section aria-label={t("ui.trap.checks")}><h3>{t("ui.checks")}</h3>{!entity.checks.length && <p>{t("ui.no.checks")}</p>}{entity.checks.map((c) => <div className="region-check" key={c.id}><strong>{c.condition} — {c.ability}{t("ui.dc")} {c.dc}</strong>{c.result && <p className="plain-description">{c.result}</p>}</div>)}</section>}
      <h3>{t("ui.tags")}</h3><p>{localize(entity.tags.join(', ') || message("ui.no.tags"))}</p>
      <p>{t("ui.position")} {localize(marker.locked ? message("ui.locked") : readOnly ? message("ui.read.only") : playing ? message("ui.movement.is.available.in.preparation") : message("ui.movable"))} · <span className="color-preview" style={{ backgroundColor: marker.color }} /> {localize(marker.color)}</p>
      {!playing && !readOnly && <div className="card-actions"><button type="button" disabled={busy} onClick={session.beginMarkerEdit}>{t("ui.edit")}</button><button type="button" disabled={geometryDisabled} onClick={() => { void session.removeMarker(marker.id) }}>{t("ui.delete.marker")}</button></div>}
    </>}
    <section aria-label={t("ui.linked.regions")}><h3>{t("ui.linked.regions")}</h3>
      <ul className="linked-markers">{linkedRegions.map((r) => <li key={r.id}><button type="button" disabled={busy} onClick={() => session.navigate({ mapId: r.mapId, kind: 'region', id: r.id })}>{r.number}. {r.title}</button></li>)}</ul>
      {!linkedRegions.length && <p>{t("ui.unbound")}</p>}
    </section>
    <CardConfirmation state={state} session={session} label={t("ui.unsaved.marker.changes")} error={draft?.error ?? state.modeError} />
  </section>
}
