import type { RegionRepository } from './regionRepository'
import type { ProjectSession } from './projectSession'
import type { Point } from '../domain/viewport'
import { emptyRegionContent, labelAnchor, MAX_REGIONS, MAX_REGION_VERTICES, regionHasUserContent, samePoint, validatePolygon, validateRegion } from '../domain/region'
import { documentAssetIds } from '../domain/richText'
import type { Region, RegionContent } from '../domain/region'
import type { Asset } from '../domain/project'
import { markerTypes, statusesOf, validateEntity, validateMarker, MAX_MARKERS, MAX_ENTITIES } from '../domain/marker'
import type { Entity, MarkerPlacement, MarkerKind } from '../domain/marker'
import { emptyDocument } from '../domain/richText'

export interface RegionDetails extends RegionContent { number: string; title: string; color: string; fillOpacity: number }
interface DetailsDraft { fields: RegionDetails; assets: Asset[]; version: number; phase: 'dirty' | 'saving' | 'error'; error?: string }
export const detailsOf = (region: Region): RegionDetails => ({ number: String(region.number), title: region.title, color: region.color, fillOpacity: region.fillOpacity, gmNotes: structuredClone(region.gmNotes), playerDescription: structuredClone(region.playerDescription), checks: structuredClone(region.checks), tags: [...region.tags] })
export interface MarkerDetails { name: string; description: Entity['description']; tags: string[]; status: string; color: string; regionIds: string[]; locked: boolean }
export const markerDetailsOf = (entity: Entity, marker: MarkerPlacement): MarkerDetails => ({ name: entity.name, description: structuredClone(entity.description), tags: [...entity.tags], status: entity.status, color: marker.color, regionIds: [...marker.regionIds], locked: marker.locked })
export interface MarkerDraft { entity: Entity; marker: MarkerPlacement; fields: MarkerDetails; assets: Asset[]; isNew: boolean; version: number; phase: 'dirty' | 'saving' | 'error'; error?: string }
type CardIntent = { kind: 'open'; id: string; center?: boolean } | { kind: 'marker'; id: string; center?: boolean } | { kind: 'close' } | { kind: 'vertices' }

