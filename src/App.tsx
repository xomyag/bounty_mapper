import { localize, message, t } from './i18n'
import { useLanguage } from './i18n/useLanguage'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { CardLayoutSession, clampCardWidth } from './application/cardLayoutSession'
import { IndexedDbCardWidthRepository } from './storage/indexedDbCardWidthRepository'
import { CardResizer } from './features/controls/CardResizer'
import { ProjectSession } from './application/projectSession'
import type { ProjectRepository } from './application/projectRepository'
import { IndexedDbProjectRepository } from './storage/indexedDbProjectRepository'
import { ProjectDialog } from './features/projects/ProjectDialog'
import { InformationCard } from './features/projects/InformationCard'
import { ProjectDeleteDialog } from './features/projects/ProjectDeleteDialog'
import type { Project } from './domain/project'
import type { InformationRepository } from './application/informationRepository'
import { IndexedDbInformationRepository } from './storage/indexedDbInformationRepository'
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
import { BrowserProjectAccess } from './features/projects/browserProjectAccess'
import { OfflineSession } from './offline/offlineSession'
import { projectLocksEnabled } from './application/features'
import { ProjectMenu } from './features/controls/ProjectMenu'
import { IconButton } from './features/controls/IconButton'
import { Info, Search, Pentagon, MapPinPlus, Undo2, Redo2, ZoomIn, ZoomOut, Maximize } from 'lucide-react'

const MapCanvas = lazy(() => import('./features/map/MapCanvas').then((module) => ({ default: module.MapCanvas })))

const defaultInformationRepository = new IndexedDbInformationRepository()
const defaultRepository = new IndexedDbProjectRepository()
const defaultMapRepository = new IndexedDbMapImageRepository()
const defaultBackupRepository = new IndexedDbProjectBackupRepository()
const defaultRegionRepository = new IndexedDbRegionRepository()
const defaultNavigationRepository = new IndexedDbNavigationRepository()
const defaultModeRepository = new IndexedDbModeRepository()
const statusLabels = {
  idle: message("ui.no.project.open"), dirty: message("ui.unsaved.changes"), saving: message("ui.saving"),
  saved: message("ui.saved.on.this.device"), error: message("ui.save.failed"),
}

