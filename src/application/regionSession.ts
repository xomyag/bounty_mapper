import { message, localize, t } from '../i18n'
import type { RegionRepository } from './regionRepository'
import type { ProjectSession } from './projectSession'
import type { Point } from '../domain/viewport'
import { emptyRegionContent, labelAnchor, MAX_REGIONS, MAX_REGION_VERTICES, regionHasUserContent, samePoint, translateVertices, validatePolygon, validateRegion } from '../domain/region'
import { documentAssetIds } from '../domain/richText'
import type { Region, RegionContent } from '../domain/region'
import { createProject } from '../domain/project'
import type { Asset, Project, Map } from '../domain/project'
import type { InformationRepository } from './informationRepository'
import type { RichDocument } from '../domain/richText'

export interface InformationCard { kind: 'project' | 'map' | 'new-project'; projectId: string; mapId?: string; name: string; document: RichDocument; assets: Record<string, Asset>; project?: Project; draft?: { name: string; document: RichDocument; assets: Asset[]; phase: 'dirty' | 'saving' | 'error'; error?: string } }
import { markerTypes, statusesOf, validateEntity, validateMarker, MAX_MARKERS, MAX_ENTITIES } from '../domain/marker'
import type { Entity, MarkerPlacement, MarkerKind } from '../domain/marker'
import { emptyDocument } from '../domain/richText'
import type { NavigationTarget } from '../domain/navigation'
import { canonicalTags } from '../domain/tags'
import type { WorkspaceMode } from '../domain/workspaceMode'
import type { ModeRepository } from './modeRepository'

export interface RegionDetails extends RegionContent { number: string; title: string; color: string; fillOpacity: number; vertices: Point[] }
interface DetailsDraft { fields: RegionDetails; assets: Asset[]; version: number; phase: 'dirty' | 'saving' | 'error'; error?: string; geometryUndo?: Point[][]; geometryRedo?: Point[][] }
export const detailsOf = (region: Region): RegionDetails => ({ shortDescription: region.shortDescription, number: String(region.number), title: region.title, color: region.color, fillOpacity: region.fillOpacity, vertices: structuredClone(region.vertices), gmNotes: structuredClone(region.gmNotes), playerDescription: structuredClone(region.playerDescription), checks: structuredClone(region.checks), tags: [...region.tags] })
export type MarkerCheckDraft = Omit<Region['checks'][number], 'dc'> & { dc: string }
export interface MarkerDetails { checks: MarkerCheckDraft[]; name: string; description: Entity['description']; tags: string[]; status: string; color: string; regionIds: string[]; locked: boolean }
export const markerDetailsOf = (entity: Entity, marker: MarkerPlacement): MarkerDetails => ({ checks: (entity.checks ?? []).map((c) => ({ ...c, dc: c.dc === undefined ? '' : String(c.dc) })), name: entity.name, description: structuredClone(entity.description), tags: [...entity.tags], status: entity.status, color: marker.color, regionIds: [...marker.regionIds], locked: marker.locked })
export interface MarkerDraft { entity: Entity; marker: MarkerPlacement; fields: MarkerDetails; assets: Asset[]; isNew: boolean; version: number; phase: 'dirty' | 'saving' | 'error'; error?: string }
type CardIntent = { kind: 'information'; mapId?: string } | { kind: 'create-project'; project: Project } | { kind: 'action'; run: () => Promise<void>; onStay?: () => void } | { kind: 'open'; id: string; center?: boolean } | { kind: 'marker'; id: string; center?: boolean } | { kind: 'close' } | { kind: 'vertices' } | { kind: 'map'; target: NavigationTarget } | { kind: 'mode'; mode: WorkspaceMode }
interface StatusCommand { entityId: string; before: string; after: string }
interface StatusAction extends StatusCommand { kind: 'change' | 'undo' | 'redo'; phase: 'saving' | 'saved' | 'error'; error?: string }
export interface LoadedMapObjects { regions: Region[]; assets: Asset[]; entities: Entity[]; markers: MarkerPlacement[] }

export interface RegionState {
  information?: InformationCard
  mode: WorkspaceMode
  modePhase: 'idle' | 'loading' | 'saving' | 'saved' | 'error'
  modeError?: string
  statusAction?: StatusAction
  canUndoStatus: boolean
  canRedoStatus: boolean
  mapId?: string
  regions: Region[]
  entities: Entity[]
  markers: MarkerPlacement[]
  markerTool?: MarkerKind
  markerCardId?: string
  selectedMarkerId?: string
  markerDraft?: MarkerDraft
  phase: 'idle' | 'loading' | 'saved' | 'saving' | 'error'
  selectedId?: string
  cardId?: string
  cardMode: 'view' | 'edit'
  pendingIntent?: CardIntent
  viewFocus?: { point: Point }
  transitioning?: boolean
  imagePending: number
  imageError?: string
  assets: Record<string, Asset>
  details: Record<string, DetailsDraft>
  vertexMode: boolean
  selectedVertex?: number
  draft?: Point[]
  error?: string
  canUndo: boolean
  canRedo: boolean
  canRetry: boolean
}
interface Command { before: Region[]; after: Region[]; markersBefore: MarkerPlacement[]; markersAfter: MarkerPlacement[]; selectedId?: string }