export interface RegionState {
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
  private state: RegionState = { regions: [], entities: [], markers: [], details: {}, assets: {}, cardMode: 'view', imagePending: 0, phase: 'idle', vertexMode: false, canUndo: false, canRedo: false, canRetry: false }
  private detailsWork?: Promise<void>
  private markerWork?: Promise<void>
  private listeners = new Set<() => void>()
  private generation = 0
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private retryWork?: () => Promise<void>
  private loaded = false
  constructor(private readonly repository: RegionRepository, private readonly projects: ProjectSession) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(fields: Partial<RegionState>) {
    this.state = { ...this.state, ...fields, canUndo: !!this.undoStack.length, canRedo: !!this.redoStack.length, canRetry: !!this.retryWork }
    this.listeners.forEach((listener) => listener())
  }
  busy = () => ['loading', 'saving'].includes(this.state.phase)
  hasLoaded = () => this.loaded
  isDetailsDirty = (id: string) => {
    const region = this.state.regions.find((r) => r.id === id)
    const draft = this.state.details[id]
    return !!draft && !!region && (draft.phase === 'saving' || draft.phase === 'error' || JSON.stringify(draft.fields) !== JSON.stringify(detailsOf(region)))
  }
  isMarkerDirty = () => !!this.state.markerDraft && (this.state.markerDraft.isNew || this.state.markerDraft.phase === 'error' || this.state.markerDraft.phase === 'saving' || JSON.stringify(this.state.markerDraft.fields) !== JSON.stringify(markerDetailsOf(this.state.markerDraft.entity, this.state.markerDraft.marker)))
  hasUnsavedDetails = () => Object.keys(this.state.details).some(this.isDetailsDirty) || this.isMarkerDirty() || this.state.imagePending > 0
  detailsSaving = () => !!this.detailsWork || !!this.markerWork || Object.values(this.state.details).some((draft) => draft.phase === 'saving')
  ready = () => this.loaded && !!this.state.mapId && !this.busy() && !this.hasUnsavedDetails() && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  load = async (mapId?: string) => {
    const generation = ++this.generation
    this.loaded = false
    this.undoStack = []; this.redoStack = []; this.retryWork = undefined
    this.update({ mapId, regions: [], entities: [], markers: [], markerTool: undefined, markerDraft: undefined, markerCardId: undefined, selectedMarkerId: undefined, details: {}, assets: {}, cardId: undefined, cardMode: 'view', pendingIntent: undefined, viewFocus: undefined, imagePending: 0, imageError: undefined, phase: mapId ? 'loading' : 'idle', selectedId: undefined, selectedVertex: undefined, vertexMode: false, draft: undefined, error: undefined })
    if (!mapId) return
    try {
      const [regions, assets, objects] = await Promise.all([this.repository.load(mapId), this.repository.loadAssets(mapId), this.repository.loadObjects(mapId)])
      if (objects.markers.some((m) => m.regionIds.some((id) => !regions.some((r) => r.id === id)))) throw new Error('Область маркера не найдена.')
      if (generation === this.generation) { this.loaded = true; this.update({ regions, ...objects, assets: Object.fromEntries(assets.map((a) => [a.id, a])), phase: 'saved' }) }
    } catch (error) {
      if (generation === this.generation) { this.retryWork = () => this.load(mapId); this.fail(error) }
    }
  }
  private fail(error: unknown) { this.update({ phase: 'error', error: error instanceof Error ? error.message : 'Не удалось сохранить объекты карты.' }) }
  dismiss = () => { this.retryWork = undefined; this.update({ error: undefined }) }
  retry = async () => { if (!this.busy()) await this.retryWork?.() }
  select = (id?: string) => { if (!this.busy() && !this.state.draft && !this.hasUnsavedDetails()) this.update({ selectedId: id ?? this.state.cardId, selectedMarkerId: id ? undefined : this.state.markerCardId, selectedVertex: undefined }) }
  openCard = (id: string, center = false) => {
    if (!this.busy() && !this.state.draft && !this.state.markerTool && !this.state.vertexMode && this.state.regions.some((r) => r.id === id) && id !== this.state.cardId) this.requestCardIntent({ kind: 'open', id, ...(center ? { center: true } : {}) })
  }
  closeCard = () => this.requestCardIntent({ kind: 'close' })
  beginEdit = () => {
    const region = this.state.regions.find((r) => r.id === this.state.cardId)
    if (!region || this.busy() || this.detailsSaving()) return
    this.update({ cardMode: 'edit', vertexMode: false, selectedVertex: undefined, details: { ...this.state.details, [region.id]: this.state.details[region.id] ?? { fields: detailsOf(region), assets: [], version: 0, phase: 'dirty' } } })
  }
  cancelEdit = () => {
    if (this.detailsSaving() || this.state.imagePending) return
    if (this.state.cardId) this.discardDetails(this.state.cardId)
    this.update({ cardMode: 'view', imageError: undefined })
  }
  private requestCardIntent(intent: CardIntent) {
    if (this.detailsSaving() || this.state.imagePending) return
    if ((this.state.cardId && this.isDetailsDirty(this.state.cardId)) || this.isMarkerDirty()) this.update({ pendingIntent: intent })
    else this.applyCardIntent(intent)
  }
  private applyCardIntent(intent: CardIntent) {
    if (this.state.cardId) this.discardDetails(this.state.cardId)
    this.update({ pendingIntent: undefined, imageError: undefined, markerDraft: undefined, markerCardId: undefined, selectedMarkerId: undefined, markerTool: undefined })
    if (intent.kind === 'open') {
      const region = this.state.regions.find((r) => r.id === intent.id)!
      this.update({ cardId: intent.id, cardMode: 'view', selectedId: intent.id, vertexMode: false, selectedVertex: undefined, ...(intent.center ? { viewFocus: { point: labelAnchor(region.vertices) } } : {}) })
      if (!regionHasUserContent(region)) this.beginEdit()
    } else if (intent.kind === 'marker') {
      const marker = this.state.markers.find((m) => m.id === intent.id)!
      this.update({ cardId: undefined, selectedId: undefined, selectedVertex: undefined, vertexMode: false, markerCardId: intent.id, selectedMarkerId: intent.id, cardMode: 'view', ...(intent.center ? { viewFocus: { point: { x: marker.x, y: marker.y } } } : {}) })
    } else if (intent.kind === 'vertices') this.update({ cardMode: 'view', vertexMode: true, selectedVertex: undefined })
    else this.update({ cardId: undefined, cardMode: 'view', selectedId: undefined, vertexMode: false, selectedVertex: undefined })
  }
  resolveCardIntent = async (choice: 'save' | 'discard' | 'stay') => {
    const intent = this.state.pendingIntent
    if (!intent || this.detailsSaving()) return
    if (choice === 'stay') { this.update({ pendingIntent: undefined }); return }
    if (choice === 'save') { if (this.state.markerDraft) await this.saveMarkerDetails(); else await this.saveDetails(); if (this.hasUnsavedDetails()) return }
    this.applyCardIntent(intent)
  }
  discardDetails = (id: string) => {
    if (this.detailsSaving()) return
    const details = { ...this.state.details }; delete details[id]
    this.update({ details })
  }
  setVertexMode = (value: boolean) => { if (!this.busy()) { if (value) this.requestCardIntent({ kind: 'vertices' }); else this.update({ vertexMode: false, selectedVertex: undefined }) } }
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
    if (this.state.draft.length >= MAX_REGION_VERTICES) { this.fail(new Error(`Допустимо не более ${MAX_REGION_VERTICES} вершин области.`)); return }
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
      if (this.state.regions.length >= MAX_REGIONS) throw new Error(`Допустимо не более ${MAX_REGIONS} областей.`)
      const number = Math.max(0, ...this.state.regions.map((r) => r.number)) + 1
      const region: Region = { ...emptyRegionContent(), titleCustomized: false, id: crypto.randomUUID(), mapId: this.state.mapId!, vertices: structuredClone(this.state.draft), order: Math.max(-1, ...this.state.regions.map((r) => r.order)) + 1, number, title: `Область ${number}`, color: '#d7ad62', fillOpacity: 0.4 }
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
    if (region.vertices.length <= 3) { this.fail(new Error('После удаления должны остаться минимум три вершины.')); return }
    await this.change({ ...region, vertices: region.vertices.filter((_, i) => i !== index) })
  }
  undo = async () => {
    const command = this.undoStack.at(-1)
    if (command && this.ready() && !this.state.draft) await this.commit(command.before, command.selectedId, 'undo', false, command.markersBefore)
  }
  redo = async () => {
    const command = this.redoStack.at(-1)
    if (command && this.ready() && !this.state.draft) await this.commit(command.after, command.selectedId, 'redo', false, command.markersAfter)
  }
  editDetails = (id: string, fields: RegionDetails) => {
    if (!this.loaded || this.busy() || !this.state.regions.some((r) => r.id === id) || this.projects.hasUnsavedChanges() || (this.projects.getSnapshot().loading && !this.detailsSaving())) return
    const version = (this.state.details[id]?.version ?? 0) + 1
    this.update({ details: { ...this.state.details, [id]: { fields: structuredClone(fields), assets: this.state.details[id]?.assets ?? [], version, phase: 'dirty' } } })
  }
  beginImageInsertion = () => this.update({ imagePending: this.state.imagePending + 1, imageError: undefined })
  reportImageError = (error: unknown) => this.update({ imageError: error instanceof Error ? error.message : 'Не удалось вставить изображение или текст.' })
  endImageInsertion = (error?: unknown) => this.update({ imagePending: Math.max(0, this.state.imagePending - 1), imageError: error ? error instanceof Error ? error.message : 'Не удалось вставить изображение.' : undefined })
  addDraftAsset = (id: string, asset: Asset) => {
    const region = this.state.regions.find((r) => r.id === id)
    if (!region) return
    const draft = this.state.details[id] ?? { fields: detailsOf(region), assets: [], version: 0, phase: 'dirty' as const }
    this.update({ details: { ...this.state.details, [id]: { ...draft, assets: [...draft.assets, asset] } } })
  }
  getProjectId = () => this.projects.getSnapshot().project?.id
  saveDetails = (includeErrors = true): Promise<void> => {
    if (this.state.imagePending) return Promise.resolve()
    if (this.detailsWork) return includeErrors ? this.detailsWork.then(() => this.hasUnsavedDetails() ? this.saveDetails() : undefined) : this.detailsWork
    this.detailsWork = this.writeDetails(includeErrors).finally(() => { this.detailsWork = undefined; this.update({}) })
    return this.detailsWork
  }
  flushDetails = async () => {
    if (this.hasUnsavedDetails()) throw new Error('Сначала сохраните или отмените изменения карточки.')
  }
  private async writeDetails(includeErrors: boolean) {
    while (true) {
      const entry = Object.entries(this.state.details).find(([, draft]) => includeErrors || draft.phase === 'dirty')
      if (!entry) return
      const [id, draft] = entry
      const mapId = this.state.mapId!
      const fields = structuredClone(draft.fields)
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
        await this.projects.mutateProject((project) => this.repository.save(project, mapId, next, newAssets, { entities: this.state.entities, markers: this.state.markers }))
        if (generation !== this.generation) return
        // Geometry history must never undo subsequently written text.
        for (const command of [...this.undoStack, ...this.redoStack]) {
          for (const list of [command.before, command.after]) {
            const row = list.find((r) => r.id === id)
            if (row) Object.assign(row, structuredClone(details))
          }
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
        this.update({ details: { ...this.state.details, [id]: { ...current, phase: 'error', error: error instanceof Error ? error.message : 'Не удалось сохранить карточку.' } } })
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
    if (this.state.markers.length >= MAX_MARKERS || this.state.entities.length >= MAX_ENTITIES) { this.fail(new Error('Достигнут лимит маркеров или сущностей проекта.')); return }
    const kind = this.state.markerTool
    const entity: Entity = { id: crypto.randomUUID(), projectId: this.getProjectId()!, kind, name: markerTypes[kind].label, description: emptyDocument(), status: Object.keys(statusesOf(kind))[0], tags: [] }
    const marker: MarkerPlacement = { id: crypto.randomUUID(), entityId: entity.id, mapId: this.state.mapId!, x: point.x, y: point.y, regionIds: [], color: '#d7ad62', locked: false, order: Math.max(-1, ...this.state.markers.map((m) => m.order)) + 1 }
    try { validateMarker(marker) } catch (error) { this.fail(error); return }
    this.update({ markerTool: undefined, markerCardId: marker.id, selectedMarkerId: marker.id, cardId: undefined, selectedId: undefined, vertexMode: false, cardMode: 'edit', markerDraft: { entity, marker, fields: markerDetailsOf(entity, marker), assets: [], isNew: true, phase: 'dirty', version: 0 } })
  }
  selectMarker = (id: string) => { if (this.ready()) this.update({ selectedMarkerId: id, selectedId: undefined, selectedVertex: undefined }) }
  canMoveMarkerDraft = (id: string) => !!this.state.markerDraft?.isNew && this.state.markerDraft.marker.id === id && !this.state.markerDraft.fields.locked && !this.busy() && !this.detailsSaving() && !this.state.imagePending && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  moveMarkerDraft = (id: string, point: Point) => {
    if (!this.canMoveMarkerDraft(id)) return
    const draft = this.state.markerDraft!
    const marker = { ...draft.marker, x: point.x, y: point.y }
    try {
      validateMarker(marker)
      this.update({ markerDraft: { ...draft, marker, version: draft.version + 1 } })
    } catch (error) { this.update({ markerDraft: { ...draft, phase: 'error', error: error instanceof Error ? error.message : 'Не удалось переместить черновик маркера.' } }) }
  }
  openMarkerCard = (id: string, center = false) => {
    if (!this.busy() && !this.state.draft && !this.state.markerTool && !this.state.vertexMode && id !== this.state.markerCardId && this.state.markers.some((m) => m.id === id)) this.requestCardIntent({ kind: 'marker', id, ...(center ? { center: true } : {}) })
  }
  beginMarkerEdit = () => {
    const marker = this.state.markers.find((m) => m.id === this.state.markerCardId)
    const entity = this.state.entities.find((e) => e.id === marker?.entityId)
    if (!marker || !entity || this.busy() || this.detailsSaving()) return
    this.update({ cardMode: 'edit', markerDraft: { entity, marker, fields: markerDetailsOf(entity, marker), assets: [], isNew: false, version: 0, phase: 'dirty' } })
  }
  editMarkerDetails = (fields: MarkerDetails) => {
    const draft = this.state.markerDraft
    if (!draft || this.busy() || this.projects.hasUnsavedChanges() || (this.projects.getSnapshot().loading && !this.markerWork)) return
    this.update({ markerDraft: { ...draft, fields: structuredClone(fields), version: draft.version + 1, phase: 'dirty', error: undefined } })
  }
  cancelMarkerEdit = () => {
    if (this.detailsSaving() || this.state.imagePending) return
    if (this.state.markerDraft?.isNew) this.applyCardIntent({ kind: 'close' })
    else this.update({ markerDraft: undefined, cardMode: 'view', imageError: undefined })
  }
  addMarkerDraftAsset = (asset: Asset) => {
    if (this.state.markerDraft) this.update({ markerDraft: { ...this.state.markerDraft, assets: [...this.state.markerDraft.assets, asset] } })
  }
  saveMarkerDetails = (): Promise<void> => {
    if (this.state.imagePending) return Promise.resolve()
    if (this.markerWork) return this.markerWork
    this.markerWork = this.writeMarkerDetails().finally(() => { this.markerWork = undefined; this.update({}) })
    return this.markerWork
  }
  private async writeMarkerDetails() {
    const generation = this.generation
    while (this.state.markerDraft) {
      const draft = this.state.markerDraft
      const fields = structuredClone(draft.fields)
      const entity: Entity = { ...draft.entity, name: fields.name.trim(), description: fields.description, tags: fields.tags, status: fields.status }
      const marker: MarkerPlacement = { ...draft.marker, color: fields.color, locked: fields.locked, regionIds: [...fields.regionIds] }
      try {
        validateEntity(entity); validateMarker(marker)
        if (marker.regionIds.some((id) => !this.state.regions.some((r) => r.id === id))) throw new Error('Выберите области текущей карты.')
        const entities = [...this.state.entities.filter((e) => e.id !== entity.id), entity]
        const markersBefore = structuredClone(this.state.markers)
        const markers = draft.isNew ? [...this.state.markers, marker] : this.state.markers.map((m) => m.id === marker.id ? marker : m)
        const referenced = new Set(documentAssetIds(entity.description))
        const newAssets = draft.assets.filter((a) => referenced.has(a.id))
        this.update({ markerDraft: { ...draft, phase: 'saving', error: undefined } })
        await this.projects.mutateProject((project) => this.repository.save(project, marker.mapId, this.state.regions, newAssets, { entities, markers }))
        if (generation !== this.generation) return
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
        if (generation === this.generation && this.state.markerDraft) this.update({ markerDraft: { ...this.state.markerDraft, phase: 'error', error: error instanceof Error ? error.message : 'Не удалось сохранить маркер.' } })
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
