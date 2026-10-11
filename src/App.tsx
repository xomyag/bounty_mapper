import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
import { RegionSession } from './application/regionSession'
import type { RegionRepository } from './application/regionRepository'
import { IndexedDbRegionRepository } from './storage/indexedDbRegionRepository'
import { RegionCard } from './features/regions/RegionCard'
import { MarkerCard } from './features/markers/MarkerCard'
import { markerTypes } from './domain/marker'
import type { MarkerKind } from './domain/marker'
import { markerIcons } from './features/map/markerIcons'
import { IndexedDbNavigationRepository } from './storage/indexedDbNavigationRepository'
import type { NavigationRepository } from './application/navigationRepository'
import { NavigationSession } from './application/navigationSession'
import { NavigationPanel } from './features/navigation/NavigationPanel'
import { ViewportMemory } from './application/viewportMemory'
import { prepareBitmap } from './features/map/bitmapCache'
import { MapMenu, MapActionDialog } from './features/navigation/MapMenu'
import type { MapAction } from './features/navigation/MapMenu'
import { tagCatalog } from './domain/tags'
import type { ModeRepository } from './application/modeRepository'
import { IndexedDbModeRepository } from './storage/indexedDbModeRepository'

const MapCanvas = lazy(() => import('./features/map/MapCanvas').then((module) => ({ default: module.MapCanvas })))

const defaultRepository = new IndexedDbProjectRepository()
const defaultMapRepository = new IndexedDbMapImageRepository()
const defaultBackupRepository = new IndexedDbProjectBackupRepository()
const defaultRegionRepository = new IndexedDbRegionRepository()
const defaultNavigationRepository = new IndexedDbNavigationRepository()
const defaultModeRepository = new IndexedDbModeRepository()
const statusLabels = {
  idle: 'Проект не открыт', dirty: 'Есть изменения', saving: 'Сохранение…',
  saved: 'Сохранено на устройстве', error: 'Ошибка сохранения',
}

