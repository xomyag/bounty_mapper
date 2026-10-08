import { useEffect, useState, useSyncExternalStore } from 'react'
import { ProjectSession } from './application/projectSession'
import type { ProjectRepository } from './application/projectRepository'
import { IndexedDbProjectRepository } from './storage/indexedDbProjectRepository'
import { ProjectDialog } from './features/projects/ProjectDialog'

const defaultRepository = new IndexedDbProjectRepository()
const statusLabels = {
  idle: 'Проект не открыт', dirty: 'Есть изменения', saving: 'Сохранение…',
  saved: 'Сохранено на устройстве', error: 'Ошибка сохранения',
}

export function App({ repository = defaultRepository }: { repository?: ProjectRepository }) {
  const [session] = useState(() => new ProjectSession(repository))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [dialog, setDialog] = useState<'projects' | 'edit' | null>(null)

  useEffect(() => { void session.initialize() }, [session])
  useEffect(() => {
    if (state.status !== 'dirty') return
    const timer = window.setTimeout(() => { void session.save() }, 600)
    return () => window.clearTimeout(timer)
  }, [session, state])
  useEffect(() => {
    if (!session.hasUnsavedChanges()) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session, state.status])
  return (
    <div className="app-shell">
      <header className="control-panel">
        <a className="brand" href="#map-workspace" aria-label="Bounty Mapper — к рабочей области">
          <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
          <span>Bounty <strong>Mapper</strong></span>
        </a>
        <div className="project-state">
          {state.project && <span className="project-name" title={state.project.name}>{state.project.name}</span>}
          <span role="status">{state.loading ? 'Открытие…' : !state.project && state.error ? 'Ошибка открытия хранилища' : statusLabels[state.status]}</span>
        </div>
        <nav className="panel-actions" aria-label="Панель управления">
          <button type="button" disabled={state.loading} onClick={() => setDialog('projects')}>Проекты</button>
          {state.project && <button type="button" disabled={state.loading} onClick={() => setDialog('edit')}>Контекст</button>}
          <button type="button" disabled title="Навигация станет доступна после добавления объектов">
            Навигация
          </button>
        </nav>
      </header>
      {state.error && (
        <div className="error-banner" role="alert">
          <span>{state.error} {state.project && 'Введённый текст остаётся в открытом проекте.'}</span>
          {state.status === 'error' && <button type="button" disabled={state.loading} onClick={() => { void session.retry() }}>Повторить</button>}
        </div>
      )}
      <main id="map-workspace" className="map-workspace" aria-label="Рабочая область карты" tabIndex={-1}>
        <div className="empty-state">
          <span className="workspace-label">РАБОЧАЯ ОБЛАСТЬ</span>
          <h1>Здесь будет ваша карта</h1>
          <p>{state.project ? 'Контекст приключения доступен в верхней панели.' : 'Создайте или откройте проект в верхней панели.'}</p>
        </div>
      </main>
      {dialog && <ProjectDialog key={dialog} mode={dialog} repository={repository} session={session} onClose={() => setDialog(null)} onEdit={() => setDialog('edit')} />}
    </div>
  )
}
