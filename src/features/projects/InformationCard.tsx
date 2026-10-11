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
  const label = info.kind === 'map' ? 'Описание карты' : 'Контекст приключения'
  const draft = info.draft
  const editing = !!draft && (creating || session.isPreparation())
  const busy = disabled || session.detailsSaving() || !!state.imagePending
  const assets = { ...info.assets, ...Object.fromEntries((draft?.assets ?? []).map((a) => [a.id, a])) }
  return <section className="region-card" aria-label={label}>
    <div className="card-heading"><h2>{label}: {mapName ?? info.name}</h2><button type="button" aria-label={`Закрыть ${label.toLowerCase()}`} disabled={busy} onClick={session.closeCard}>×</button></div>
    <p role="status">{draft?.phase === 'saving' ? 'Сохранение…' : draft?.phase === 'error' ? 'Ошибка сохранения' : session.isInformationDirty() ? 'Есть несохранённые изменения' : editing ? 'Редактирование' : 'Сохранено на устройстве'}</p>
    {draft?.error && <p role="alert" className="form-error">{draft.error} Текст и изображения остаются в черновике. Повторите сохранение.</p>}
    {state.imagePending > 0 && <p role="status">Вставка изображения…</p>}
    {state.imageError && <p role="alert" className="form-error">{state.imageError}</p>}
    {editing ? <fieldset disabled={busy}>
      {info.kind !== 'map' && <label>Название проекта<input aria-label="Название проекта" value={draft.name} onChange={(event) => session.editInformation({ name: event.target.value })} /></label>}
      <Suspense fallback={<p role="status">Подготовка редактора…</p>}><RichTextEditor label={info.kind === 'map' ? 'Текст описания карты' : 'Общий контекст приключения'} value={draft.document} assets={assets} disabled={busy} onChange={(document) => session.editInformation({ document })} insertImage={(file) => prepareCardImage(file, session, session.addInformationDraftAsset)} onError={session.reportImageError} /></Suspense>
      <div className="card-actions"><button type="button" onClick={() => { void session.saveInformation() }}>Сохранить</button><button type="button" onClick={() => { session.cancelInformationEdit(); if (creating) onCancelCreation() }}>Отмена</button></div>
    </fieldset> : <>
      {documentHasContent(info.document) ? <RichTextView document={info.document} assets={assets} /> : <p className="form-hint">{info.kind === 'map' ? 'Описание карты пока не заполнено.' : 'Контекст приключения пока не заполнен.'}</p>}
      {session.isPreparation() && <button type="button" disabled={busy} onClick={session.beginInformationEdit}>{documentHasContent(info.document) ? 'Редактировать' : 'Заполнить'}</button>}
    </>}
    <CardConfirmation state={state} session={session} label="Несохранённые изменения контекста" error={draft?.error ?? state.modeError} />
  </section>
}
