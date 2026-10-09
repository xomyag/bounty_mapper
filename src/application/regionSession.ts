import type { RegionRepository } from './regionRepository'
import type { ProjectSession } from './projectSession'
import type { Point } from '../domain/viewport'
import { emptyRegionContent, MAX_REGIONS, MAX_REGION_VERTICES, regionHasUserContent, samePoint, validatePolygon, validateRegion } from '../domain/region'
import { documentAssetIds } from '../domain/richText'
import type { Region, RegionContent } from '../domain/region'
import type { Asset } from '../domain/project'

export interface RegionDetails extends RegionContent { number: string; title: string; color: string; fillOpacity: number }
interface DetailsDraft { fields: RegionDetails; assets: Asset[]; version: number; phase: 'dirty' | 'saving' | 'error'; error?: string }
export const detailsOf = (region: Region): RegionDetails => ({ number: String(region.number), title: region.title, color: region.color, fillOpacity: region.fillOpacity, gmNotes: structuredClone(region.gmNotes), playerDescription: structuredClone(region.playerDescription), checks: structuredClone(region.checks), tags: [...region.tags] })
type CardIntent = { kind: 'open'; id: string } | { kind: 'close' } | { kind: 'vertices' }

export interface RegionState {
  mapId?: string
  regions: Region[]
  phase: 'idle' | 'loading' | 'saved' | 'saving' | 'error'
  selectedId?: string
  cardId?: string
  cardMode: 'view' | 'edit'
  pendingIntent?: CardIntent
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
interface Command { before: Region[]; after: Region[]; selectedId?: string }

export class RegionSession {
  private state: RegionState = { regions: [], details: {}, assets: {}, cardMode: 'view', imagePending: 0, phase: 'idle', vertexMode: false, canUndo: false, canRedo: false, canRetry: false }
  private detailsWork?: Promise<void>
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
  hasUnsavedDetails = () => Object.keys(this.state.details).some(this.isDetailsDirty) || this.state.imagePending > 0
  detailsSaving = () => !!this.detailsWork || Object.values(this.state.details).some((draft) => draft.phase === 'saving')
  ready = () => this.loaded && !!this.state.mapId && !this.busy() && !this.hasUnsavedDetails() && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  load = async (mapId?: string) => {
    const generation = ++this.generation
    this.loaded = false
    this.undoStack = []; this.redoStack = []; this.retryWork = undefined
    this.update({ mapId, regions: [], details: {}, assets: {}, cardId: undefined, cardMode: 'view', pendingIntent: undefined, imagePending: 0, imageError: undefined, phase: mapId ? 'loading' : 'idle', selectedId: undefined, selectedVertex: undefined, vertexMode: false, draft: undefined, error: undefined })
    if (!mapId) return
    try {
      const [regions, assets] = await Promise.all([this.repository.load(mapId), this.repository.loadAssets(mapId)])
      if (generation === this.generation) { this.loaded = true; this.update({ regions, assets: Object.fromEntries(assets.map((a) => [a.id, a])), phase: 'saved' }) }
    } catch (error) {
      if (generation === this.generation) { this.retryWork = () => this.load(mapId); this.fail(error) }
    }
  }
  private fail(error: unknown) { this.update({ phase: 'error', error: error instanceof Error ? error.message : 'Не удалось сохранить области.' }) }
  dismiss = () => { this.retryWork = undefined; this.update({ error: undefined }) }
  retry = async () => { if (!this.busy()) await this.retryWork?.() }
  select = (id?: string) => { if (!this.busy() && !this.state.draft && !this.hasUnsavedDetails()) this.update({ selectedId: id ?? this.state.cardId, selectedVertex: undefined }) }
  openCard = (id: string) => {
    if (!this.busy() && !this.state.draft && !this.state.vertexMode && this.state.regions.some((r) => r.id === id) && id !== this.state.cardId) this.requestCardIntent({ kind: 'open', id })
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
    if (this.state.cardId && this.isDetailsDirty(this.state.cardId)) this.update({ pendingIntent: intent })
    else this.applyCardIntent(intent)
  }
  private applyCardIntent(intent: CardIntent) {
    if (this.state.cardId) this.discardDetails(this.state.cardId)
    this.update({ pendingIntent: undefined, imageError: undefined })
    if (intent.kind === 'open') {
      const region = this.state.regions.find((r) => r.id === intent.id)!
      this.update({ cardId: intent.id, cardMode: 'view', selectedId: intent.id, vertexMode: false, selectedVertex: undefined })
      if (!regionHasUserContent(region)) this.beginEdit()
    } else if (intent.kind === 'vertices') this.update({ cardMode: 'view', vertexMode: true, selectedVertex: undefined })
    else this.update({ cardId: undefined, cardMode: 'view', selectedId: undefined, vertexMode: false, selectedVertex: undefined })
  }
  resolveCardIntent = async (choice: 'save' | 'discard' | 'stay') => {
    const intent = this.state.pendingIntent
    if (!intent || this.detailsSaving()) return
    if (choice === 'stay') { this.update({ pendingIntent: undefined }); return }
    if (choice === 'save') { await this.saveDetails(); if (this.hasUnsavedDetails()) return }
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
    this.dismiss()
    this.update({ draft: first ? [{ ...first }] : [], cardId: undefined, selectedId: undefined, selectedVertex: undefined, vertexMode: false })
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
    if (command && this.ready() && !this.state.draft) await this.commit(command.before, command.selectedId, 'undo')
  }
  redo = async () => {
    const command = this.redoStack.at(-1)
    if (command && this.ready() && !this.state.draft) await this.commit(command.after, command.selectedId, 'redo')
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
        await this.projects.mutateProject((project) => this.repository.save(project, mapId, next, newAssets))
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
  private async commit(next: Region[], selectedId?: string, kind: 'edit' | 'undo' | 'redo' = 'edit', finishDraft = false) {
    const before = structuredClone(this.state.regions)
    const mapId = this.state.mapId!
    this.retryWork = undefined
    this.update({ phase: 'saving', error: undefined })
    try {
      await this.projects.mutateProject((project) => this.repository.save(project, mapId, next))
      if (kind === 'edit') {
        this.undoStack.push({ before, after: structuredClone(next), selectedId: selectedId ?? this.state.selectedId })
        if (this.undoStack.length > 100) this.undoStack.shift()
        this.redoStack = []
      } else if (kind === 'undo') this.redoStack.push(this.undoStack.pop()!)
      else this.undoStack.push(this.redoStack.pop()!)
      this.update({ regions: next, selectedId: next.some((r) => r.id === selectedId) ? selectedId : undefined, cardId: next.some((r) => r.id === this.state.cardId) ? this.state.cardId : undefined, selectedVertex: undefined, phase: 'saved', ...(finishDraft ? { draft: undefined } : {}) })
    } catch (error) {
      this.retryWork = () => this.commit(next, selectedId, kind, finishDraft)
      this.fail(error)
    }
  }
}
