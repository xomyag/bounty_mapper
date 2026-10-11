import { localize, t } from '../../i18n'
import { useEffect, useRef } from 'react'
import type { Project } from '../../domain/project'

export function ProjectDeleteDialog({ project, busy, error, onCancel, onDelete }: { project: Project; busy: boolean; error?: string; onCancel: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="project-dialog" aria-label={t("ui.delete.project")} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2>{t('project.deleteConfirm', { name: project.name })}</h2>
    <p>{t("ui.its.maps.regions.marker.placements.entities.and.attachments.will")}</p>
    {busy && <p role="status">{t("ui.deleting.project")}</p>}
    {error && <p role="alert" className="form-error">{localize(error)}  {t("ui.the.project.was.not.deleted.you.can.try.again")}</p>}
    <div className="card-actions"><button type="button" disabled={busy} onClick={onCancel}>{t("ui.cancel")}</button><button type="button" disabled={busy} onClick={onDelete}>{t("ui.delete.project.b8d719")}</button></div>
  </dialog>
}
