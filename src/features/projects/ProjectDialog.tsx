import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Project } from '../../domain/project'
import type { ProjectRepository } from '../../application/projectRepository'
import type { ProjectSession } from '../../application/projectSession'

interface Props {
  mode: 'projects' | 'edit'
  repository: ProjectRepository
  session: ProjectSession
  onClose: () => void
  onEdit: () => void
}

export function ProjectDialog({ mode, repository, session, onClose, onEdit }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [name, setName] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [listError, setListError] = useState('')
  const [listing, setListing] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    if (mode !== 'projects') return
    let active = true
    repository.list().then((items) => {
      if (active) { setProjects(items); setListError(''); setListing(false) }
    }).catch((error: unknown) => {
      if (active) { setListError(error instanceof Error ? error.message : 'Не удалось прочитать проекты.'); setListing(false) }
    })
    return () => { active = false }
  }, [repository, mode, attempt])

  const project = state.project
  const blocked = state.loading || session.hasUnsavedChanges()
  return (
    <dialog ref={ref} className="project-dialog" aria-labelledby="project-dialog-title" onCancel={onClose} onClose={onClose}>
      <div className="dialog-heading">
        <h2 id="project-dialog-title">{mode === 'projects' ? 'Локальные проекты' : 'Контекст приключения'}</h2>
        <button type="button" onClick={onClose} aria-label="Закрыть окно проекта">Закрыть</button>
      </div>
      {mode === 'projects' ? (
        <>
          {state.error && <p className="form-error" role="alert">{state.error}</p>}
          <form onSubmit={(event) => {
            event.preventDefault()
            void session.create(name).then(onEdit).catch((error: unknown) => setListError(error instanceof Error ? error.message : 'Не удалось создать проект.'))
          }}>
            <label htmlFor="new-project-name">Название нового проекта</label>
            <div className="create-project-row">
              <input id="new-project-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
              <button type="submit" disabled={blocked || !name.trim()}>Создать</button>
            </div>
          </form>
          {blocked && <p className="form-hint">Сначала сохраните изменения текущего проекта. Текст доступен в окне «Контекст».</p>}
          <h3>Открыть проект</h3>
          {listing && <p role="status">Чтение проектов…</p>}
          {listError && <div role="alert"><p>{listError}</p><button type="button" onClick={() => { setListing(true); setAttempt(attempt + 1) }}>Повторить чтение</button></div>}
          {!listing && !listError && projects.length === 0 && <p className="form-hint">На этом устройстве пока нет проектов.</p>}
          <ul className="project-list">
            {projects.map((item) => (
              <li key={item.id}>
                <button type="button" aria-label={`Открыть проект «${item.name}»`} disabled={blocked} onClick={() => {
                  void session.open(item.id).then(() => { if (!session.getSnapshot().error) onClose() }).catch((error: unknown) => setListError(error instanceof Error ? error.message : 'Не удалось открыть проект.'))
                }}>
                  <span>{item.name}</span>
                  <small>{item.id === project?.id ? 'Текущий проект' : 'Открыть'}</small>
                </button>
              </li>
            ))}
          </ul>
          <p className="form-hint">Проекты хранятся только в этом браузере на этом устройстве.</p>
        </>
      ) : project && (
        <form onSubmit={(event) => { event.preventDefault(); void session.save() }}>
          {state.readOnly && <p className="form-hint">Только просмотр: проект редактируется в другой вкладке. Получите право редактирования в основной панели.</p>}
          <label htmlFor="project-name">Название проекта</label>
          <input id="project-name" required autoFocus readOnly={state.readOnly} value={project.name} onChange={(event) => session.edit({ name: event.target.value, contextMd: project.contextMd })} />
          <label htmlFor="project-context">Общий контекст приключения</label>
          <textarea id="project-context" rows={12} readOnly={state.readOnly} value={project.contextMd} onChange={(event) => session.edit({ name: project.name, contextMd: event.target.value })} placeholder="Замысел приключения, важные события и заметки ведущего…" />
          <p className="form-hint">Автосохранение после ввода. Markdown хранится как текст; предпросмотр появится позже.</p>
          <div className="editor-footer">
            <span role="status">{state.status === 'saved' ? 'Сохранено на устройстве' : state.status === 'saving' ? 'Сохранение…' : state.status === 'error' ? 'Ошибка сохранения' : 'Есть изменения'}</span>
            <button type="submit" disabled={state.readOnly || state.loading || state.status === 'saving' || state.status === 'saved' || !project.name.trim()}>Сохранить</button>
          </div>
          {state.error && <div className="form-error" role="alert">{state.error} Текст остаётся в открытой форме. Исправьте причину и повторите сохранение.</div>}
          {state.status === 'error' && project.revision > 0 && <button type="button" className="reload-project" onClick={() => {
            if (window.confirm('Несохранённый текст будет заменён версией с устройства. Скопируйте его перед продолжением. Открыть сохранённую версию?')) {
              void session.open(project.id, true)
            }
          }}>Открыть сохранённую версию</button>}
        </form>
      )}
    </dialog>
  )
}