export function App({ repository = defaultRepository, mapRepository = defaultMapRepository, backupRepository = defaultBackupRepository, regionRepository = defaultRegionRepository, navigationRepository = defaultNavigationRepository, modeRepository = defaultModeRepository }: { repository?: ProjectRepository; mapRepository?: MapImageRepository; backupRepository?: ProjectBackupRepository; regionRepository?: RegionRepository; navigationRepository?: NavigationRepository; modeRepository?: ModeRepository }) {
  const [session] = useState(() => new ProjectSession(repository))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [dialog, setDialog] = useState<'projects' | 'edit' | null>(null)
  const [regions] = useState(() => new RegionSession(regionRepository, session, modeRepository))
  const regionState = useSyncExternalStore(regions.subscribe, regions.getSnapshot)
  const preparation = regions.isPreparation()
  const [maps] = useState(() => new MapImageSession(mapRepository, session, prepareImage, regions.isPreparation))
  const mapState = useSyncExternalStore(maps.subscribe, maps.getSnapshot)
  const [navigation] = useState(() => new NavigationSession(navigationRepository, session, regions.isPreparation))
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot)
  const [navigationProject, setNavigationProject] = useState<string>()
  const [mapAction, setMapAction] = useState<MapAction>()
  const [viewports] = useState(() => new ViewportMemory())
  const regionBusy = regions.busy()
  const unsavedDetails = regions.hasUnsavedDetails()
  const detailsSaving = regions.detailsSaving()
  const detailsError = Object.values(regionState.details).find((draft) => draft.phase === 'error')
  const markerError = regionState.markerDraft?.phase === 'error'
  const fileInput = useRef<HTMLInputElement>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
  const [backups] = useState(() => new ProjectBackupSession(session, backupRepository))
  const backupState = useSyncExternalStore(backups.subscribe, backups.getSnapshot)
  const backupBusy = backups.busy()
  const [fitVersion, setFitVersion] = useState(0)
  const [markerPicker, setMarkerPicker] = useState<string>()
  const mapBusy = maps.busy() || regionBusy
  const projectId = state.project?.id
  const openVersion = session.getOpenVersion()
  const navigationKey = projectId ? `${projectId}:${openVersion}` : undefined
  const closeNavigation = () => { setNavigationProject(undefined); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-controls="project-navigation"]')?.focus()) }
  const canWriteImage = preparation && !!state.project && !state.loading && !mapBusy && !unsavedDetails && state.status === 'saved' && mapState.projectId === projectId
  const mapId = mapState.projectId === projectId ? mapState.image.map?.id : undefined
  const cardRegion = regionState.mapId === mapId ? regionState.regions.find((region) => region.id === regionState.cardId) : undefined
  const cardMarker = regionState.mapId === mapId && regionState.markerCardId ? regionState.markerDraft?.marker ?? regionState.markers.find((m) => m.id === regionState.markerCardId) : undefined
  const cardEntity = cardMarker ? regionState.markerDraft?.entity ?? regionState.entities.find((e) => e.id === cardMarker.entityId) : undefined
  const canEditRegion = regions.ready() && !maps.busy() && !backupBusy && regionState.mapId === mapId
  const navigationDisabled = mapBusy || state.loading || backupBusy || session.hasUnsavedChanges() || !!regionState.draft || !!regionState.markerTool || regionState.vertexMode
  const mapWritesDisabled = !preparation || navigationDisabled || unsavedDetails || detailsSaving || navigationState.loading
  const tags = useMemo(() => tagCatalog([...navigationState.data.regions.flatMap((r) => r.tags), ...navigationState.data.entities.flatMap((e) => e.tags)], navigationState.data.tagHistory), [navigationState.data])
  const changeMap = async (name: string) => {
    if (!mapAction || mapWritesDisabled) throw new Error('Сначала завершите текущую операцию и сохраните правки карточки.')
    if (mapAction.kind === 'create') {
      const id = await navigation.createMap(name)
      if (!id) throw new Error(navigation.getSnapshot().error)
      regions.navigate({ mapId: id })
    } else if (mapAction.kind === 'rename') {
      if (!await navigation.renameMap(mapAction.map.id, name)) throw new Error(navigation.getSnapshot().error)
    } else {
      const deletingCurrent = mapAction.map.id === mapId
      const mapsList = navigationState.data.maps
      const index = mapsList.findIndex((m) => m.id === mapAction.map.id)
      const next = [...mapsList.slice(index + 1), ...mapsList.slice(0, index)].find((m) => m.id !== mapAction.map.id)
      // Prepare the replacement before the destructive transaction, so a read or
      // decode error keeps both the stored and the displayed current map intact.
      const prepared = deletingCurrent && next ? await Promise.all([maps.readSelection(next.id), regions.readMap(next.id)]) : undefined
      if (prepared?.[0].background) await prepareBitmap(prepared[0].background.asset)
      if (!await navigation.deleteMap(mapAction.map.id)) throw new Error(navigation.getSnapshot().error)
      if (deletingCurrent) {
        if (next && prepared) { regions.adoptMap({ mapId: next.id }, prepared[1]); maps.adoptSelection(prepared[0]) }
        else { void regions.load(undefined); maps.adoptSelection({}) }
      }
    }
  }
  const startRegion = () => {
    regions.start()
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Карта приключения"]')?.focus())
  }

  useEffect(() => { void session.initialize() }, [session])
  useEffect(() => { void regions.loadMode(projectId) }, [regions, projectId, openVersion])
  useEffect(() => { void maps.load(projectId) }, [maps, projectId, openVersion])
  useEffect(() => { if (regions.getSnapshot().mapId !== mapId) void regions.load(mapId) }, [regions, mapId])
  useEffect(() => { void navigation.load(projectId) }, [navigation, projectId, state.project?.revision, openVersion])
  useEffect(() => { regions.setTagCatalog(tags) }, [regions, tags])
  useEffect(() => regions.subscribe(() => { if (regions.getSnapshot().mode === 'play') setMarkerPicker(undefined) }), [regions])
  useEffect(() => {
    regions.setMapNavigator(async (target) => {
      const originProject = session.getSnapshot().project!.id
      const [image, objects] = await Promise.all([maps.readSelection(target.mapId), regions.readMap(target.mapId)])
      if (image.background) await prepareBitmap(image.background.asset)
      if (session.getSnapshot().project?.id !== originProject) throw new Error('Проект изменился во время перехода.')
      // Prepare data and the decoded background before changing either live
      // session. React commits the destination and its focus together.
      regions.adoptMap(target, objects)
      maps.adoptSelection(image)
    })
  }, [regions, maps, session])
  useEffect(() => {
    if (!regionState.draft || dialog) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); regions.cancel() }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [regions, regionState.draft, dialog])
  useEffect(() => {
    if (state.status !== 'dirty') return
    const timer = window.setTimeout(() => { void session.save() }, 600)
    return () => window.clearTimeout(timer)
  }, [session, state])
  useEffect(() => {
    if (!session.hasUnsavedChanges() && !unsavedDetails && !['uploading', 'saving'].includes(mapState.phase) && regionState.phase !== 'saving' && regionState.modePhase !== 'saving' && regionState.statusAction?.phase !== 'saving' && !backupBusy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session, state.status, mapState.phase, regionState.phase, regionState.modePhase, regionState.statusAction?.phase, backupBusy, unsavedDetails])
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
          <span role="status">{regionState.statusAction?.phase === 'saving' ? 'Сохранение статуса…' : regionState.statusAction?.phase === 'error' ? 'Ошибка сохранения статуса' : regionState.modePhase === 'error' ? 'Ошибка настройки режима' : regionState.transitioning ? 'Открытие карты…' : detailsSaving ? 'Сохранение карточек…' : detailsError || markerError ? 'Ошибка сохранения карточки' : unsavedDetails ? 'Есть изменения в карточках' : regionState.phase === 'saving' ? 'Сохранение объектов карты…' : regionState.phase === 'loading' ? 'Чтение объектов карты…' : regionState.error ? 'Ошибка объектов карты' : backupBusy ? backupState.phase === 'exporting' ? 'Экспорт проекта…' : backupState.phase === 'validating' ? 'Проверка архива…' : 'Сохранение копии…' : mapState.phase === 'error' ? 'Ошибка изображения карты' : mapState.phase === 'uploading' ? 'Загрузка изображения…' : mapState.phase === 'saving' ? 'Сохранение изображения…' : mapState.phase === 'loading' ? 'Чтение карты…' : state.loading ? 'Открытие…' : !state.project && state.error ? 'Ошибка открытия хранилища' : statusLabels[state.status]}</span>
        </div>
        {projectId && <div className="mode-switch" role="group" aria-label="Режим работы"><button type="button" aria-pressed={regionState.mode === 'prepare'} disabled={state.loading || mapBusy || backupBusy || detailsSaving || !!regionState.imagePending || session.hasUnsavedChanges()} onClick={() => regions.requestMode('prepare')}>Подготовка</button><button type="button" aria-pressed={regionState.mode === 'play'} disabled={state.loading || mapBusy || backupBusy || detailsSaving || !!regionState.imagePending || session.hasUnsavedChanges()} onClick={() => regions.requestMode('play')}>Игра</button>{regionState.modePhase === 'loading' && <span role="status">Чтение режима…</span>}{regionState.modePhase === 'saving' && <span role="status">Сохранение режима…</span>}</div>}
        {projectId && <MapMenu key={navigationKey} maps={navigationState.data.maps} currentMapId={mapId} disabled={navigationDisabled || navigationState.loading} writesDisabled={mapWritesDisabled} playing={regionState.mode === 'play'} onNavigate={(id) => regions.navigate({ mapId: id })} onAction={setMapAction} />}
        <nav className="panel-actions" aria-label="Панель управления">
          <button type="button" disabled={state.loading || mapBusy || backupBusy || unsavedDetails} onClick={() => setDialog('projects')}>Проекты</button>
          {state.project && <button type="button" disabled={state.loading || mapBusy || backupBusy || unsavedDetails} onClick={() => setDialog('edit')}>Контекст</button>}
          {state.project && <>
            <input ref={fileInput} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="Файл изображения карты" onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void maps.upload(file)
            }} />
            <button type="button" disabled={!canWriteImage || backupBusy} onClick={() => fileInput.current?.click()}>{mapState.image.background ? 'Заменить изображение' : 'Загрузить карту'}</button>
            <button type="button" disabled={!mapId || mapBusy} onClick={() => setFitVersion((version) => version + 1)}>Показать всю карту</button>
            {mapState.image.background && <button type="button" disabled={!canWriteImage || backupBusy} onClick={() => {
              if (window.confirm('Удалить фоновое изображение? Карта и контекст проекта останутся.')) void maps.remove()
            }}>Удалить изображение</button>}
          </>}
          <button type="button" disabled={!canEditRegion || !!regionState.draft} onClick={startRegion}>Добавить область</button>
          <button type="button" disabled={!canEditRegion || !!regionState.draft} aria-expanded={!!mapId && markerPicker === mapId} onClick={() => setMarkerPicker((current) => current === mapId ? undefined : mapId)}>Добавить маркер</button>
          {regionState.mode === 'prepare' ? <><button type="button" disabled={!canEditRegion || !!regionState.draft || !regionState.canUndo} onClick={() => { void regions.undo() }}>Отменить</button><button type="button" disabled={!canEditRegion || !!regionState.draft || !regionState.canRedo} onClick={() => { void regions.redo() }}>Повторить</button></> : <><button type="button" disabled={mapBusy || state.loading || backupBusy || !regionState.canUndoStatus} onClick={() => { void regions.undoStatus() }}>Отменить статус</button><button type="button" disabled={mapBusy || state.loading || backupBusy || !regionState.canRedoStatus} onClick={() => { void regions.redoStatus() }}>Повторить статус</button></>}
          <button type="button" disabled={!state.project || state.loading || mapBusy || backupBusy || unsavedDetails} onClick={() => { void backups.export(downloadArchive, regions.flushDetails) }}>Экспорт проекта</button>
          <input ref={archiveInput} className="file-input" type="file" accept=".zip,application/zip" aria-label="Архив проекта" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void backups.import(file)
          }} />
          <button type="button" disabled={state.loading || mapBusy || backupBusy || unsavedDetails || session.hasUnsavedChanges()} onClick={() => archiveInput.current?.click()}>Импорт проекта</button>
          <button type="button" disabled={!projectId || state.loading || backupBusy} aria-expanded={!!projectId && navigationProject === navigationKey} aria-controls="project-navigation" onClick={() => { setNavigationProject((current) => current === navigationKey ? undefined : navigationKey); if (navigationProject !== navigationKey) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Поиск объектов"]')?.focus()) }}>Навигация и поиск</button>
        </nav>
      </header>
      {regionState.modeError && <div className="error-banner" role="alert"><span>{regionState.modeError}</span><button type="button" disabled={mapBusy || state.loading || backupBusy} onClick={regions.retryMode}>Повторить выбор режима</button></div>}
      {regionState.statusAction?.phase === 'error' && <div className="error-banner" role="alert"><span>{regionState.statusAction.error} Показан последний сохранённый статус.</span><button type="button" disabled={mapBusy || state.loading || backupBusy || unsavedDetails} onClick={() => { void regions.retryStatus() }}>Повторить смену статуса</button><button type="button" onClick={regions.dismissStatusError}>Закрыть ошибку статуса</button></div>}
      {state.error && (
        <div className="error-banner" role="alert">
          <span>{state.error} {state.project && 'Введённый текст остаётся в открытом проекте.'}</span>
          {state.status === 'error' && <button type="button" disabled={state.loading} onClick={() => { void session.retry() }}>Повторить</button>}
        </div>
      )}
      {mapState.error && <div className="error-banner" role="alert"><span>{mapState.error} Ранее сохранённое изображение не изменено.</span><button type="button" disabled={mapBusy || state.loading} onClick={() => { void maps.retry() }}>Повторить загрузку карты</button></div>}
      {backupState.message && <div className={backupState.phase === 'error' ? 'error-banner' : 'backup-message'}><span role={backupState.phase === 'error' ? 'alert' : 'status'}>{backupState.message}</span><button type="button" onClick={backups.dismiss} aria-label="Закрыть сообщение об архиве">Закрыть</button></div>}
      {regionState.error && <div className="error-banner" role="alert"><span>{regionState.error}</span>{regionState.canRetry && <button type="button" disabled={mapBusy || state.loading || backupBusy} onClick={() => { void regions.retry() }}>{regions.hasLoaded() ? 'Повторить запись объектов карты' : 'Повторить чтение объектов карты'}</button>}<button type="button" disabled={regionBusy || !regions.hasLoaded()} onClick={regions.dismiss}>Закрыть ошибку карты</button></div>}
      <main id="map-workspace" className="map-workspace" aria-label="Рабочая область карты" tabIndex={-1}>
        {projectId && navigationState.projectId === projectId && <div id="project-navigation"><NavigationPanel key={projectId} open={navigationProject === navigationKey} data={navigationState.data} currentMapId={mapId} loading={navigationState.loading} error={navigationState.error} disabled={navigationDisabled} onClose={closeNavigation} onNavigate={regions.navigate} onRetry={() => { void navigation.load() }} /></div>}
        {preparation && mapId && markerPicker === mapId && <div className="marker-type-menu" role="group" aria-label="Тип нового маркера"><strong>Выберите тип маркера</strong>{Object.entries(markerTypes).map(([kind, type]) => <button type="button" key={kind} disabled={!canEditRegion} onClick={() => { regions.startMarker(kind as MarkerKind); setMarkerPicker(undefined); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Карта приключения"]')?.focus()) }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={markerIcons[kind as MarkerKind]} /></svg>{type.label}</button>)}<button type="button" onClick={() => setMarkerPicker(undefined)}>Закрыть выбор типа</button></div>}
        {detailsError && regionState.details[cardRegion?.id ?? '']?.phase !== 'error' && <div className="error-banner details-error-overlay" role="alert"><span>{detailsError.error} Тексты сохранены в черновиках карточек.</span><button type="button" disabled={state.loading || backupBusy} onClick={() => { void regions.saveDetails() }}>Повторить запись карточек</button></div>}
        {mapId && <Suspense fallback={<p className="map-overlay" role="status">Подготовка карты…</p>}><MapCanvas key={projectId} image={mapState.image} fitVersion={fitVersion} regions={regionState} session={regions} editable={canEditRegion} viewports={viewports} /></Suspense>}
        {!mapId && <div className="empty-state">
          <span className="workspace-label">РАБОЧАЯ ОБЛАСТЬ</span>
          <h1>Здесь будет ваша карта</h1>
          <p>{state.project ? 'Загрузите PNG, JPEG или WebP через верхнюю панель.' : 'Создайте или откройте проект в верхней панели.'}</p>
          {state.project && <button type="button" disabled={mapWritesDisabled} onClick={() => setMapAction({ kind: 'create' })}>Создать карту</button>}
        </div>}
        {regionState.draft && <div className="region-draft-tools" role="group" aria-label="Создание области"><span>Вершин: {regionState.draft.length}</span><button type="button" disabled={!canEditRegion} onClick={() => { void regions.finish() }}>Готово</button><button type="button" disabled={regionBusy} onClick={regions.cancel}>Отменить контур</button></div>}
        {regionState.markerTool && <div className="region-draft-tools" role="group" aria-label="Размещение маркера"><span>{markerTypes[regionState.markerTool].label}: укажите место на карте</span><button type="button" onClick={regions.cancelMarkerTool}>Отменить размещение</button></div>}
        {cardRegion && <RegionCard key={cardRegion.id} region={cardRegion} state={regionState} session={regions} disabled={mapBusy || backupBusy || (state.loading && !detailsSaving) || session.hasUnsavedChanges()} geometryDisabled={!canEditRegion} tagCatalog={tags} />}
        {cardMarker && cardEntity && <MarkerCard key={cardMarker.id} entity={cardEntity} marker={cardMarker} state={regionState} session={regions} disabled={mapBusy || backupBusy || (state.loading && !detailsSaving) || session.hasUnsavedChanges()} geometryDisabled={!canEditRegion} tagCatalog={tags} />}
      </main>
      {dialog && <ProjectDialog key={dialog} mode={dialog} repository={repository} session={session} onClose={() => setDialog(null)} onEdit={() => setDialog('edit')} />}
      {mapAction && <MapActionDialog action={mapAction} disabled={mapWritesDisabled} onSubmit={changeMap} onClose={() => { setMapAction(undefined); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.map-menu-trigger')?.focus()) }} />}
    </div>
  )
}
