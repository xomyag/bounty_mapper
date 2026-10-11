import { localize, message as deferredMessage, t } from '../../i18n'
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
    repository.list().then((items) => { if (active) { setProjects(items); setError(''); setListing(false) } }).catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : deferredMessage("ui.could.not.read.projects")); setListing(false) } })
    return () => { active = false }
  }, [repository, attempt])
  const blocked = state.loading || session.hasUnsavedChanges()
  return <dialog ref={ref} className="project-dialog" aria-labelledby="project-dialog-title" onCancel={onClose} onClose={onClose}>
    <div className="dialog-heading"><h2 id="project-dialog-title">{t("ui.local.projects")}</h2><button type="button" onClick={onClose} aria-label={t("ui.close.project.dialog")}>{t("ui.close")}</button></div>
    {message && <p role="status">{localize(message)}</p>}
    {state.error && <p className="form-error" role="alert">{localize(state.error)}</p>}
    <form onSubmit={(event) => { event.preventDefault(); onCreate(name) }}>
      <label htmlFor="new-project-name">{t("ui.new.project.name")}</label>
      <div className="create-project-row"><input id="new-project-name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus /><button type="submit" disabled={blocked || !name.trim()}>{t("ui.create")}</button></div>
    </form>
    <h3>{t("ui.open.project")}</h3>
    {listing && <p role="status">{t("ui.reading.projects")}</p>}
    {error && <div role="alert"><p>{localize(error)}</p><button type="button" onClick={() => { setListing(true); setAttempt(attempt + 1) }}>{t("ui.retry.reading")}</button></div>}
    {!listing && !error && !projects.length && <p>{t("ui.no.projects.on.this.device.yet")}</p>}
    <ul className="project-list">{projects.map((project) => <li key={project.id} className="project-list-row">
      <button type="button" disabled={blocked} aria-label={t("ui.open.project.value", { p0: project.name })} onClick={() => onOpen(project.id)}><span>{project.name}</span><small>{localize(project.id === state.project?.id ? deferredMessage("ui.current.project") : deferredMessage("ui.open"))}</small></button>
      <details className="project-row-menu"><summary aria-label={t("ui.actions.for.project.value", { p0: project.name })}>⋯</summary><button type="button" disabled={blocked} onClick={() => onDelete(project)}>{t("ui.delete.project.b8d719")}</button></details>
    </li>)}</ul>
    <p className="form-hint">{t("ui.projects.are.stored.only.in.this.browser.on.this")}</p>
  </dialog>
}
