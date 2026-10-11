import { lazy, Suspense, useState } from 'react'
import { markerDetailsOf } from '../../application/regionSession'
import type { RegionSession, RegionState, MarkerDetails } from '../../application/regionSession'
import type { Entity, MarkerPlacement } from '../../domain/marker'
import { markerTypes, statusesOf, statusLabel, statusBadge } from '../../domain/marker'
import { RichTextView } from '../regions/RichTextView'
import { CardConfirmation } from '../regions/CardConfirmation'
import { prepareCardImage } from '../regions/cardImage'
import { ColorPicker } from '../map/ColorPicker'

const RichTextEditor = lazy(() => import('../regions/RichTextEditor').then((module) => ({ default: module.RichTextEditor })))

export function MarkerCard({ entity, marker, state, session, disabled, geometryDisabled }: { entity: Entity; marker: MarkerPlacement; state: RegionState; session: RegionSession; disabled: boolean; geometryDisabled: boolean }) {
  const draft = state.markerDraft
  const fields = draft?.fields ?? markerDetailsOf(entity, marker)
  const assets = { ...state.assets, ...Object.fromEntries((draft?.assets ?? []).map((a) => [a.id, a])) }
  const editing = state.cardMode === 'edit'
  const busy = disabled || session.detailsSaving() || !!state.imagePending
  const [tag, setTag] = useState('')
  const edit = (change: Partial<MarkerDetails>) => session.editMarkerDetails({ ...fields, ...change })
  const linkedRegions = state.regions.filter((r) => fields.regionIds.includes(r.id))
  return <section className="region-card marker-card" aria-label="Карточка маркера">
    <div className="card-heading"><h2>{entity.name}</h2><button type="button" disabled={busy} aria-label="Закрыть карточку маркера" onClick={session.closeCard}>×</button></div>
    <p className="marker-kind">{markerTypes[entity.kind].label}</p>
    <p role="status" className="card-status">{draft?.phase === 'saving' ? 'Сохранение карточки…' : draft?.phase === 'error' ? 'Ошибка сохранения карточки' : draft?.isNew ? 'Новый маркер — не сохранён' : session.isMarkerDirty() ? 'Есть изменения в карточке' : editing ? 'Редактирование карточки' : 'Сохранено на устройстве'}</p>
    {draft?.error && <p className="form-error" role="alert">{draft.error} Введённые данные остаются в черновике.</p>}
    {state.imagePending > 0 && <p role="status">Вставка изображения…</p>}
    {state.imageError && <p className="form-error" role="alert">{state.imageError} Текст карточки остаётся в черновике.</p>}
    {editing ? <fieldset disabled={busy}>
      <label>Название<input aria-label="Название маркера" value={fields.name} maxLength={512} onChange={(event) => edit({ name: event.target.value })} /></label>
      <Suspense fallback={<p role="status">Подготовка редактора…</p>}><RichTextEditor label="Описание маркера" value={fields.description} assets={assets} disabled={busy} onChange={(description) => edit({ description })} insertImage={(file) => prepareCardImage(file, session, session.addMarkerDraftAsset)} onError={session.reportImageError} /></Suspense>
      <label>Статус<select aria-label="Статус маркера" value={fields.status} onChange={(event) => edit({ status: event.target.value })}>{Object.entries(statusesOf(entity.kind)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <section aria-label="Теги маркера"><h3>Теги</h3><ul className="region-tags">{fields.tags.map((value) => <li key={value}>{value}<button type="button" aria-label={`Удалить тег «${value}»`} onClick={() => edit({ tags: fields.tags.filter((t) => t !== value) })}>×</button></li>)}</ul>
        <form className="tag-entry" onSubmit={(event) => { event.preventDefault(); const value = tag.trim(); if (value && !fields.tags.includes(value) && fields.tags.length < 256) { edit({ tags: [...fields.tags, value] }); setTag('') } }}><input aria-label="Новый тег" value={tag} maxLength={120} onChange={(event) => setTag(event.target.value)} /><button type="submit" disabled={!tag.trim() || fields.tags.includes(tag.trim()) || fields.tags.length >= 256}>Добавить тег</button></form>
      </section>
      <fieldset className="marker-region-links" aria-label="Привязки к областям"><legend>Области маркера</legend>
        <p className="form-hint">Можно выбрать несколько. Привязки не меняются при перемещении.</p>
        {state.regions.map((r) => <label className="marker-lock" key={r.id}><input type="checkbox" aria-label={`Привязать к области «${r.number}. ${r.title}»`} checked={fields.regionIds.includes(r.id)} onChange={(event) => edit({ regionIds: event.target.checked ? [...fields.regionIds, r.id] : fields.regionIds.filter((id) => id !== r.id) })} /> {r.number}. {r.title}</label>)}
        {!state.regions.length && <p>На карте пока нет областей</p>}
        <button type="button" disabled={!fields.regionIds.length} onClick={() => edit({ regionIds: [] })}>Без привязки</button>
      </fieldset>
      <ColorPicker value={fields.color} disabled={busy} label="Цвет маркера" paletteLabel="Палитра цвета маркера" onChange={(color) => edit({ color })} />
      <label className="marker-lock"><input aria-label="Закрепить положение" type="checkbox" checked={fields.locked} onChange={(event) => edit({ locked: event.target.checked })} /> Закрепить положение</label>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveMarkerDetails() }}>Сохранить</button><button type="button" onClick={() => { session.cancelMarkerEdit(); setTag('') }}>Отмена</button></div>
    </fieldset> : <>
      <p className="marker-status"><span aria-hidden="true">{statusBadge(entity.status)}</span> {statusLabel(entity)}</p>
      <h3>Описание</h3><RichTextView document={entity.description} assets={state.assets} />
      <h3>Теги</h3><p>{entity.tags.join(', ') || 'Нет тегов'}</p>
      <p>Положение: {marker.locked ? 'Закреплено' : 'Можно перемещать'} · <span className="color-preview" style={{ backgroundColor: marker.color }} /> {marker.color}</p>
      <div className="card-actions"><button type="button" disabled={busy} onClick={session.beginMarkerEdit}>Редактировать</button><button type="button" disabled={geometryDisabled} onClick={() => { void session.removeMarker(marker.id) }}>Удалить маркер</button></div>
    </>}
    <section aria-label="Связанные области"><h3>Связанные области</h3>
      <ul className="linked-markers">{linkedRegions.map((r) => <li key={r.id}><button type="button" disabled={busy} onClick={() => session.openCard(r.id, true)}>{r.number}. {r.title}</button></li>)}</ul>
      {!linkedRegions.length && <p>Без привязки</p>}
    </section>
    <CardConfirmation state={state} session={session} label="Несохранённые изменения маркера" error={draft?.error} />
  </section>
}