export function App({ repository = defaultRepository, mapRepository = defaultMapRepository, backupRepository = defaultBackupRepository, regionRepository = defaultRegionRepository, navigationRepository = defaultNavigationRepository, modeRepository = defaultModeRepository, informationRepository = defaultInformationRepository }: { repository?: ProjectRepository; mapRepository?: MapImageRepository; backupRepository?: ProjectBackupRepository; regionRepository?: RegionRepository; navigationRepository?: NavigationRepository; modeRepository?: ModeRepository; informationRepository?: InformationRepository }) {
  useLanguage()
  const [cardLayout] = useState(() => new CardLayoutSession(new IndexedDbCardWidthRepository()))
  const layout = useSyncExternalStore(cardLayout.subscribe, cardLayout.getSnapshot)
  const workspace = useRef<HTMLElement>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(window.innerWidth)
  useEffect(() => { void cardLayout.initialize(); const observer = new ResizeObserver(() => { if (workspace.current) setWorkspaceWidth(workspace.current.clientWidth) }); if (workspace.current) observer.observe(workspace.current); return () => observer.disconnect() }, [cardLayout])
  const cardWidth = clampCardWidth(layout.width, workspaceWidth)
  const [session] = useState(() => new ProjectSession(repository, projectLocksEnabled ? new BrowserProjectAccess() : undefined))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [dialog, setDialog] = useState<'projects' | null>(null)
  const [regions] = useState(() => new RegionSession(regionRepository, session, modeRepository, informationRepository))
  const [deleteProject, setDeleteProject] = useState<Project>()
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const [deleteError, setDeleteError] = useState<string>()
  const [projectMessage, setProjectMessage] = useState<string>()
  const confirmDelete = () => {
    if (!deleteProject || deletingRef.current) return
    const target = deleteProject
    const run = async () => {
      deletingRef.current = true; setDeleting(true); setDeleteError(undefined)
      try { await session.remove(target); setDeleteProject(undefined); setProjectMessage(message("ui.project.value.deleted", { p0: target.name })); setDialog('projects') }
      catch (error) { setDeleteError(error instanceof Error ? error.message : message("ui.could.not.delete.the.project")) }
      finally { deletingRef.current = false; setDeleting(false) }
    }
    if (target.id === session.getSnapshot().project?.id) regions.afterDetails(run, () => setDeleteProject(undefined))
    else void run()
  }
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
  const informationError = regionState.information?.draft?.phase === 'error'
  const creatingProject = regionState.information?.kind === 'new-project'
  const markerError = regionState.markerDraft?.phase === 'error'
  const fileInput = useRef<HTMLInputElement>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
  const [backups] = useState(() => new ProjectBackupSession(session, backupRepository))
  const backupState = useSyncExternalStore(backups.subscribe, backups.getSnapshot)
  const [offline] = useState(() => new OfflineSession(() => !session.getSnapshot().loading && !session.hasUnsavedChanges() && !regions.hasUnsavedDetails() && !regions.busy() && !maps.busy() && !backups.busy() && !regions.getSnapshot().draft && !regions.getSnapshot().markerTool && !regions.getSnapshot().vertexMode))
  const offlineState = useSyncExternalStore(offline.subscribe, offline.getSnapshot)
  const backupBusy = backups.busy() || offlineState.phase === 'applying'
  const updateBlocked = state.loading || (maps.busy() || regions.busy()) || backups.busy() || unsavedDetails || session.hasUnsavedChanges() || !!regionState.draft || !!regionState.markerTool || regionState.vertexMode
  const lifecycle = useRef({ generation: 0 })
  const [fitVersion, setFitVersion] = useState(0)
  const [zoomCommand, setZoomCommand] = useState({ version: 0, factor: 1 })
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
  const cardOpen = !!(cardRegion || cardMarker || regionState.information)
  const canEditRegion = regions.ready() && !maps.busy() && !backupBusy && regionState.mapId === mapId
  const regionDragAllowed = preparation && !mapBusy && !backupBusy && !state.loading && !session.hasUnsavedChanges() && regionState.mapId === mapId
  const navigationDisabled = mapBusy || state.loading || backupBusy || session.hasUnsavedChanges() || !!regionState.draft || !!regionState.markerTool || regionState.vertexMode
  const mapWritesDisabled = !preparation || navigationDisabled || unsavedDetails || detailsSaving || navigationState.loading
  const tags = useMemo(() => tagCatalog([...navigationState.data.regions.flatMap((r) => r.tags), ...navigationState.data.entities.flatMap((e) => e.tags)], navigationState.data.tagHistory), [navigationState.data])
  const changeMap = async (name: string) => {
    if (!mapAction || mapWritesDisabled) throw new Error(message("ui.finish.the.current.operation.and.save.the.card.changes"))
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
        if (next && prepared) { regions.adoptMap({ mapId: next.id }, { ...prepared[1], map: prepared[0].map }); maps.adoptSelection(prepared[0]) }
        else { void regions.load(undefined); maps.adoptSelection({}) }
      }
    }
  }
  const refreshForEditing = async () => {
    const index = await navigationRepository.load(projectId!)
    // Reacquisition starts a fresh editing session, including status undo and mode.
    await regions.loadMode(projectId)
    const targetId = index.maps.find((m) => m.id === mapId)?.id ?? index.maps[0]?.id
    if (!targetId) { void regions.load(undefined); maps.adoptSelection({}); return }
    const [image, objects] = await Promise.all([maps.readSelection(targetId), regions.readMap(targetId)])
    if (image.background) await prepareBitmap(image.background.asset)
    regions.adoptMap({ mapId: targetId }, { ...objects, map: image.map }); maps.adoptSelection(image)
  }
  const startRegion = () => {
    regions.start()
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-map-canvas]')?.focus())
  }

  useEffect(() => {
    const lifetime = lifecycle.current
    const generation = ++lifetime.generation
    void session.initialize(); void offline.initialize(import.meta.env.PROD)
    return () => { queueMicrotask(() => { if (lifetime.generation === generation) { session.dispose(); offline.dispose() } }) }
  }, [session, offline])
  useEffect(() => { void regions.loadMode(projectId) }, [regions, projectId, openVersion])
  useEffect(() => { void maps.load(projectId) }, [maps, projectId, openVersion])
  useEffect(() => { const current = regions.getSnapshot(); if (current.mapId !== mapId || current.information && current.information.projectId !== projectId) void regions.load(mapId) }, [regions, mapId, projectId])
  useEffect(() => { void navigation.load(projectId) }, [navigation, projectId, state.project?.revision, openVersion])
  useEffect(() => { regions.setTagCatalog(tags) }, [regions, tags])
  useEffect(() => regions.subscribe(() => { if (regions.getSnapshot().mode === 'play') setMarkerPicker(undefined) }), [regions])
  useEffect(() => {
    regions.setMapNavigator(async (target) => {
      const originProject = session.getSnapshot().project!.id
      const [image, objects] = await Promise.all([maps.readSelection(target.mapId), regions.readMap(target.mapId)])
      if (image.background) await prepareBitmap(image.background.asset)
      if (session.getSnapshot().project?.id !== originProject) throw new Error(message("ui.the.project.changed.during.navigation"))
      // Prepare data and the decoded background before changing either live
      // session. React commits the destination and its focus together.
      regions.adoptMap(target, { ...objects, map: image.map })
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
    if (!session.hasUnsavedChanges() && !unsavedDetails && !['uploading', 'saving'].includes(mapState.phase) && regionState.phase !== 'saving' && regionState.modePhase !== 'saving' && regionState.statusAction?.phase !== 'saving' && !backups.busy()) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [session, state.status, mapState.phase, regionState.phase, regionState.modePhase, regionState.statusAction?.phase, backups, backupState.phase, unsavedDetails])
  return (
    <div className="app-shell">
      <header className="control-panel">
        <ProjectMenu disabled={state.loading || mapBusy || backupBusy || creatingProject} importDisabled={state.loading || mapBusy || backupBusy || unsavedDetails || session.hasUnsavedChanges()} exportDisabled={!projectId || state.loading || mapBusy || backupBusy || unsavedDetails} onProjects={() => setDialog('projects')} onImport={() => archiveInput.current?.click()} onExport={() => { void backups.export(downloadArchive, regions.flushDetails) }}>
          {offlineState.phase !== 'disabled' && <section className="offline-menu" aria-label={t("ui.offline.startup")}><p>{localize(offlineState.message)}</p><button type="button" role="menuitem" disabled={offlineState.phase === 'applying'} onClick={() => { void offline.checkUpdate() }}>{localize(offlineState.phase === 'error' ? message("ui.retry.offline.setup") : message("ui.check.for.updates"))}</button>{offlineState.updateAvailable && <><button type="button" role="menuitem" disabled={updateBlocked || offlineState.phase === 'applying'} onClick={offline.applyUpdate}>{t("ui.apply.update")}</button>{updateBlocked && <p>{t("ui.save.or.discard.changes.and.finish.the.active.tool")}</p>}</>}</section>}
        </ProjectMenu>
        <div className="project-summary"><div className="project-state"><span className="project-name" title={state.project?.name}>{localize(state.project?.name ?? 'Bounty Mapper')}</span>
          <span role="status">{localize(regionState.statusAction?.phase === 'saving' ? message("ui.saving.status") : regionState.statusAction?.phase === 'error' ? message("ui.status.save.failed") : regionState.modePhase === 'error' ? message("ui.mode.setting.failed") : regionState.transitioning ? message("ui.opening.map") : detailsSaving ? message("ui.saving.cards") : detailsError || markerError || informationError ? message("ui.card.save.failed") : unsavedDetails ? message("ui.unsaved.card.changes") : regionState.phase === 'saving' ? message("ui.saving.map.objects") : regionState.phase === 'loading' ? message("ui.reading.map.objects") : regionState.error ? message("ui.map.object.error") : offlineState.phase === 'applying' ? message("ui.applying.update") : backupBusy ? backupState.phase === 'exporting' ? message("ui.exporting.project") : backupState.phase === 'validating' ? message("ui.validating.archive") : message("ui.saving.copy") : mapState.phase === 'error' ? message("ui.map.image.error") : mapState.phase === 'uploading' ? message("ui.loading.image") : mapState.phase === 'saving' ? message("ui.saving.image") : mapState.phase === 'loading' ? message("ui.reading.map") : state.loading ? message("ui.opening") : !state.project && state.error ? message("ui.could.not.open.storage") : statusLabels[state.status])}</span>
          {offlineState.phase !== 'disabled' && <span className="offline-status">{localize(offlineState.phase === 'ready' ? message("ui.ready.to.work.offline") : offlineState.phase === 'loading' ? message("ui.preparing.offline.startup") : offlineState.phase === 'applying' ? message("ui.applying.update") : offlineState.message)}</span>}
        </div>
        {projectId && <IconButton icon={Info} label={t("ui.adventure.context")} disabled={state.loading || mapBusy || backupBusy || creatingProject} onClick={() => regions.openInformation()} />}
        </div>
        {projectId && <div className="mode-switch" role="group" aria-label={t("ui.workspace.mode")}><button type="button" aria-pressed={preparation} disabled={state.readOnly || state.loading || mapBusy || backupBusy || detailsSaving || !!regionState.imagePending || session.hasUnsavedChanges()} onClick={() => regions.requestMode('prepare')}>{t("ui.preparation")}</button><button type="button" aria-pressed={!preparation} disabled={state.readOnly || state.loading || mapBusy || backupBusy || detailsSaving || !!regionState.imagePending || session.hasUnsavedChanges()} onClick={() => regions.requestMode('play')}>{t("ui.play")}</button></div>}
        <IconButton icon={Search} label={t("ui.navigation.and.search")} disabled={!projectId || state.loading || backupBusy} aria-expanded={!!projectId && navigationProject === navigationKey} aria-controls="project-navigation" onClick={() => { setNavigationProject((current) => current === navigationKey ? undefined : navigationKey); if (navigationProject !== navigationKey) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-navigation-search]')?.focus()) }} />
        {mapId && <IconButton icon={Info} label={t("ui.map.description")} disabled={state.loading || mapBusy || backupBusy || creatingProject} onClick={() => regions.openInformation(mapId)} />}
        {projectId && <MapMenu key={navigationKey} maps={navigationState.data.maps} currentMapId={mapId} disabled={navigationDisabled || navigationState.loading} writesDisabled={mapWritesDisabled} playing={!preparation} onNavigate={(id) => regions.navigate({ mapId: id })} onAction={setMapAction} imageDisabled={!canWriteImage || backupBusy} hasImage={!!mapState.image.background} onUpload={() => fileInput.current?.click()} onRemoveImage={() => { const name = navigationState.data.maps.find((map) => map.id === mapId)?.name ?? ''; if (window.confirm(t("ui.delete.the.background.image.of.map.value.the.map", { p0: name }))) void maps.remove() }} />}
      </header>
      <input ref={fileInput} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label={t("ui.map.image.file")} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void maps.upload(file) }} />
      <input ref={archiveInput} className="file-input" type="file" accept=".zip,application/zip" aria-label={t("ui.project.archive")} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void backups.import(file) }} />
      {projectLocksEnabled && projectId && <div className="access-banner" role="status"><span>{localize(state.accessMessage)}</span>{state.readOnly ? <button type="button" disabled={state.loading || mapBusy || backupBusy || unsavedDetails} onClick={() => { void session.requestEditing(refreshForEditing) }}>{t("ui.acquire.editing.access")}</button> : <button type="button" disabled={state.loading || mapBusy || backupBusy || unsavedDetails || session.hasUnsavedChanges() || !!regionState.draft || !!regionState.markerTool || regionState.vertexMode} onClick={() => { void session.releaseEditing() }}>{t("ui.release.editing.access")}</button>}</div>}
      {regionState.modeError && <div className="error-banner" role="alert"><span>{localize(regionState.modeError)}</span><button type="button" disabled={state.readOnly || mapBusy || state.loading || backupBusy} onClick={regions.retryMode}>{t("ui.retry.mode.selection")}</button></div>}
      {regionState.statusAction?.phase === 'error' && <div className="error-banner" role="alert"><span>{localize(regionState.statusAction.error)}  {t("ui.the.last.saved.status.is.shown")}</span><button type="button" disabled={state.readOnly || mapBusy || state.loading || backupBusy || unsavedDetails} onClick={() => { void regions.retryStatus() }}>{t("ui.retry.status.change")}</button><button type="button" onClick={regions.dismissStatusError}>{t("ui.dismiss.status.error")}</button></div>}
      {state.error && (
        <div className="error-banner" role="alert">
          <span>{localize(state.error)} {localize(state.project && message("ui.your.text.remains.in.the.open.project"))}</span>
          {state.status === 'error' && <button type="button" disabled={state.loading} onClick={() => { void session.retry() }}>{t("ui.retry")}</button>}
        </div>
      )}
      {mapState.error && <div className="error-banner" role="alert"><span>{localize(mapState.error)}  {t("ui.the.previously.saved.image.has.not.changed")}</span><button type="button" disabled={mapBusy || state.loading} onClick={() => { void maps.retry() }}>{t("ui.retry.map.upload")}</button></div>}
      {backupState.message && <div className={backupState.phase === 'error' ? 'error-banner' : 'backup-message'}><span role={backupState.phase === 'error' ? 'alert' : 'status'}>{localize(backupState.message)}</span><button type="button" onClick={backups.dismiss} aria-label={t("ui.dismiss.archive.message")}>{t("ui.close")}</button></div>}
      {regionState.error && <div className="error-banner" role="alert"><span>{localize(regionState.error)}</span>{regionState.canRetry && <button type="button" disabled={mapBusy || state.loading || backupBusy} onClick={() => { void regions.retry() }}>{localize(regions.hasLoaded() ? message("ui.retry.saving.map.objects") : message("ui.retry.reading.map.objects"))}</button>}<button type="button" disabled={regionBusy || !regions.hasLoaded()} onClick={regions.dismiss}>{t("ui.dismiss.map.error")}</button></div>}
      {layout.phase === 'error' && <div className="error-banner" role="alert"><span>{localize(layout.error)}</span><button type="button" onClick={() => { void cardLayout.save() }}>{t("ui.retry.saving.width")}</button></div>}
      <main ref={workspace} style={{ '--card-width': cardWidth + 'px' } as CSSProperties} id="map-workspace" className={`map-workspace ${navigationProject === navigationKey && projectId ? 'search-open' : ''} ${cardOpen ? 'card-open' : ''} ${workspaceWidth - (navigationProject === navigationKey && projectId ? 354 : 12) - (cardOpen ? cardWidth + 24 : 12) < 250 ? 'controls-strips' : ''}`} aria-label={t("ui.map.workspace")} tabIndex={-1}>
        <div className="workspace-controls creation-controls" role="group" aria-label={t("ui.create.objects")}>
          <IconButton icon={Pentagon} label={t("ui.add.region")} disabled={!canEditRegion || !!regionState.draft} onClick={startRegion} />
          <IconButton icon={MapPinPlus} label={t("ui.add.marker")} disabled={!canEditRegion || !!regionState.draft} aria-expanded={!!mapId && markerPicker === mapId} onClick={() => setMarkerPicker((current) => current === mapId ? undefined : mapId)} />
        </div>
        <div className="workspace-controls history-controls" role="group" aria-label={t("ui.change.history")}>
          {preparation ? <><IconButton icon={Undo2} label={t("ui.undo")} disabled={!(regionDragAllowed && regions.canUndoDraftGeometry()) && (!canEditRegion || !!regionState.draft || !regionState.canUndo)} onClick={() => { void regions.undo() }} /><IconButton icon={Redo2} label={t("ui.redo")} disabled={!(regionDragAllowed && regions.canRedoDraftGeometry()) && (!canEditRegion || !!regionState.draft || !regionState.canRedo)} onClick={() => { void regions.redo() }} /></> : <><IconButton icon={Undo2} label={t("ui.undo.status")} disabled={state.readOnly || mapBusy || state.loading || backupBusy || !regionState.canUndoStatus} onClick={() => { void regions.undoStatus() }} /><IconButton icon={Redo2} label={t("ui.redo.status")} disabled={state.readOnly || mapBusy || state.loading || backupBusy || !regionState.canRedoStatus} onClick={() => { void regions.redoStatus() }} /></>}
        </div>
        <div className="workspace-controls camera-controls" role="group" aria-label={t("ui.map.zoom")}>
          <IconButton icon={ZoomOut} label={t("ui.zoom.out")} disabled={!mapId || mapBusy} onClick={() => setZoomCommand((current) => ({ version: current.version + 1, factor: 1 / 1.25 }))} />
          <IconButton icon={ZoomIn} label={t("ui.zoom.in")} disabled={!mapId || mapBusy} onClick={() => setZoomCommand((current) => ({ version: current.version + 1, factor: 1.25 }))} />
          <IconButton icon={Maximize} label={t("ui.fit.entire.map")} disabled={!mapId || mapBusy} onClick={() => setFitVersion((version) => version + 1)} />
        </div>
        {projectId && navigationState.projectId === projectId && <div id="project-navigation"><NavigationPanel key={projectId} open={navigationProject === navigationKey} data={navigationState.data} currentMapId={mapId} loading={navigationState.loading} error={navigationState.error} disabled={navigationDisabled} onClose={closeNavigation} onNavigate={regions.navigate} onRetry={() => { void navigation.load() }} /></div>}
        {preparation && mapId && markerPicker === mapId && <div className="marker-type-menu" role="group" aria-label={t("ui.new.marker.type")}><strong>{t("ui.choose.a.marker.type")}</strong>{Object.entries(markerTypes).map(([kind, type]) => <button type="button" key={kind} disabled={!canEditRegion} onClick={() => { regions.startMarker(kind as MarkerKind); setMarkerPicker(undefined); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-map-canvas]')?.focus()) }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={markerIcons[kind as MarkerKind]} /></svg>{localize(type.label)}</button>)}<button type="button" onClick={() => setMarkerPicker(undefined)}>{t("ui.close.type.picker")}</button></div>}
        {detailsError && regionState.details[cardRegion?.id ?? '']?.phase !== 'error' && <div className="error-banner details-error-overlay" role="alert"><span>{localize(detailsError.error)}  {t("ui.text.is.preserved.in.the.card.drafts")}</span><button type="button" disabled={state.loading || backupBusy} onClick={() => { void regions.saveDetails() }}>{t("ui.retry.saving.cards")}</button></div>}
        {mapId && <Suspense fallback={<p className="map-overlay" role="status">{t("ui.preparing.map")}</p>}><MapCanvas key={projectId} image={mapState.image} fitVersion={fitVersion} zoomCommand={zoomCommand} regionDragAllowed={regionDragAllowed} regions={regionState} session={regions} editable={canEditRegion} viewports={viewports} /></Suspense>}
        {mapId && !mapState.image.background && <div className="map-image-empty-state" role="region" aria-label={t(preparation ? 'empty.addImageTitle' : 'empty.playNoImage')}>
          <h2>{t(preparation ? 'empty.addImageTitle' : 'empty.playNoImage')}</h2>
          {preparation && <><p>{t('empty.imageFormats')}</p><button type="button" disabled={!canWriteImage || mapBusy || backupBusy} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); fileInput.current?.click() }}>{t('empty.addImageAction')}</button></>}
        </div>}
        {!mapId && <div className="empty-state">
          <span className="workspace-label">{t("ui.workspace")}</span>
          <h1>{t("ui.your.map.will.appear.here")}</h1>
          <p>{localize(state.project ? message("ui.create.a.map.or.upload.png.jpeg.or.webp") : message("ui.create.or.open.a.project.from.the.header"))}</p>
          {state.project && <button type="button" disabled={mapWritesDisabled} onClick={() => setMapAction({ kind: 'create' })}>{t("ui.create.map")}</button>}
        </div>}
        {regionState.draft && <div className="region-draft-tools" role="group" aria-label={t("ui.creating.region")}><span>{t('counts.vertices', { count: regionState.draft.length })}</span><button type="button" disabled={!canEditRegion} onClick={() => { void regions.finish() }}>{t("ui.done")}</button><button type="button" disabled={regionBusy} onClick={regions.cancel}>{t("ui.cancel.outline")}</button></div>}
        {regionState.markerTool && <div className="region-draft-tools" role="group" aria-label={t("ui.placing.marker")}><span>{t('marker.placementPrompt', { type: markerTypes[regionState.markerTool].label })}</span><button type="button" onClick={regions.cancelMarkerTool}>{t("ui.cancel.placement")}</button></div>}
        {(cardRegion || cardMarker || regionState.information) && <div id="object-card" className="card-panel"><CardResizer width={cardWidth} viewWidth={workspaceWidth} session={cardLayout} />
        {regionState.information && <InformationCard key={`${regionState.information.kind}:${regionState.information.projectId}:${regionState.information.mapId ?? ''}`} state={regionState} session={regions} disabled={mapBusy || backupBusy || deleting || (state.loading && !detailsSaving)} mapName={regionState.information.kind === 'map' ? navigationState.data.maps.find((m) => m.id === regionState.information?.mapId)?.name : undefined} onCancelCreation={() => setDialog('projects')} />}
        {cardRegion && <RegionCard key={cardRegion.id} region={cardRegion} state={regionState} session={regions} disabled={mapBusy || backupBusy || (state.loading && !detailsSaving) || session.hasUnsavedChanges()} geometryDisabled={!canEditRegion} tagCatalog={tags} />}
        {cardMarker && cardEntity && <MarkerCard key={cardMarker.id} entity={cardEntity} marker={cardMarker} state={regionState} session={regions} disabled={mapBusy || backupBusy || (state.loading && !detailsSaving) || session.hasUnsavedChanges()} geometryDisabled={!canEditRegion} tagCatalog={tags} />}
        </div>}
      </main>
      {dialog && <ProjectDialog repository={repository} session={session} message={projectMessage} onClose={() => setDialog(null)} onCreate={(name) => { setDialog(null); regions.createInformation(name) }} onOpen={(id) => { setDialog(null); regions.afterDetails(() => session.open(id)) }} onDelete={(project) => { setDialog(null); setDeleteError(undefined); setDeleteProject(project) }} />}
      {deleteProject && <ProjectDeleteDialog project={deleteProject} busy={deleting} error={deleteError} onCancel={() => { setDeleteProject(undefined); setDialog('projects') }} onDelete={confirmDelete} />}
      {mapAction && <MapActionDialog action={mapAction} disabled={mapWritesDisabled} onSubmit={changeMap} onClose={() => { setMapAction(undefined); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.map-menu-trigger')?.focus()) }} />}
    </div>
  )
}
