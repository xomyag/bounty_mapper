import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ProjectSession } from './application/projectSession'
import type { ProjectRepository } from './application/projectRepository'
import { IndexedDbProjectRepository } from './storage/indexedDbProjectRepository'
import { ProjectDialog } from './features/projects/ProjectDialog'
import { MapImageSession } from './application/mapImageSession'
import type { MapImageRepository } from './application/mapImageRepository'
import { IndexedDbMapImageRepository } from './storage/indexedDbMapImageRepository'
import { prepareImage } from './features/map/prepareImage'
import { ProjectBackupSession } from './application/projectBackupSession'
import { IndexedDbProjectBackupRepository } from './storage/indexedDbProjectBackupRepository'
import type { ProjectBackupRepository } from './application/projectBackupRepository'
import { downloadArchive } from './features/projects/downloadArchive'

const MapCanvas = lazy(() => import('./features/map/MapCanvas').then((module) => ({ default: module.MapCanvas })))

const defaultRepository = new IndexedDbProjectRepository()
const defaultMapRepository = new IndexedDbMapImageRepository()
const defaultBackupRepository = new IndexedDbProjectBackupRepository()
const statusLabels = {
  idle: 'Проект не открыт', dirty: 'Есть изменения', saving: 'Сохранение…',
  saved: 'Сохранено на устройстве', error: 'Ошибка сохранения',
}

export function App({ repository = defaultRepository, mapRepository = defaultMapRepository, backupRepository = defaultBackupRepository }: { repository?: ProjectRepository; mapRepository?: MapImageRepository; backupRepository?: ProjectBackupRepository }) {
  const [session] = useState(() => new ProjectSession(repository))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [dialog, setDialog] = useState<'projects' | 'edit' | null>(null)
  const [maps] = useState(() => new MapImageSession(mapRepository, session, prepareImage))
  const mapState = useSyncExternalStore(maps.subscribe, maps.getSnapshot)
  const fileInput = useRef<HTMLInputElement>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
  const [backups] = useState(() => new ProjectBackupSession(session, backupRepository))
  const backupState = useSyncExternalStore(backups.subscribe, backups.getSnapshot)
  const backupBusy = backups.busy()
  const [fitVersion, setFitVersion] = useState(0)
  const mapBusy = maps.busy()
  const projectId = state.project?.id
  const canWriteImage = !!state.project && !state.loading && !mapBusy && state.status === 'saved' && mapState.projectId === projectId

  useEffect(() => { void session.initialize() }, [session])
  useEffect(() => { void maps.load(projectId) }, [maps, projectId])
  useEffect(() => {
    if (state.status !== 'dirty') return
    const timer = window.setTimeout(() => { void session.save() }, 600)
    return () => window.clearTimeout(timer)
  }, [session, state])
  useEffect(() => {
    if (!session.hasUnsavedChanges() && !['uploading', 'saving'].includes(mapState.phase) && !backupBusy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session, state.status, mapState.phase, backupBusy])
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
          <span role="status">{backupBusy ? backupState.phase === 'exporting' ? 'Экспорт проекта…' : backupState.phase === 'validating' ? 'Проверка архива…' : 'Сохранение копии…' : mapState.phase === 'error' ? 'Ошибка изображения карты' : mapState.phase === 'uploading' ? 'Загрузка изображения…' : mapState.phase === 'saving' ? 'Сохранение изображения…' : mapState.phase === 'loading' ? 'Чтение карты…' : state.loading ? 'Открытие…' : !state.project && state.error ? 'Ошибка открытия хранилища' : statusLabels[state.status]}</span>
        </div>
        <nav className="panel-actions" aria-label="Панель управления">
          <button type="button" disabled={state.loading || mapBusy || backupBusy} onClick={() => setDialog('projects')}>Проекты</button>
          {state.project && <button type="button" disabled={state.loading || mapBusy || backupBusy} onClick={() => setDialog('edit')}>Контекст</button>}
          {state.project && <>
            <input ref={fileInput} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="Файл изображения карты" onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void maps.upload(file)
            }} />
            <button type="button" disabled={!canWriteImage || backupBusy} onClick={() => fileInput.current?.click()}>{mapState.image.background ? 'Заменить изображение' : 'Загрузить карту'}</button>
            <button type="button" disabled={!mapState.image.background || mapBusy} onClick={() => setFitVersion((version) => version + 1)}>Показать всю карту</button>
            {mapState.image.background && <button type="button" disabled={!canWriteImage || backupBusy} onClick={() => {
              if (window.confirm('Удалить фоновое изображение? Карта и контекст проекта останутся.')) void maps.remove()
            }}>Удалить изображение</button>}
          </>}
          <button type="button" disabled={!state.project || state.loading || mapBusy || backupBusy} onClick={() => { void backups.export(downloadArchive) }}>Экспорт проекта</button>
          <input ref={archiveInput} className="file-input" type="file" accept=".zip,application/zip" aria-label="Архив проекта" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void backups.import(file)
          }} />
          <button type="button" disabled={state.loading || mapBusy || backupBusy || session.hasUnsavedChanges()} onClick={() => archiveInput.current?.click()}>Импорт проекта</button>
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
      {mapState.error && <div className="error-banner" role="alert"><span>{mapState.error} Ранее сохранённое изображение не изменено.</span><button type="button" disabled={mapBusy || state.loading} onClick={() => { void maps.retry() }}>Повторить загрузку карты</button></div>}
      {backupState.message && <div className={backupState.phase === 'error' ? 'error-banner' : 'backup-message'}><span role={backupState.phase === 'error' ? 'alert' : 'status'}>{backupState.message}</span><button type="button" onClick={backups.dismiss} aria-label="Закрыть сообщение об архиве">Закрыть</button></div>}
      <main id="map-workspace" className="map-workspace" aria-label="Рабочая область карты" tabIndex={-1}>
        {mapState.image.background && <Suspense fallback={<p className="map-overlay" role="status">Подготовка карты…</p>}><MapCanvas key={projectId} image={mapState.image} fitVersion={fitVersion} /></Suspense>}
        {!mapState.image.background && <div className="empty-state">
          <span className="workspace-label">РАБОЧАЯ ОБЛАСТЬ</span>
          <h1>Здесь будет ваша карта</h1>
          <p>{state.project ? 'Загрузите PNG, JPEG или WebP через верхнюю панель.' : 'Создайте или откройте проект в верхней панели.'}</p>
        </div>}
      </main>
      {dialog && <ProjectDialog key={dialog} mode={dialog} repository={repository} session={session} onClose={() => setDialog(null)} onEdit={() => setDialog('edit')} />}
    </div>
  )
}
