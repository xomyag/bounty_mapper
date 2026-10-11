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
  const edit = (change: Partial<RegionDetails>) => session.editDetails(region.id, { ...fields, ...change })
  const insertImage = (file: Blob) => prepareCardImage(file, session, (asset) => session.addDraftAsset(region.id, asset))
  const focusMap = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Карта приключения"]')?.focus())
  return <section className="region-card" aria-label="Карточка области">
    <div className="card-heading"><h2>{region.number}. {region.title}</h2><button type="button" disabled={busy} aria-label="Закрыть карточку области" onClick={session.closeCard}>×</button></div>
    <p role="status" className="card-status">{draft?.phase === 'saving' ? 'Сохранение карточки…' : draft?.phase === 'error' ? 'Ошибка сохранения карточки' : session.isDetailsDirty(region.id) ? 'Есть изменения в карточке' : editing ? 'Редактирование карточки' : 'Сохранено на устройстве'}</p>
    {draft?.error && <p className="form-error" role="alert">{draft.error} Введённые данные остаются в черновике.</p>}
    {state.imagePending > 0 && <p role="status">Вставка изображения…</p>}
    {state.imageError && <p className="form-error" role="alert">{state.imageError} Текст карточки остаётся в черновике.</p>}
    {editing ? <fieldset disabled={busy}>
      <div className="card-identity"><label>Номер<input aria-label="Номер области" type="number" min="1" step="1" value={fields.number} onChange={(event) => edit({ number: event.target.value })} /></label><label>Название<input aria-label="Название области" value={fields.title} onChange={(event) => edit({ title: event.target.value })} /></label></div>
      <Suspense fallback={<p role="status">Подготовка редактора…</p>}>
        <RichTextEditor label="Заметки ведущего" value={fields.gmNotes} assets={assets} disabled={busy} onChange={(gmNotes) => edit({ gmNotes })} insertImage={insertImage} onError={session.reportImageError} />
        <RichTextEditor label="Описание для игроков" value={fields.playerDescription} assets={assets} disabled={busy} onChange={(playerDescription) => edit({ playerDescription })} insertImage={insertImage} onError={session.reportImageError} />
      </Suspense>
      <section aria-label="Проверки области"><h3>Проверки</h3>
        {fields.checks.map((check, index) => <fieldset className="region-check" key={check.id} aria-label={`Проверка ${index + 1}`}>
          <legend>Проверка {index + 1}</legend>
          <label>Условие<input aria-label={`Условие проверки ${index + 1}`} value={check.condition} onChange={(event) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, condition: event.target.value } : c) })} /></label>
          <label>Навык / характеристика<input aria-label={`Навык проверки ${index + 1}`} value={check.ability} onChange={(event) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, ability: event.target.value } : c) })} /></label>
          <label>СЛ (необязательно)<input aria-label={`СЛ проверки ${index + 1}`} type="number" min="0" step="1" value={check.dc ?? ''} onChange={(event) => edit({ checks: fields.checks.map((c) => {
            if (c.id !== check.id) return c
            const { dc: _dc, ...rest } = c; void _dc
            return event.target.value === '' ? rest : { ...rest, dc: Number(event.target.value) }
          }) })} /></label>
          <label>Результат<textarea aria-label={`Результат проверки ${index + 1}`} rows={2} value={check.result} onChange={(event) => edit({ checks: fields.checks.map((c) => c.id === check.id ? { ...c, result: event.target.value } : c) })} /></label>
          <button type="button" onClick={() => edit({ checks: fields.checks.filter((c) => c.id !== check.id) })}>Удалить проверку {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={fields.checks.length >= 256} onClick={() => edit({ checks: [...fields.checks, { id: crypto.randomUUID(), condition: '', ability: '', result: '' }] })}>Добавить проверку</button>
      </section>
      <section aria-label="Теги области"><h3>Теги</h3><TagsInput values={fields.tags} catalog={tagCatalog} onChange={(tags) => edit({ tags })} disabled={busy} /></section>
      <div className="region-appearance"><ColorPicker value={fields.color} onChange={(color) => edit({ color })} disabled={busy} /><label>Заливка: {Math.round(fields.fillOpacity * 100)}%<input aria-label="Непрозрачность заливки" type="range" min="0" max="100" value={Math.round(fields.fillOpacity * 100)} onChange={(event) => edit({ fillOpacity: Number(event.target.value) / 100 })} /></label></div>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveDetails() }}>Сохранить</button><button type="button" onClick={session.cancelEdit}>Отмена</button></div>
    </fieldset> : <>
      {playing && !regionHasUserContent(region) && <p className="form-hint">Карточка пока не заполнена. Для редактирования перейдите в «Подготовку».</p>}
      <section className="region-player-description" aria-label="Описание для игроков области"><h3>Описание для игроков</h3>{documentHasContent(region.playerDescription) ? <RichTextView document={region.playerDescription} assets={state.assets} /> : <p>Описание пока не заполнено</p>}</section>
      <section className="region-gm-notes" aria-label="Заметки ведущего области"><h3>Заметки ведущего</h3>{documentHasContent(region.gmNotes) ? <RichTextView document={region.gmNotes} assets={state.assets} /> : <p>Заметки пока не заполнены</p>}</section>
      <h3>Проверки</h3>{!region.checks.length && <p>Нет проверок</p>}{region.checks.map((c) => <div className="region-check" key={c.id}><strong>{c.condition || 'Без условия'}</strong><p>{c.ability}{c.dc === undefined ? '' : ` · СЛ ${c.dc}`}</p><p>{c.result}</p></div>)}
      <h3>Теги</h3><p>{region.tags.join(', ') || 'Нет тегов'}</p>
      {!readOnly && <><button type="button" disabled={disabled || state.vertexMode} onClick={session.beginEdit}>Редактировать</button><button type="button" disabled={geometryDisabled} onClick={() => { void session.remove() }}>Удалить область</button></>}
    </>}
    <section aria-label="Связанные маркеры"><h3>Связанные маркеры</h3><ul className="linked-markers">{state.markers.filter((m) => m.regionIds.includes(region.id)).map((m) => {
      const entity = state.entities.find((e) => e.id === m.entityId)!
      return <li key={m.id}><button type="button" disabled={busy || state.vertexMode} onClick={() => session.navigate({ mapId: m.mapId, kind: 'marker', id: m.id })}>{entity.name} · {statusLabel(entity)}</button></li>
    })}</ul>{!state.markers.some((m) => m.regionIds.includes(region.id)) && <p>Нет связанных маркеров</p>}</section>
    {!readOnly && <div className="card-map-tools"><button type="button" disabled={busy} aria-pressed={state.vertexMode} onClick={() => { session.setVertexMode(!state.vertexMode); focusMap() }}>{state.vertexMode ? 'Закончить правку вершин' : 'Редактировать вершины'}</button>
      {state.vertexMode && <button type="button" disabled={geometryDisabled || state.selectedVertex === undefined || region.vertices.length <= 3} onClick={() => { void session.removeVertex() }}>Удалить вершину</button>}
    </div>}
    <CardConfirmation state={state} session={session} label="Несохранённые изменения области" error={draft?.error ?? state.modeError} />
  </section>
}
