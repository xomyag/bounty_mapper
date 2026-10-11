import { localize, message, t } from '../../i18n'
import { lazy, Suspense } from 'react'
import { detailsOf } from '../../application/regionSession'
import type { RegionSession, RegionState, RegionDetails } from '../../application/regionSession'
import type { Region } from '../../domain/region'
import { RichTextView } from './RichTextView'
import { ColorPicker } from '../map/ColorPicker'
import { prepareCardImage } from './cardImage'
import { CardConfirmation } from './CardConfirmation'
import { statusLabel } from '../../domain/marker'
import { TagsInput } from '../tags/TagsInput'
import { documentHasContent } from '../../domain/richText'
import { regionHasUserContent } from '../../domain/region'

const RichTextEditor = lazy(() => import('./RichTextEditor').then((module) => ({ default: module.RichTextEditor })))

export function RegionCard({ region, state, session, disabled, geometryDisabled, tagCatalog = [] }: { region: Region; state: RegionState; session: RegionSession; disabled: boolean; geometryDisabled: boolean; tagCatalog?: string[] }) {
  const draft = state.details[region.id]
  const fields = draft?.fields ?? detailsOf(region)
  const assets = { ...state.assets, ...Object.fromEntries((draft?.assets ?? []).map((a) => [a.id, a])) }
  const playing = state.mode === 'play'
  const readOnly = playing || !session.canEditProject()
  const editing = !readOnly && state.cardMode === 'edit'
  const busy = disabled || session.detailsSaving() || !!state.imagePending
  const edit = (change: Partial<RegionDetails>) => session.editDetails(region.id, change)
  const insertImage = (file: Blob) => prepareCardImage(file, session, (asset) => session.addDraftAsset(region.id, asset))
  const focusMap = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-map-canvas]')?.focus())
  return <section className="region-card" aria-label={t("ui.region.card")}>
    <div className="card-heading"><h2>{region.number}. {region.title}</h2><button type="button" disabled={busy} aria-label={t("ui.close.region.card")} onClick={session.closeCard}>×</button></div>
    <p role="status" className="card-status">{localize(draft?.phase === 'saving' ? message("ui.saving.card") : draft?.phase === 'error' ? message("ui.card.save.failed") : session.isDetailsDirty(region.id) ? message("ui.unsaved.card.changes.b7e15f") : editing ? message("ui.editing.card") : message("ui.saved.on.this.device"))}</p>
    {draft?.error && <p className="form-error" role="alert">{localize(draft.error)}  {t("ui.your.data.remains.in.the.draft")}</p>}
    {state.imagePending > 0 && <p role="status">{t("ui.inserting.image")}</p>}
    {state.imageError && <p className="form-error" role="alert">{localize(state.imageError)}  {t("ui.card.text.remains.in.the.draft")}</p>}
    {editing ? <fieldset disabled={busy}>
      <div className="card-identity"><label>{t("ui.number")}<input aria-label={t("ui.region.number")} type="number" min="1" step="1" value={fields.number} onChange={(event) => edit({ number: event.target.value })} /></label><label>{t("ui.name")}<input aria-label={t("ui.region.name")} value={fields.title} onChange={(event) => edit({ title: event.target.value })} /></label></div>
      <label>{t("ui.short.description")}<textarea aria-label={t("ui.short.description")} rows={3} maxLength={262144} value={fields.shortDescription} onChange={(event) => edit({ shortDescription: event.target.value })} /></label>
      <Suspense fallback={<p role="status">{t("ui.preparing.editor")}</p>}>
        <RichTextEditor label={t("ui.gm.notes")} value={fields.gmNotes} assets={assets} disabled={busy} onChange={(gmNotes) => edit({ gmNotes })} insertImage={insertImage} onError={session.reportImageError} />
        <RichTextEditor label={t("ui.player.description")} value={fields.playerDescription} assets={assets} disabled={busy} onChange={(playerDescription) => edit({ playerDescription })} insertImage={insertImage} onError={session.reportImageError} />
      </Suspense>
      <section aria-label={t("ui.region.checks")}><h3>{t("ui.checks")}</h3>
        {fields.checks.map((check, index) => <fieldset className="region-check" key={check.id} aria-label={t("ui.check.value", { p0: index + 1 })}>
          <legend>{t("ui.check")} {index + 1}</legend>
          <label>{t("ui.condition")}<input aria-label={t("ui.check.value.condition", { p0: index + 1 })} value={check.condition} onChange={(event) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, condition: event.target.value } : c) })} /></label>
          <label>{t("ui.skill.ability")}<input aria-label={t("ui.check.value.skill", { p0: index + 1 })} value={check.ability} onChange={(event) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, ability: event.target.value } : c) })} /></label>
          <label>{t("ui.dc.optional")}<input aria-label={t("ui.check.value.dc", { p0: index + 1 })} type="number" min="0" step="1" value={check.dc ?? ''} onChange={(event) => edit({ checks: fields.checks.map((c) => {
            if (c.id !== check.id) return c
            const { dc: _dc, ...rest } = c; void _dc
            return event.target.value === '' ? rest : { ...rest, dc: Number(event.target.value) }
          }) })} /></label>
          <label>{t("ui.result")}<textarea aria-label={t("ui.check.value.result", { p0: index + 1 })} rows={2} value={check.result} onChange={(event) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, result: event.target.value } : c) })} /></label>
          <button type="button" onClick={() => edit({ checks: fields.checks.filter((c) => c.id !== check.id) })}>{t("ui.delete.check")} {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={fields.checks.length >= 256} onClick={() => edit({ checks: [...fields.checks, { id: crypto.randomUUID(), condition: '', ability: '', result: '' }] })}>{t("ui.add.check")}</button>
      </section>
      <section aria-label={t("ui.region.tags")}><h3>{t("ui.tags")}</h3><TagsInput values={fields.tags} catalog={tagCatalog} onChange={(tags) => edit({ tags })} disabled={busy} /></section>
      <div className="region-appearance"><ColorPicker value={fields.color} onChange={(color) => edit({ color })} disabled={busy} /><label>{t("ui.fill")} {Math.round(fields.fillOpacity * 100)}%<input aria-label={t("ui.fill.opacity")} type="range" min="0" max="100" value={Math.round(fields.fillOpacity * 100)} onChange={(event) => edit({ fillOpacity: Number(event.target.value) / 100 })} /></label></div>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveDetails() }}>{t("ui.save")}</button><button type="button" onClick={session.cancelEdit}>{t("ui.cancel")}</button></div>
    </fieldset> : <>
      {playing && !regionHasUserContent(region) && <p className="form-hint">{t("ui.this.card.is.empty.switch.to.preparation.to.edit")}</p>}
      {region.shortDescription.trim() && <section aria-label={t("ui.region.short.description")}><h3>{t("ui.short.description")}</h3><p className="plain-description">{region.shortDescription}</p></section>}
      <section className="region-player-description" aria-label={t("ui.region.player.description")}><h3>{t("ui.player.description")}</h3>{documentHasContent(region.playerDescription) ? <RichTextView document={region.playerDescription} assets={state.assets} /> : <p>{t("ui.no.description.yet")}</p>}</section>
      <section className="region-gm-notes" aria-label={t("ui.region.gm.notes")}><h3>{t("ui.gm.notes")}</h3>{documentHasContent(region.gmNotes) ? <RichTextView document={region.gmNotes} assets={state.assets} /> : <p>{t("ui.no.notes.yet")}</p>}</section>
      <h3>{t("ui.checks")}</h3>{!region.checks.length && <p>{t("ui.no.checks")}</p>}{region.checks.map((c) => <div className="region-check" key={c.id}><strong>{localize(c.condition || message("ui.no.condition"))}</strong><p>{c.ability}{localize(c.dc === undefined ? '' : message("ui.dc.value", { p0: c.dc }))}</p><p>{c.result}</p></div>)}
      <h3>{t("ui.tags")}</h3><p>{localize(region.tags.join(', ') || message("ui.no.tags"))}</p>
      {!readOnly && <><button type="button" disabled={disabled || state.vertexMode} onClick={session.beginEdit}>{t("ui.edit")}</button><button type="button" disabled={geometryDisabled} onClick={() => { void session.remove() }}>{t("ui.delete.region")}</button></>}
    </>}
    <section aria-label={t("ui.linked.markers")}><h3>{t("ui.linked.markers")}</h3><ul className="linked-markers">{state.markers.filter((m) => m.regionIds.includes(region.id)).map((m) => {
      const entity = state.entities.find((e) => e.id === m.entityId)!
      return <li key={m.id}><button type="button" disabled={busy || state.vertexMode} onClick={() => session.navigate({ mapId: m.mapId, kind: 'marker', id: m.id })}>{entity.name} · {localize(statusLabel(entity))}</button></li>
    })}</ul>{!state.markers.some((m) => m.regionIds.includes(region.id)) && <p>{t("ui.no.linked.markers")}</p>}</section>
    {!readOnly && <div className="card-map-tools"><button type="button" disabled={busy} aria-pressed={state.vertexMode} onClick={() => { session.setVertexMode(!state.vertexMode); focusMap() }}>{localize(state.vertexMode ? message("ui.finish.vertex.editing") : message("ui.edit.vertices"))}</button>
      {state.vertexMode && <button type="button" disabled={geometryDisabled || state.selectedVertex === undefined || region.vertices.length <= 3} onClick={() => { void session.removeVertex() }}>{t("ui.delete.vertex")}</button>}
    </div>}
    <CardConfirmation state={state} session={session} label={t("ui.unsaved.region.changes")} error={draft?.error ?? state.modeError} />
  </section>
}
