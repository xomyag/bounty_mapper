import { useEffect, useRef } from 'react'
import type { Project } from '../../domain/project'

export function ProjectDeleteDialog({ project, busy, error, onCancel, onDelete }: { project: Project; busy: boolean; error?: string; onCancel: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="project-dialog" aria-label="Удаление проекта" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2>Удалить проект «{project.name}»?</h2>
    <p>Будут безвозвратно удалены его карты, области, размещения маркеров, сущности и вложения. Другие проекты сохранятся.</p>
    {busy && <p role="status">Удаление проекта…</p>}
    {error && <p role="alert" className="form-error">{error} Проект не удалён. Можно повторить действие.</p>}
    <div className="card-actions"><button type="button" disabled={busy} onClick={onCancel}>Отмена</button><button type="button" disabled={busy} onClick={onDelete}>Удалить проект</button></div>
  </dialog>
}
