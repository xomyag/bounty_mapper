import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Project } from '../../domain/project'
import type { ProjectRepository } from '../../application/projectRepository'
import type { ProjectSession } from '../../application/projectSession'

export function ProjectDialog({ repository, session, onClose, onCreate, onOpen, onDelete, message }: { repository: ProjectRepository; session: ProjectSession; onClose: () => void; onCreate: (name: string) => void; onOpen: (id: string) => void; onDelete: (project: Project) => void; message?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [name, setName] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState('')
  const [listing, setListing] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    let active = true
    repository.list().then((items) => { if (active) { setProjects(items); setError(''); setListing(false) } }).catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : 'Не удалось прочитать проекты.'); setListing(false) } })
    return () => { active = false }
  }, [repository, attempt])
  const blocked = state.loading || session.hasUnsavedChanges()
  return <dialog ref={ref} className="project-dialog" aria-labelledby="project-dialog-title" onCancel={onClose} onClose={onClose}>
    <div className="dialog-heading"><h2 id="project-dialog-title">Локальные проекты</h2><button type="button" onClick={onClose} aria-label="Закрыть окно проекта">Закрыть</button></div>
    {message && <p role="status">{message}</p>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <form onSubmit={(event) => { event.preventDefault(); onCreate(name) }}>
      <label htmlFor="new-project-name">Название нового проекта</label>
      <div className="create-project-row"><input id="new-project-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus /><button type="submit" disabled={blocked || !name.trim()}>Создать</button></div>
    </form>
    <h3>Открыть проект</h3>
    {listing && <p role="status">Чтение проектов…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => { setListing(true); setAttempt(attempt + 1) }}>Повторить чтение</button></div>}
    {!listing && !error && !projects.length && <p>На этом устройстве пока нет проектов.</p>}
    <ul className="project-list">{projects.map((project) => <li key={project.id} className="project-list-row">
      <button type="button" disabled={blocked} aria-label={`Открыть проект «${project.name}»`} onClick={() => onOpen(project.id)}><span>{project.name}</span><small>{project.id === state.project?.id ? 'Текущий проект' : 'Открыть'}</small></button>
      <details className="project-row-menu"><summary aria-label={`Действия проекта «${project.name}»`}>⋯</summary><button type="button" disabled={blocked} onClick={() => onDelete(project)}>Удалить проект</button></details>
    </li>)}</ul>
    <p className="form-hint">Проекты хранятся только в этом браузере на этом устройстве.</p>
  </dialog>
}