export class RegionSession {
  private state: RegionState = { mode: 'prepare', modePhase: 'idle', canUndoStatus: false, canRedoStatus: false, regions: [], entities: [], markers: [], details: {}, assets: {}, cardMode: 'view', imagePending: 0, phase: 'idle', vertexMode: false, canUndo: false, canRedo: false, canRetry: false }
  private informationWork?: Promise<void>
  private detailsWork?: Promise<void>
  private markerWork?: Promise<void>
  private listeners = new Set<() => void>()
  private generation = 0
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private retryWork?: () => Promise<void>
  private loaded = false
  private mapNavigator?: (target: NavigationTarget) => Promise<void>
  private tagCatalog: string[] = []
  private modeGeneration = 0
  private modeProjectId?: string
  private retryModeWork?: () => void
  private statusUndo: StatusCommand[] = []
  private statusRedo: StatusCommand[] = []
  setTagCatalog = (catalog: string[]) => { this.tagCatalog = catalog }
  constructor(private readonly repository: RegionRepository, private readonly projects: ProjectSession, private readonly modes: ModeRepository, private readonly informationRepository?: InformationRepository) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(fields: Partial<RegionState>) {
    this.state = { ...this.state, ...fields, canUndo: !!this.undoStack.length, canRedo: !!this.redoStack.length, canRetry: !!this.retryWork, canUndoStatus: !!this.statusUndo.length, canRedoStatus: !!this.statusRedo.length }
    this.listeners.forEach((listener) => listener())
  }
  busy = () => !!this.state.transitioning || ['loading', 'saving'].includes(this.state.phase) || ['loading', 'saving'].includes(this.state.modePhase) || this.state.statusAction?.phase === 'saving'
  canEditProject = () => this.projects.canEdit()
  isPreparation = () => this.canEditProject() && this.state.mode === 'prepare' && !['loading', 'saving'].includes(this.state.modePhase)
  loadMode = async (projectId?: string) => {
    const generation = ++this.modeGeneration
    this.modeProjectId = projectId; this.retryModeWork = undefined
    this.statusUndo = []; this.statusRedo = []
    this.update({ mode: 'prepare', modePhase: projectId ? 'loading' : 'idle', modeError: undefined, statusAction: undefined })
    if (!projectId) return
    try { const mode = await this.modes.load(projectId); if (generation === this.modeGeneration) this.update({ mode, modePhase: 'saved' }) }
    catch (error) {
      if (generation !== this.modeGeneration) return
      this.retryModeWork = () => { void this.loadMode(projectId) }
      this.update({ mode: 'play', modePhase: 'error', modeError: message("ui.could.not.read.the.mode.geometry.is.locked.value", { p0: error instanceof Error ? error.message : '' }) })
    }
  }
  requestMode = (mode: WorkspaceMode) => {
    if (!this.canEditProject() || !['prepare', 'play'].includes(mode) || mode === this.state.mode || this.busy() || this.detailsSaving() || this.state.imagePending || this.projects.getSnapshot().loading || this.projects.hasUnsavedChanges()) return
    this.requestCardIntent({ kind: 'mode', mode })
  }
  retryMode = () => this.retryModeWork?.()
  private async applyMode(mode: WorkspaceMode) {
    const projectId = this.projects.getSnapshot().project?.id
    if (!projectId) return
    const generation = ++this.modeGeneration
    this.update({ modePhase: 'saving', modeError: undefined })
    try {
      await this.modes.save(projectId, mode)
      if (generation !== this.modeGeneration || this.projects.getSnapshot().project?.id !== projectId) return
      const newMarker = this.state.markerDraft?.isNew
      this.retryModeWork = undefined
      if (this.loaded) this.retryWork = undefined
      this.update({ mode, modePhase: 'saved', modeError: undefined, pendingIntent: undefined, cardMode: 'view', details: {}, markerDraft: undefined, ...(newMarker ? { markerCardId: undefined, selectedMarkerId: undefined } : {}), draft: undefined, markerTool: undefined, vertexMode: false, selectedVertex: undefined, imageError: undefined, error: this.loaded ? undefined : this.state.error, phase: this.loaded ? 'saved' : this.state.phase })
    } catch (error) {
      if (generation !== this.modeGeneration) return
      this.retryModeWork = () => this.requestMode(mode)
      this.update({ modePhase: 'error', modeError: message("ui.could.not.save.the.mode.value", { p0: error instanceof Error ? error.message : '' }) })
    }
  }
  setMapNavigator = (handler: (target: NavigationTarget) => Promise<void>) => { this.mapNavigator = handler }
  navigate = (target: NavigationTarget) => {
    if (this.busy() || this.state.draft || this.state.markerTool || this.state.vertexMode || this.projects.getSnapshot().loading || this.projects.hasUnsavedChanges()) return
    if (target.mapId === this.state.mapId && 'kind' in target) {
      const current = target.kind === 'region' ? this.state.regions.find((r) => r.id === target.id && r.id === this.state.cardId) : this.state.markers.find((m) => m.id === target.id && m.id === this.state.markerCardId)
      if (current) { this.update({ viewFocus: { point: 'vertices' in current ? labelAnchor(current.vertices) : { x: current.x, y: current.y } } }); return }
      if (target.kind === 'region') this.openCard(target.id, true)
      else this.openMarkerCard(target.id, true)
    } else if (target.mapId !== this.state.mapId && this.mapNavigator) this.requestCardIntent({ kind: 'map', target })
  }
  readMap = async (mapId: string): Promise<LoadedMapObjects> => {
    const [regions, assets, objects] = await Promise.all([this.repository.load(mapId), this.repository.loadAssets(mapId), this.repository.loadObjects(mapId)])
    if (objects.markers.some((m) => m.regionIds.some((id) => !regions.some((r) => r.id === id)))) throw new Error(message("ui.marker.region.not.found"))
    return { regions, assets, ...objects }
  }
  adoptMap = (target: NavigationTarget, data: LoadedMapObjects & { map?: Map }) => {
    const info = this.state.information
    const information = 'kind' in target ? undefined : info?.kind === 'map' ? data.map ? { ...info, mapId: data.map.id, name: data.map.name, document: data.map.description, draft: undefined, assets: Object.fromEntries(data.assets.map((a) => [a.id, a])) } : undefined : info
    const region = 'kind' in target && target.kind === 'region' ? data.regions.find((r) => r.id === target.id) : undefined
    const marker = 'kind' in target && target.kind === 'marker' ? data.markers.find((m) => m.id === target.id) : undefined
    if ('kind' in target && !region && !marker) throw new Error(message("ui.the.object.no.longer.exists.on.the.selected.map"))
    ++this.generation; this.loaded = true; this.undoStack = []; this.redoStack = []; this.retryWork = undefined
    const editRegion = region && this.isPreparation() && !regionHasUserContent(region)
    this.update({ information, mapId: target.mapId, regions: data.regions, entities: data.entities, markers: data.markers, assets: Object.fromEntries(data.assets.map((a) => [a.id, a])), phase: 'saved', transitioning: false, error: undefined, draft: undefined, markerTool: undefined, markerDraft: undefined, cardId: region?.id, selectedId: region?.id, markerCardId: marker?.id, selectedMarkerId: marker?.id, cardMode: editRegion ? 'edit' : 'view', details: editRegion ? { [region.id]: { fields: detailsOf(region), assets: [], version: 0, phase: 'dirty' } } : {}, pendingIntent: undefined, imagePending: 0, imageError: undefined, selectedVertex: undefined, vertexMode: false, viewFocus: region ? { point: labelAnchor(region.vertices) } : marker ? { point: { x: marker.x, y: marker.y } } : undefined })
  }
  hasLoaded = () => this.loaded
  isDetailsDirty = (id: string) => {
    const region = this.state.regions.find((r) => r.id === id)
    const draft = this.state.details[id]
    return !!draft && !!region && (draft.phase === 'saving' || draft.phase === 'error' || JSON.stringify(draft.fields) !== JSON.stringify(detailsOf(region)))
  }
  isMarkerDirty = () => !!this.state.markerDraft && (this.state.markerDraft.isNew || this.state.markerDraft.phase === 'error' || this.state.markerDraft.phase === 'saving' || JSON.stringify(this.state.markerDraft.fields) !== JSON.stringify(markerDetailsOf(this.state.markerDraft.entity, this.state.markerDraft.marker)))
  isInformationDirty = () => { const info = this.state.information; const d = info?.draft; return !!info && (info.kind === 'new-project' || !!d && (d.phase !== 'dirty' || d.name !== info.name || JSON.stringify(d.document) !== JSON.stringify(info.document))) }
  hasUnsavedDetails = () => this.isInformationDirty() || Object.keys(this.state.details).some(this.isDetailsDirty) || this.isMarkerDirty() || this.state.imagePending > 0
  detailsSaving = () => !!this.informationWork || !!this.detailsWork || !!this.markerWork || Object.values(this.state.details).some((draft) => draft.phase === 'saving')
  ready = () => this.isPreparation() && this.loaded && !!this.state.mapId && !this.busy() && !this.hasUnsavedDetails() && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  canMoveRegion = (id: string) => this.isPreparation() && this.loaded && this.state.cardId === id && this.state.cardMode === 'edit' && !!this.state.details[id] && !this.busy() && !this.detailsSaving() && !this.state.imagePending && !this.state.pendingIntent && !this.state.vertexMode && !this.state.draft && !this.state.markerTool && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  canUndoDraftGeometry = () => !!this.state.cardId && this.canMoveRegion(this.state.cardId) && !!this.state.details[this.state.cardId]?.geometryUndo?.length
  canRedoDraftGeometry = () => !!this.state.cardId && this.canMoveRegion(this.state.cardId) && !!this.state.details[this.state.cardId]?.geometryRedo?.length
  moveRegionDraft = (id: string, offset: Point) => {
    if (!this.canMoveRegion(id) || ![offset.x, offset.y].every(Number.isFinite) || (!offset.x && !offset.y)) return
    const draft = this.state.details[id]
    const vertices = translateVertices(draft.fields.vertices, offset)
    try { validatePolygon(vertices) } catch (error) { this.fail(error); return }
    this.update({ details: { ...this.state.details, [id]: { ...draft, fields: { ...draft.fields, vertices }, version: draft.version + 1, phase: 'dirty', error: undefined, geometryUndo: [...(draft.geometryUndo ?? []), structuredClone(draft.fields.vertices)].slice(-100), geometryRedo: [] } } })
  }
  private stepDraftGeometry(redo: boolean) {
    if (redo ? !this.canRedoDraftGeometry() : !this.canUndoDraftGeometry()) return false
    const id = this.state.cardId!; const draft = this.state.details[id]
    const from = [...(redo ? draft.geometryRedo! : draft.geometryUndo!)]; const vertices = from.pop()!
    const to = [...(redo ? draft.geometryUndo ?? [] : draft.geometryRedo ?? []), structuredClone(draft.fields.vertices)]
    this.update({ details: { ...this.state.details, [id]: { ...draft, fields: { ...draft.fields, vertices }, version: draft.version + 1, phase: 'dirty', error: undefined, geometryUndo: redo ? to : from, geometryRedo: redo ? from : to } } })
    return true
  }
  load = async (mapId?: string) => {
    const generation = ++this.generation
    this.loaded = false
    this.undoStack = []; this.redoStack = []; this.retryWork = undefined
    this.update({ information: this.state.information?.projectId === this.getProjectId() && this.state.information?.kind !== 'map' ? this.state.information : undefined, mapId, regions: [], entities: [], markers: [], markerTool: undefined, markerDraft: undefined, markerCardId: undefined, selectedMarkerId: undefined, details: {}, assets: {}, cardId: undefined, cardMode: 'view', pendingIntent: undefined, viewFocus: undefined, imagePending: 0, imageError: undefined, phase: mapId ? 'loading' : 'idle', selectedId: undefined, selectedVertex: undefined, vertexMode: false, draft: undefined, error: undefined })
    if (!mapId) return
    try {
      const { regions, assets, entities, markers } = await this.readMap(mapId)
      if (generation === this.generation) { this.loaded = true; this.update({ regions, entities, markers, assets: Object.fromEntries(assets.map((a) => [a.id, a])), phase: 'saved' }) }
    } catch (error) {
      if (generation === this.generation) { this.retryWork = () => this.load(mapId); this.fail(error) }
    }
  }
  private fail(error: unknown) { this.update({ phase: 'error', error: error instanceof Error ? error.message : message("ui.could.not.save.map.objects") }) }
  dismiss = () => { this.retryWork = undefined; this.update({ error: undefined }) }
  retry = async () => { if (!this.busy()) await this.retryWork?.() }
  select = (id?: string) => { if (!this.busy() && !this.state.draft && !this.hasUnsavedDetails()) this.update({ selectedId: id ?? this.state.cardId, selectedMarkerId: id ? undefined : this.state.markerCardId, selectedVertex: undefined }) }
  openCard = (id: string, center = false) => {
    if (!this.busy() && !this.state.draft && !this.state.markerTool && !this.state.vertexMode && this.state.regions.some((r) => r.id === id) && id !== this.state.cardId) this.requestCardIntent({ kind: 'open', id, ...(center ? { center: true } : {}) })
  }
  closeCard = () => this.requestCardIntent({ kind: 'close' })
  beginEdit = () => {
    const region = this.state.regions.find((r) => r.id === this.state.cardId)
    if (!this.isPreparation() || !region || this.busy() || this.detailsSaving()) return
    this.update({ cardMode: 'edit', vertexMode: false, selectedVertex: undefined, details: { ...this.state.details, [region.id]: this.state.details[region.id] ?? { fields: detailsOf(region), assets: [], version: 0, phase: 'dirty' } } })
  }
  cancelEdit = () => {
    if (this.detailsSaving() || this.state.imagePending) return
    if (this.state.cardId) this.discardDetails(this.state.cardId)
    this.update({ cardMode: 'view', imageError: undefined })
  }
  private requestCardIntent(intent: CardIntent) {
    if (this.busy() || this.detailsSaving() || this.state.imagePending) return
    if (this.hasUnsavedDetails()) this.update({ pendingIntent: intent })
    else void this.applyCardIntent(intent)
  }
  private async applyCardIntent(intent: CardIntent) {
    if (intent.kind === 'information' || intent.kind === 'create-project') {
      if (!this.informationRepository) return
      this.update({ transitioning: true, pendingIntent: undefined, error: undefined })
      try {
        const project = intent.kind === 'create-project' ? intent.project : this.projects.getSnapshot().project!
        const data = intent.kind === 'create-project' ? { assets: [] as Asset[], map: undefined } : await this.informationRepository.load(project.id, intent.mapId)
        if (intent.kind !== 'create-project' && this.getProjectId() !== project.id) return
        const kind = intent.kind === 'create-project' ? 'new-project' : intent.mapId ? 'map' : 'project'
        const name = data.map?.name ?? project.name; const document = data.map?.description ?? project.context
        const information: InformationCard = { kind, projectId: project.id, mapId: data.map?.id, name, document, assets: Object.fromEntries(data.assets.map((a) => [a.id,a])), ...(kind === 'new-project' ? { project, draft: { name, document: structuredClone(document), assets: [], phase: 'dirty' } } : {}) }
        this.update({ information, cardId: undefined, selectedId: undefined, markerCardId: undefined, selectedMarkerId: undefined, markerDraft: undefined, details: {}, cardMode: kind === 'new-project' ? 'edit' : 'view', draft: undefined, markerTool: undefined, vertexMode: false, selectedVertex: undefined, imageError: undefined })
      } catch (error) { this.fail(error) } finally { this.update({ transitioning: false }) }
      return
    }
    if (intent.kind === 'action') {
      this.update({ details: {}, markerDraft: undefined, cardMode: 'view' })
      this.update({ pendingIntent: undefined, transitioning: true })
      try { await intent.run() } catch (error) { this.fail(error) } finally { this.update({ transitioning: false }) }
      return
    }
    if (intent.kind === 'mode') { await this.applyMode(intent.mode); return }
    if (intent.kind === 'map') {
      this.update({ transitioning: true, pendingIntent: undefined, error: undefined })
      try { await this.mapNavigator!(intent.target) }
      catch (error) { this.fail(error) }
      finally { this.update({ transitioning: false }) }
      return
    }
    if (this.state.cardId) this.discardDetails(this.state.cardId)
    this.update({ information: undefined, draft: undefined, pendingIntent: undefined, imageError: undefined, markerDraft: undefined, markerCardId: undefined, selectedMarkerId: undefined, markerTool: undefined })
    if (intent.kind === 'open') {
      const region = this.state.regions.find((r) => r.id === intent.id)!
      this.update({ cardId: intent.id, cardMode: 'view', selectedId: intent.id, vertexMode: false, selectedVertex: undefined, ...(intent.center ? { viewFocus: { point: labelAnchor(region.vertices) } } : {}) })
      if (this.isPreparation() && !regionHasUserContent(region)) this.beginEdit()
    } else if (intent.kind === 'marker') {
      const marker = this.state.markers.find((m) => m.id === intent.id)!
      this.update({ cardId: undefined, selectedId: undefined, selectedVertex: undefined, vertexMode: false, markerCardId: intent.id, selectedMarkerId: intent.id, cardMode: 'view', ...(intent.center ? { viewFocus: { point: { x: marker.x, y: marker.y } } } : {}) })
    } else if (intent.kind === 'vertices') this.update({ cardMode: 'view', vertexMode: true, selectedVertex: undefined })
    else this.update({ cardId: undefined, cardMode: 'view', selectedId: undefined, vertexMode: false, selectedVertex: undefined })
  }
  resolveCardIntent = async (choice: 'save' | 'discard' | 'stay') => {
    const intent = this.state.pendingIntent
    if (!intent || this.busy() || this.detailsSaving()) return
    if (choice === 'stay') { if (intent.kind === 'action') intent.onStay?.(); this.update({ pendingIntent: undefined }); return }
    if (choice === 'save') { if (this.state.information?.draft) await this.saveInformation(); else if (this.state.markerDraft) await this.saveMarkerDetails(); else await this.saveDetails(); if (this.hasUnsavedDetails()) return }
    if (this.state.information?.draft) this.update({ information: this.state.information.kind === 'new-project' ? undefined : { ...this.state.information, draft: undefined }, cardMode: 'view' })
    await this.applyCardIntent(intent)
  }
  discardDetails = (id: string) => {
    if (this.detailsSaving()) return
    const details = { ...this.state.details }; delete details[id]
    this.update({ details })
  }
  setVertexMode = (value: boolean) => { if (this.isPreparation() && !this.busy()) { if (value) this.requestCardIntent({ kind: 'vertices' }); else this.update({ vertexMode: false, selectedVertex: undefined }) } }
  selectVertex = (index?: number) => { if (!this.busy()) this.update({ selectedVertex: index }) }
  start = (first?: Point) => {
    if (!this.ready()) return
    this.applyCardIntent({ kind: 'close' })
    this.dismiss()
    this.update({ draft: first ? [{ ...first }] : [], cardId: undefined, markerCardId: undefined, markerDraft: undefined, markerTool: undefined, selectedMarkerId: undefined, selectedId: undefined, selectedVertex: undefined, vertexMode: false })
  }
  addPoint = (point: Point) => {
    if (!this.state.draft || !this.ready()) return
    const last = this.state.draft.at(-1)
    if (last && samePoint(last, point)) return
    if (this.state.draft.length >= MAX_REGION_VERTICES) { this.fail(new Error(message("ui.a.region.can.have.at.most.value.vertices", { p0: MAX_REGION_VERTICES }))); return }
    this.retryWork = undefined
    this.update({ draft: [...this.state.draft, { ...point }], error: undefined })
  }
  moveDraftVertex = (index: number, point: Point) => {
    if (!this.state.draft || !this.ready() || !Number.isInteger(index) || index < 0 || index >= this.state.draft.length) return
    this.retryWork = undefined
    this.update({ draft: this.state.draft.map((p, i) => i === index ? { ...point } : p), error: undefined })
  }
  removeDraftVertex = (index: number) => {
    if (!this.state.draft || !this.ready() || !Number.isInteger(index) || index < 0 || index >= this.state.draft.length) return
    this.retryWork = undefined
    this.update({ draft: this.state.draft.filter((_, i) => i !== index), error: undefined })
  }
  cancel = () => { if (!this.busy()) { this.dismiss(); this.update({ draft: undefined, phase: this.state.mapId ? 'saved' : 'idle' }) } }
  finish = async () => {
    if (!this.ready() || !this.state.draft) return
    try {
      validatePolygon(this.state.draft)
      if (this.state.regions.length >= MAX_REGIONS) throw new Error(message("ui.at.most.value.regions.are.allowed", { p0: MAX_REGIONS }))
      const number = Math.max(0, ...this.state.regions.map((r) => r.number)) + 1
      const region: Region = { ...emptyRegionContent(), titleCustomized: false, id: crypto.randomUUID(), mapId: this.state.mapId!, vertices: structuredClone(this.state.draft), order: Math.max(-1, ...this.state.regions.map((r) => r.order)) + 1, number, title: t("ui.region.value", { p0: number }), color: '#d7ad62', fillOpacity: 0.4 }
      await this.commit([...this.state.regions, region], region.id, 'edit', true)
    } catch (error) { this.fail(error) }
  }
  change = async (region: Region) => {
    if (!this.ready() || this.state.draft || !this.state.regions.some((r) => r.id === region.id)) return
    this.retryWork = undefined
    try {
      validateRegion(region)
      const next = this.state.regions.map((r) => r.id === region.id ? structuredClone(region) : r)
      if (JSON.stringify(next) === JSON.stringify(this.state.regions)) return
      await this.commit(next, region.id)
    } catch (error) { this.fail(error) }
  }
  remove = async () => {
    if (!this.ready() || this.state.draft || !this.state.selectedId) return
    await this.commit(this.state.regions.filter((r) => r.id !== this.state.selectedId), undefined)
  }
  removeVertex = async (index = this.state.selectedVertex) => {
    const region = this.state.regions.find((r) => r.id === this.state.selectedId)
    if (!this.ready() || !region || index === undefined || !Number.isInteger(index) || index < 0 || index >= region.vertices.length) return
    if (region.vertices.length <= 3) { this.fail(new Error(message("ui.at.least.three.vertices.must.remain.after.deletion"))); return }
    await this.change({ ...region, vertices: region.vertices.filter((_, i) => i !== index) })
  }
  undo = async () => {
    if (this.stepDraftGeometry(false)) return
    const command = this.undoStack.at(-1)
    if (command && this.ready() && !this.state.draft) await this.commit(command.before, command.selectedId, 'undo', false, command.markersBefore)
  }
  redo = async () => {
    if (this.stepDraftGeometry(true)) return
    const command = this.redoStack.at(-1)
    if (command && this.ready() && !this.state.draft) await this.commit(command.after, command.selectedId, 'redo', false, command.markersAfter)
  }
  editDetails = (id: string, fields: Partial<RegionDetails>) => {
    const region = this.state.regions.find((r) => r.id === id)
    if (!this.isPreparation() || !this.loaded || this.busy() || !region || this.projects.hasUnsavedChanges() || (this.projects.getSnapshot().loading && !this.detailsSaving())) return
    const version = (this.state.details[id]?.version ?? 0) + 1
    this.update({ details: { ...this.state.details, [id]: { ...this.state.details[id], fields: structuredClone({ ...(this.state.details[id]?.fields ?? detailsOf(region)), ...fields }), assets: this.state.details[id]?.assets ?? [], version, phase: 'dirty', error: undefined } } })
  }
  beginImageInsertion = () => { if (this.isPreparation() || this.state.information?.kind === 'new-project') this.update({ imagePending: this.state.imagePending + 1, imageError: undefined }) }
  reportImageError = (error: unknown) => this.update({ imageError: error instanceof Error ? error.message : message("ui.could.not.insert.image.or.text") })
  endImageInsertion = (error?: unknown) => this.update({ imagePending: Math.max(0, this.state.imagePending - 1), imageError: error ? error instanceof Error ? error.message : message("ui.could.not.insert.image") : undefined })
  addDraftAsset = (id: string, asset: Asset) => {
    if (!this.isPreparation()) return
    const region = this.state.regions.find((r) => r.id === id)
    if (!region) return
    const draft = this.state.details[id] ?? { fields: detailsOf(region), assets: [], version: 0, phase: 'dirty' as const }
    this.update({ details: { ...this.state.details, [id]: { ...draft, assets: [...draft.assets, asset] } } })
  }
  openInformation = (mapId?: string) => this.requestCardIntent({ kind: 'information', mapId })
  createInformation = (name: string) => this.requestCardIntent({ kind: 'create-project', project: createProject(name) })
  afterDetails = (run: () => Promise<void>, onStay?: () => void) => this.requestCardIntent({ kind: 'action', run, onStay })
  beginInformationEdit = () => {
    const info = this.state.information
    if (!info || !this.isPreparation() || this.busy() || this.detailsSaving()) return
    this.update({ cardMode: 'edit', information: { ...info, draft: { name: info.name, document: structuredClone(info.document), assets: [], phase: 'dirty' } } })
  }
  editInformation = (change: Partial<{ name: string; document: RichDocument }>) => {
    const info = this.state.information
    if (!info?.draft || (info.kind !== 'new-project' && !this.isPreparation()) || this.busy() || this.detailsSaving()) return
    this.update({ information: { ...info, draft: { ...info.draft, ...change, phase: 'dirty', error: undefined } } })
  }
  cancelInformationEdit = () => {
    if (this.detailsSaving() || this.state.imagePending) return
    const info = this.state.information
    this.update({ information: info?.kind === 'new-project' ? undefined : info && { ...info, draft: undefined }, cardMode: 'view', imageError: undefined })
  }
  addInformationDraftAsset = (asset: Asset) => {
    const info = this.state.information
    if (info?.draft && asset.projectId === info.projectId) this.update({ information: { ...info, draft: { ...info.draft, assets: [...info.draft.assets, asset] } } })
  }
  getImageProjectId = () => this.state.information?.kind === 'new-project' ? this.state.information.projectId : this.getProjectId()
  saveInformation = (): Promise<void> => {
    if (this.informationWork) return this.informationWork
    const info = this.state.information; const draft = info?.draft
    if (!info || !draft || !this.informationRepository || this.state.imagePending || this.busy() || (info.kind !== 'new-project' && !this.isPreparation())) return Promise.resolve()
    if (!draft.name.trim()) { this.update({ information: { ...info, draft: { ...draft, phase: 'error', error: message("ui.enter.a.project.name") } } }); return Promise.resolve() }
    this.update({ information: { ...info, draft: { ...draft, phase: 'saving', error: undefined } } })
    this.informationWork = (async () => {
      try {
        const fields = { name: draft.name.trim(), document: draft.document, mapId: info.mapId }
        if (info.kind === 'new-project') await this.projects.adoptProject(() => this.informationRepository!.create({ ...info.project!, name: fields.name, context: fields.document }, draft.assets))
        else await this.projects.mutateProject((project) => this.informationRepository!.save(project, fields, draft.assets))
        this.update({ information: { ...info, kind: info.kind === 'new-project' ? 'project' : info.kind, name: fields.name, document: structuredClone(fields.document), draft: undefined, assets: { ...info.assets, ...Object.fromEntries(draft.assets.map((a) => [a.id,a])) } }, cardMode: 'view', imageError: undefined })
      } catch (error) {
        this.update({ information: { ...info, draft: { ...draft, phase: 'error', error: error instanceof Error ? error.message : message("ui.could.not.save.the.document") } } })
      } finally { this.informationWork = undefined }
    })()
    return this.informationWork
  }
  getProjectId = () => this.projects.getSnapshot().project?.id
  saveDetails = (includeErrors = true): Promise<void> => {
    if (!this.isPreparation() || this.state.imagePending) return Promise.resolve()
    if (this.detailsWork) return includeErrors ? this.detailsWork.then(() => this.hasUnsavedDetails() ? this.saveDetails() : undefined) : this.detailsWork
    this.detailsWork = this.writeDetails(includeErrors).finally(() => { this.detailsWork = undefined; this.update({}) })
    return this.detailsWork
  }
  flushDetails = async () => {
    if (this.hasUnsavedDetails()) throw new Error(message("ui.save.or.discard.card.changes.first"))
  }
  private async writeDetails(includeErrors: boolean) {
    while (true) {
      const entry = Object.entries(this.state.details).find(([, draft]) => includeErrors || draft.phase === 'dirty')
      if (!entry) return
      const [id, draft] = entry
      const mapId = this.state.mapId!
      const fields = structuredClone(draft.fields)
      fields.tags = canonicalTags(fields.tags, this.tagCatalog)
      const generation = this.generation
      try {
        const currentRegion = this.state.regions.find((r) => r.id === id)!
        const details = { ...fields, number: Number(fields.number), title: fields.title.trim(), titleCustomized: currentRegion.titleCustomized || fields.title.trim() !== currentRegion.title }
        const next = this.state.regions.map((region) => region.id === id ? { ...region, ...details } : region)
        const region = next.find((r) => r.id === id)!
        validateRegion(region)
        this.update({ details: { ...this.state.details, [id]: { ...draft, phase: 'saving', error: undefined } } })
        const referenced = new Set([...documentAssetIds(details.gmNotes), ...documentAssetIds(details.playerDescription)])
        const newAssets = draft.assets.filter((asset) => referenced.has(asset.id))
        await this.projects.mutateProject((project) => this.repository.save(project, mapId, next, newAssets, { entities: this.state.entities, markers: this.state.markers }, fields.tags))
        if (generation !== this.generation) return
        const { vertices: _vertices, ...contentDetails } = details; void _vertices
        // Saved text/appearance is retained when undoing geometry.
        for (const command of [...this.undoStack, ...this.redoStack]) {
          for (const list of [command.before, command.after]) {
            const row = list.find((r) => r.id === id)
            if (row) Object.assign(row, structuredClone(contentDetails))
          }
        }
        if (JSON.stringify(currentRegion.vertices) !== JSON.stringify(details.vertices)) {
          this.undoStack.push({ before: structuredClone(this.state.regions.map((r) => r.id === id ? { ...r, ...contentDetails } : r)), after: structuredClone(next), markersBefore: structuredClone(this.state.markers), markersAfter: structuredClone(this.state.markers), selectedId: id })
          if (this.undoStack.length > 100) this.undoStack.shift()
          this.redoStack = []
        }
        const drafts = { ...this.state.details }
        if (drafts[id]?.version === draft.version) delete drafts[id]
        else if (drafts[id]) {
          const written = new Set(newAssets.map((asset) => asset.id))
          drafts[id] = { ...drafts[id], assets: drafts[id].assets.filter((asset) => !written.has(asset.id)) }
        }
        this.update({ regions: next, assets: { ...this.state.assets, ...Object.fromEntries(newAssets.map((a) => [a.id, a])) }, details: drafts, ...(Object.keys(drafts).length ? {} : { cardMode: 'view' }) })
      } catch (error) {
        if (generation !== this.generation) return
        const current = this.state.details[id]
        this.update({ details: { ...this.state.details, [id]: { ...current, phase: 'error', error: error instanceof Error ? error.message : message("ui.could.not.save.the.card") } } })
        return
      }
    }
  }
  startMarker = (kind: MarkerKind) => {
    if (!this.ready() || this.state.draft || !Object.hasOwn(markerTypes, kind)) return
    this.applyCardIntent({ kind: 'close' })
    this.dismiss(); this.update({ markerTool: kind })
  }
  cancelMarkerTool = () => this.update({ markerTool: undefined })
  placeMarker = (point: Point) => {
    if (!this.ready() || !this.state.markerTool) return
    if (this.state.markers.length >= MAX_MARKERS || this.state.entities.length >= MAX_ENTITIES) { this.fail(new Error(message("ui.the.project.marker.or.entity.limit.was.reached"))); return }
    const kind = this.state.markerTool
    const entity: Entity = { checks: [], id: crypto.randomUUID(), projectId: this.getProjectId()!, kind, name: localize(markerTypes[kind].label), description: emptyDocument(), status: Object.keys(statusesOf(kind))[0], tags: [] }
    const marker: MarkerPlacement = { id: crypto.randomUUID(), entityId: entity.id, mapId: this.state.mapId!, x: point.x, y: point.y, regionIds: [], color: '#d7ad62', locked: false, order: Math.max(-1, ...this.state.markers.map((m) => m.order)) + 1 }
    try { validateMarker(marker) } catch (error) { this.fail(error); return }
    this.update({ markerTool: undefined, markerCardId: marker.id, selectedMarkerId: marker.id, cardId: undefined, selectedId: undefined, vertexMode: false, cardMode: 'edit', markerDraft: { entity, marker, fields: markerDetailsOf(entity, marker), assets: [], isNew: true, phase: 'dirty', version: 0 } })
  }
  selectMarker = (id: string) => { if (this.ready()) this.update({ selectedMarkerId: id, selectedId: undefined, selectedVertex: undefined }) }
  canMoveMarkerDraft = (id: string) => this.isPreparation() && !!this.state.markerDraft?.isNew && this.state.markerDraft.marker.id === id && !this.state.markerDraft.fields.locked && !this.busy() && !this.detailsSaving() && !this.state.imagePending && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  moveMarkerDraft = (id: string, point: Point) => {
    if (!this.canMoveMarkerDraft(id)) return
    const draft = this.state.markerDraft!
    const marker = { ...draft.marker, x: point.x, y: point.y }
    try {
      validateMarker(marker)
      this.update({ markerDraft: { ...draft, marker, version: draft.version + 1 } })
    } catch (error) { this.update({ markerDraft: { ...draft, phase: 'error', error: error instanceof Error ? error.message : message("ui.could.not.move.the.marker.draft") } }) }
  }
  openMarkerCard = (id: string, center = false) => {
    if (!this.busy() && !this.state.draft && !this.state.markerTool && !this.state.vertexMode && id !== this.state.markerCardId && this.state.markers.some((m) => m.id === id)) this.requestCardIntent({ kind: 'marker', id, ...(center ? { center: true } : {}) })
  }
  beginMarkerEdit = () => {
    const marker = this.state.markers.find((m) => m.id === this.state.markerCardId)
    const entity = this.state.entities.find((e) => e.id === marker?.entityId)
    if (!this.isPreparation() || !marker || !entity || this.busy() || this.detailsSaving()) return
    this.update({ cardMode: 'edit', markerDraft: { entity, marker, fields: markerDetailsOf(entity, marker), assets: [], isNew: false, version: 0, phase: 'dirty' } })
  }
  editMarkerDetails = (fields: Partial<MarkerDetails>) => {
    const draft = this.state.markerDraft
    if (!this.isPreparation() || !draft || this.busy() || this.projects.hasUnsavedChanges() || (this.projects.getSnapshot().loading && !this.markerWork)) return
    this.update({ markerDraft: { ...draft, fields: structuredClone({ ...draft.fields, ...fields }), version: draft.version + 1, phase: 'dirty', error: undefined } })
  }
  cancelMarkerEdit = () => {
    if (this.detailsSaving() || this.state.imagePending) return
    if (this.state.markerDraft?.isNew) this.applyCardIntent({ kind: 'close' })
    else this.update({ markerDraft: undefined, cardMode: 'view', imageError: undefined })
  }
  addMarkerDraftAsset = (asset: Asset) => {
    if (this.isPreparation() && this.state.markerDraft) this.update({ markerDraft: { ...this.state.markerDraft, assets: [...this.state.markerDraft.assets, asset] } })
  }
  saveMarkerDetails = (): Promise<void> => {
    if (!this.isPreparation() || this.state.imagePending) return Promise.resolve()
    if (this.markerWork) return this.markerWork
    this.markerWork = this.writeMarkerDetails().finally(() => { this.markerWork = undefined; this.update({}) })
    return this.markerWork
  }
  private async writeMarkerDetails() {
    const generation = this.generation
    while (this.state.markerDraft) {
      const draft = this.state.markerDraft
      const fields = structuredClone(draft.fields)
      fields.tags = canonicalTags(fields.tags, this.tagCatalog)
      const entity: Entity = { ...draft.entity, checks: fields.checks.map((c) => ({ ...c, dc: c.dc.trim() ? Number(c.dc) : undefined })), name: fields.name.trim(), description: fields.description, tags: fields.tags, status: fields.status }
      const marker: MarkerPlacement = { ...draft.marker, color: fields.color, locked: fields.locked, regionIds: [...fields.regionIds] }
      try {
        validateEntity(entity); validateMarker(marker)
        if (marker.regionIds.some((id) => !this.state.regions.some((r) => r.id === id))) throw new Error(message("ui.choose.regions.of.the.current.map"))
        const entities = [...this.state.entities.filter((e) => e.id !== entity.id), entity]
        const markersBefore = structuredClone(this.state.markers)
        const markers = draft.isNew ? [...this.state.markers, marker] : this.state.markers.map((m) => m.id === marker.id ? marker : m)
        const referenced = new Set(documentAssetIds(entity.description))
        const newAssets = draft.assets.filter((a) => referenced.has(a.id))
        this.update({ markerDraft: { ...draft, phase: 'saving', error: undefined } })
        await this.projects.mutateProject((project) => this.repository.save(project, marker.mapId, this.state.regions, newAssets, { entities, markers }, fields.tags))
        if (generation !== this.generation) return
        if (entity.status !== draft.entity.status) {
          this.statusUndo = this.statusUndo.filter((c) => c.entityId !== entity.id); this.statusRedo = this.statusRedo.filter((c) => c.entityId !== entity.id)
          if (this.state.statusAction?.entityId === entity.id) this.update({ statusAction: undefined })
        }
        for (const command of [...this.undoStack, ...this.redoStack]) {
          for (const list of [command.markersBefore, command.markersAfter]) {
            const row = list.find((m) => m.id === marker.id)
            if (row) {
              Object.assign(row, { color: marker.color, locked: marker.locked })
              // An entity-only edit after deleting a region must not erase the
              // binding remembered by that region's undo command.
              const removed = draft.marker.regionIds.filter((id) => !marker.regionIds.includes(id))
              const added = marker.regionIds.filter((id) => !draft.marker.regionIds.includes(id))
              row.regionIds = [...new Set([...row.regionIds.filter((id) => !removed.includes(id)), ...added])]
            }
          }
        }
        if (draft.isNew) {
          this.undoStack.push({ before: structuredClone(this.state.regions), after: structuredClone(this.state.regions), markersBefore, markersAfter: structuredClone(markers) })
          if (this.undoStack.length > 100) this.undoStack.shift()
          this.redoStack = []
        }
        const latest = this.state.markerDraft!
        const nextDraft = latest.version === draft.version ? undefined : { ...latest, entity, marker, isNew: false, assets: latest.assets.filter((a) => !newAssets.some((written) => written.id === a.id)) }
        this.update({ entities, markers, assets: { ...this.state.assets, ...Object.fromEntries(newAssets.map((a) => [a.id, a])) }, markerDraft: nextDraft, ...(nextDraft ? {} : { cardMode: 'view' }) })
      } catch (error) {
        if (generation === this.generation && this.state.markerDraft) this.update({ markerDraft: { ...this.state.markerDraft, phase: 'error', error: error instanceof Error ? error.message : message("ui.could.not.save.the.marker") } })
        return
      }
    }
  }
  moveMarker = async (id: string, point: Point) => {
    const marker = this.state.markers.find((m) => m.id === id)
    if (!this.ready() || this.state.draft || !marker || marker.locked || (point.x === marker.x && point.y === marker.y)) return
    const next = { ...marker, x: point.x, y: point.y }
    try { validateMarker(next); await this.commit(this.state.regions, undefined, 'edit', false, this.state.markers.map((m) => m.id === id ? next : m)) } catch (error) { this.fail(error) }
  }
  removeMarker = async (id = this.state.selectedMarkerId) => {
    if (!this.ready() || this.state.draft || !id) return
    await this.commit(this.state.regions, undefined, 'edit', false, this.state.markers.filter((m) => m.id !== id))
  }
  changeStatus = async (entityId: string, status: string) => {
    const entity = this.state.entities.find((e) => e.id === entityId)
    if (!entity || status === entity.status || !this.canChangeStatus()) return
    await this.writeStatus({ entityId, before: entity.status, after: status }, 'change')
  }
  private canChangeStatus() { return this.canEditProject() && this.loaded && !this.busy() && !this.hasUnsavedDetails() && !this.detailsSaving() && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges() && !this.state.draft && !this.state.markerTool && !this.state.vertexMode }
  undoStatus = async () => { const command = this.statusUndo.at(-1); if (command && this.canChangeStatus()) await this.writeStatus(command, 'undo') }
  redoStatus = async () => { const command = this.statusRedo.at(-1); if (command && this.canChangeStatus()) await this.writeStatus(command, 'redo') }
  retryStatus = async () => {
    const action = this.state.statusAction
    if (action?.phase === 'error' && this.canChangeStatus()) await this.writeStatus({ entityId: action.entityId, before: action.before, after: action.after }, action.kind)
  }
  dismissStatusError = () => { if (this.state.statusAction?.phase !== 'saving') this.update({ statusAction: undefined }) }
  private async writeStatus(command: StatusCommand, kind: StatusAction['kind']) {
    const projectId = this.projects.getSnapshot().project?.id
    if (!projectId) return
    const before = kind === 'undo' ? command.after : command.before
    const after = kind === 'undo' ? command.before : command.after
    this.update({ statusAction: { ...command, kind, phase: 'saving' } })
    try {
      let entity!: Entity
      await this.projects.mutateProject(async (project) => { const result = await this.repository.saveStatus(project, command.entityId, before, after); entity = result.entity; return result.project })
      if (this.projects.getSnapshot().project?.id !== projectId || (this.modeProjectId && this.modeProjectId !== projectId)) return
      if (kind === 'change') { this.statusUndo.push(command); if (this.statusUndo.length > 100) this.statusUndo.shift(); this.statusRedo = [] }
      else if (kind === 'undo') this.statusRedo.push(this.statusUndo.pop()!)
      else this.statusUndo.push(this.statusRedo.pop()!)
      this.update({ entities: this.state.entities.map((e) => e.id === entity.id ? entity : e), statusAction: { ...command, kind, phase: 'saved' } })
    } catch (error) {
      if (this.projects.getSnapshot().project?.id === projectId) this.update({ statusAction: { ...command, kind, phase: 'error', error: message("ui.could.not.save.status.value", { p0: error instanceof Error ? error.message : '' }) } })
    }
  }
  private async commit(next: Region[], selectedId?: string, kind: 'edit' | 'undo' | 'redo' = 'edit', finishDraft = false, markers = this.state.markers) {
    const before = structuredClone(this.state.regions)
    const markersBefore = structuredClone(this.state.markers)
    const nextMarkers = markers.map((m) => ({ ...m, regionIds: m.regionIds.filter((id) => next.some((r) => r.id === id)) }))
    const mapId = this.state.mapId!
    this.retryWork = undefined
    this.update({ phase: 'saving', error: undefined })
    try {
      await this.projects.mutateProject((project) => this.repository.save(project, mapId, next, [], { entities: this.state.entities, markers: nextMarkers }))
      if (kind === 'edit') {
        this.undoStack.push({ before, after: structuredClone(next), markersBefore, markersAfter: structuredClone(nextMarkers), selectedId: selectedId ?? this.state.selectedId })
        if (this.undoStack.length > 100) this.undoStack.shift()
        this.redoStack = []
      } else if (kind === 'undo') this.redoStack.push(this.undoStack.pop()!)
      else this.undoStack.push(this.redoStack.pop()!)
      // A clean edit form may remain open through undo or a drag. Rebase its
      // placement so the next text save cannot restore outdated coordinates.
      const draft = this.state.markerDraft
      const draftMarker = draft && nextMarkers.find((m) => m.id === draft.marker.id)
      const markerDraft = draft && draftMarker ? { ...draft, marker: structuredClone(draftMarker), fields: markerDetailsOf(draft.entity, draftMarker) } : undefined
      this.update({ regions: next, markers: nextMarkers, markerDraft, selectedId: next.some((r) => r.id === selectedId) ? selectedId : undefined, cardId: next.some((r) => r.id === this.state.cardId) ? this.state.cardId : undefined, markerCardId: nextMarkers.some((m) => m.id === this.state.markerCardId) ? this.state.markerCardId : undefined, selectedMarkerId: nextMarkers.some((m) => m.id === this.state.selectedMarkerId) ? this.state.selectedMarkerId : undefined, selectedVertex: undefined, phase: 'saved', ...(finishDraft ? { draft: undefined } : {}) })
    } catch (error) {
      this.retryWork = () => this.commit(next, selectedId, kind, finishDraft, markers)
      this.fail(error)
    }
  }
}
