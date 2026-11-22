import { useEffect, useRef } from 'react'
import { localize, t } from '../../i18n'
import { excludedLevelLinks } from '../../application/levelImport'
import type { LevelImportSession } from '../../application/levelImport'

export function LevelImportDialog({ session, targetName, onConfirm, onChoose }: { session: LevelImportSession; targetName: string; onConfirm: () => void; onChoose: () => void }) {
  const state = session.getSnapshot()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const excluded = state.source ? excludedLevelLinks(state.source, state.selectedIds) : 0
  const choices = session.choices()
  return <dialog ref={ref} className="project-dialog level-import-dialog" aria-label={t('level.import')} onCancel={(event) => { event.preventDefault(); session.cancel() }}>
    <h2>{t('level.import')}</h2>
    <p>{t('level.target', { name: targetName })}</p>
    {session.busy() && <p role="status">{t(state.phase === 'saving' ? 'level.saving' : 'level.validating', { count: state.selectedIds.length })}</p>}
    {state.error && <p role="alert" className="form-error">{localize(state.error)}</p>}
    {state.source && <fieldset className="level-choices" disabled={session.busy()}>
      <legend>{t('level.select')}</legend>
      <div className="card-actions">
        <button type="button" onClick={() => session.select(choices.map((map) => map.id))}>{t('level.selectAll')}</button>
        <button type="button" onClick={() => session.select([])}>{t('level.clear')}</button>
      </div>
      <p role="status">{t('level.selected', { count: state.selectedIds.length })}</p>
      {choices.map((map) => <label key={map.id}>
        <input type="checkbox" aria-label={map.name} checked={state.selectedIds.includes(map.id)} onChange={(event) => session.select(event.target.checked ? [...state.selectedIds, map.id] : state.selectedIds.filter((id) => id !== map.id))} />
        <span>{map.name}{map.finalName && <small>{t('level.finalName', { name: map.finalName })}</small>}</span>
      </label>)}
    </fieldset>}
    {!!excluded && <p role="note">{t('level.excludedLinks', { count: excluded })}</p>}
    <div className="card-actions">
      {state.source && <button type="button" disabled={session.busy() || !state.selectedIds.length} onClick={onConfirm}>{t('level.confirm', { count: state.selectedIds.length })}</button>}
      <button type="button" disabled={session.busy()} onClick={onChoose}>{t('level.chooseArchive')}</button>
      <button type="button" disabled={session.busy()} onClick={session.cancel}>{t('ui.cancel')}</button>
    </div>
  </dialog>
}
