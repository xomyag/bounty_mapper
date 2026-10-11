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
  return <section className="region-card marker-card" aria-label="Карточка маркера">
    <div className="card-heading"><h2>{entity.name}</h2><button type="button" disabled={busy} aria-label="Закрыть карточку маркера" onClick={session.closeCard}>×</button></div>
    <p className="marker-kind">{markerTypes[entity.kind].label}</p>
    <p role="status" className="card-status">{statusAction?.phase === 'saving' ? 'Сохранение статуса…' : statusAction?.phase === 'error' ? 'Ошибка сохранения статуса — показаны сохранённые данные' : draft?.phase === 'saving' ? 'Сохранение карточки…' : draft?.phase === 'error' ? 'Ошибка сохранения карточки' : draft?.isNew ? 'Новый маркер — не сохранён' : session.isMarkerDirty() ? 'Есть изменения в карточке' : editing ? 'Редактирование карточки' : 'Сохранено на устройстве'}</p>
    {draft?.error && <p className="form-error" role="alert">{draft.error} Введённые данные остаются в черновике.</p>}
    {state.imagePending > 0 && <p role="status">Вставка изображения…</p>}
    {state.imageError && <p className="form-error" role="alert">{state.imageError} Текст карточки остаётся в черновике.</p>}
    {editing ? <fieldset disabled={busy}>
      <label>Название<input aria-label="Название маркера" value={fields.name} maxLength={512} onChange={(event) => edit({ name: event.target.value })} /></label>
      <Suspense fallback={<p role="status">Подготовка редактора…</p>}><RichTextEditor label="Описание маркера" value={fields.description} assets={assets} disabled={busy} onChange={(description) => edit({ description })} insertImage={(file) => prepareCardImage(file, session, session.addMarkerDraftAsset)} onError={session.reportImageError} /></Suspense>
      <label>Статус<select aria-label="Статус маркера" value={fields.status} onChange={(event) => edit({ status: event.target.value })}>{Object.entries(statusesOf(entity.kind)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {entity.kind === 'trap' && <section aria-label="Проверки ловушки"><h3>Проверки</h3>
        {fields.checks.map((check, index) => {
          const problem = trapCheckProblem({ ...check, dc: check.dc.trim() ? Number(check.dc) : undefined })
          const update = (change: Partial<typeof check>) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, ...change } : c) })
          return <fieldset className="region-check" key={check.id}><legend>Проверка {index + 1}</legend>
            <label>Назначение<input aria-label={`Назначение проверки ${index + 1}`} value={check.condition} onChange={(e) => update({ condition: e.target.value })} /></label>
            <label>Навык / характеристика<input aria-label={`Навык проверки ловушки ${index + 1}`} value={check.ability} onChange={(e) => update({ ability: e.target.value })} /></label>
            <label>Сложность<input aria-label={`Сложность проверки ${index + 1}`} type="text" inputMode="numeric" aria-invalid={!check.dc.trim() || !Number.isSafeInteger(Number(check.dc)) || Number(check.dc) <= 0} value={check.dc} onChange={(e) => update({ dc: e.target.value })} /></label>
            <label>Пояснение (необязательно)<textarea aria-label={`Пояснение проверки ${index + 1}`} rows={2} value={check.result} onChange={(e) => update({ result: e.target.value })} /></label>
            {problem && <p className="form-error" role="alert">{problem}</p>}
            <button type="button" onClick={() => edit({ checks: fields.checks.filter((c) => c.id !== check.id) })}>Удалить проверку {index + 1}</button>
          </fieldset>
        })}
        <button type="button" disabled={fields.checks.length >= 256} onClick={() => edit({ checks: [...fields.checks, { id: crypto.randomUUID(), condition: '', ability: '', dc: '', result: '' }] })}>Добавить проверку</button>
      </section>}
      <section aria-label="Теги маркера"><h3>Теги</h3><TagsInput values={fields.tags} catalog={tagCatalog} onChange={(tags) => edit({ tags })} disabled={busy} /></section>
      <fieldset className="marker-region-links" aria-label="Привязки к областям"><legend>Области маркера</legend>
        <p className="form-hint">Можно выбрать несколько. Привязки не меняются при перемещении.</p>
        {state.regions.map((r) => <label className="marker-lock" key={r.id}><input type="checkbox" aria-label={`Привязать к области «${r.number}. ${r.title}»`} checked={fields.regionIds.includes(r.id)} onChange={(event) => edit({ regionIds: event.target.checked ? [...fields.regionIds, r.id] : fields.regionIds.filter((id) => id !== r.id) })} /> {r.number}. {r.title}</label>)}
        {!state.regions.length && <p>На карте пока нет областей</p>}
        <button type="button" disabled={!fields.regionIds.length} onClick={() => edit({ regionIds: [] })}>Без привязки</button>
      </fieldset>
      <ColorPicker value={fields.color} disabled={busy} label="Цвет маркера" paletteLabel="Палитра цвета маркера" onChange={(color) => edit({ color })} />
      <label className="marker-lock"><input aria-label="Закрепить положение" type="checkbox" checked={fields.locked} onChange={(event) => edit({ locked: event.target.checked })} /> Закрепить положение</label>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveMarkerDetails() }}>Сохранить</button><button type="button" onClick={session.cancelMarkerEdit}>Отмена</button></div>
    </fieldset> : <>
      <p className="marker-status"><span aria-hidden="true">{statusBadge(entity.status)}</span> {statusLabel(entity)}</p>
      <section aria-label="Быстрая смена статуса"><label>Статус<select aria-label="Быстрая смена статуса" value={entity.status} disabled={readOnly || busy} onChange={(event) => { void session.changeStatus(entity.id, event.target.value) }}>{Object.entries(statusesOf(entity.kind)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{statusAction?.phase === 'error' && <p className="form-error">{statusAction.error}</p>}{!playing && <button type="button" disabled={readOnly || busy || !state.canUndoStatus} onClick={() => { void session.undoStatus() }}>Отменить статус</button>}</section>
      <h3>Описание</h3>{documentHasContent(entity.description) ? <RichTextView document={entity.description} assets={state.assets} /> : <p>Описание пока не заполнено{playing ? '. Для редактирования перейдите в «Подготовку».' : ''}</p>}
      {entity.kind === 'trap' && <section aria-label="Проверки ловушки"><h3>Проверки</h3>{!entity.checks.length && <p>Нет проверок</p>}{entity.checks.map((c) => <div className="region-check" key={c.id}><strong>{c.condition} — {c.ability}, СЛ {c.dc}</strong>{c.result && <p className="plain-description">{c.result}</p>}</div>)}</section>}
      <h3>Теги</h3><p>{entity.tags.join(', ') || 'Нет тегов'}</p>
      <p>Положение: {marker.locked ? 'Закреплено' : readOnly ? 'Только просмотр' : playing ? 'Перемещение доступно в «Подготовке»' : 'Можно перемещать'} · <span className="color-preview" style={{ backgroundColor: marker.color }} /> {marker.color}</p>
      {!playing && !readOnly && <div className="card-actions"><button type="button" disabled={busy} onClick={session.beginMarkerEdit}>Редактировать</button><button type="button" disabled={geometryDisabled} onClick={() => { void session.removeMarker(marker.id) }}>Удалить маркер</button></div>}
    </>}
    <section aria-label="Связанные области"><h3>Связанные области</h3>
      <ul className="linked-markers">{linkedRegions.map((r) => <li key={r.id}><button type="button" disabled={busy} onClick={() => session.navigate({ mapId: r.mapId, kind: 'region', id: r.id })}>{r.number}. {r.title}</button></li>)}</ul>
      {!linkedRegions.length && <p>Без привязки</p>}
    </section>
    <CardConfirmation state={state} session={session} label="Несохранённые изменения маркера" error={draft?.error ?? state.modeError} />
  </section>
}
