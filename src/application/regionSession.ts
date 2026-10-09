import type { RegionRepository } from './regionRepository'
import type { ProjectSession } from './projectSession'
import type { Point } from '../domain/viewport'
import { MAX_REGIONS, MAX_REGION_VERTICES, samePoint, validatePolygon, validateRegion } from '../domain/region'
import type { Region } from '../domain/region'

export interface RegionState {
  mapId?: string
  regions: Region[]
  phase: 'idle' | 'loading' | 'saved' | 'saving' | 'error'
  selectedId?: string
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
  private state: RegionState = { regions: [], phase: 'idle', vertexMode: false, canUndo: false, canRedo: false, canRetry: false }
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
  ready = () => this.loaded && !!this.state.mapId && !this.busy() && !this.projects.getSnapshot().loading && !this.projects.hasUnsavedChanges()
  load = async (mapId?: string) => {
    const generation = ++this.generation
    this.loaded = false
    this.undoStack = []; this.redoStack = []; this.retryWork = undefined
    this.update({ mapId, regions: [], phase: mapId ? 'loading' : 'idle', selectedId: undefined, selectedVertex: undefined, vertexMode: false, draft: undefined, error: undefined })
    if (!mapId) return
    try {
      const regions = await this.repository.load(mapId)
      if (generation === this.generation) { this.loaded = true; this.update({ regions, phase: 'saved' }) }
    } catch (error) {
      if (generation === this.generation) { this.retryWork = () => this.load(mapId); this.fail(error) }
    }
  }
  private fail(error: unknown) { this.update({ phase: 'error', error: error instanceof Error ? error.message : 'Не удалось сохранить области.' }) }
  dismiss = () => { this.retryWork = undefined; this.update({ error: undefined }) }
  retry = async () => { if (!this.busy()) await this.retryWork?.() }
  select = (id?: string) => { if (!this.busy() && !this.state.draft) this.update({ selectedId: id, vertexMode: false, selectedVertex: undefined }) }
  setVertexMode = (value: boolean) => { if (!this.busy()) this.update({ vertexMode: value, selectedVertex: undefined }) }
  selectVertex = (index?: number) => { if (!this.busy()) this.update({ selectedVertex: index }) }
  start = (first?: Point) => {
    if (!this.ready()) return
    this.dismiss()
    this.update({ draft: first ? [{ ...first }] : [], selectedId: undefined, selectedVertex: undefined, vertexMode: false })
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
      const region: Region = { id: crypto.randomUUID(), mapId: this.state.mapId!, vertices: structuredClone(this.state.draft), order: Math.max(-1, ...this.state.regions.map((r) => r.order)) + 1, number, title: `Область ${number}`, color: '#d7ad62', fillOpacity: 0.4 }
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
      this.update({ regions: next, selectedId: next.some((r) => r.id === selectedId) ? selectedId : undefined, selectedVertex: undefined, phase: 'saved', ...(finishDraft ? { draft: undefined } : {}) })
    } catch (error) {
      this.retryWork = () => this.commit(next, selectedId, kind, finishDraft)
      this.fail(error)
    }
  }
}
