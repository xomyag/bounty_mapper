import { message } from '../i18n/message'
import type { Asset } from '../domain/project'
import type { MapImage, MapImageRepository } from './mapImageRepository'
import type { ProjectSession } from './projectSession'
import type { WorkspaceRepository } from './workspaceRepository'
import type { ViewportMemory } from './viewportMemory'

export interface MapImageState {
  projectId?: string
  image: MapImage
  phase: 'idle' | 'loading' | 'uploading' | 'saving' | 'saved' | 'error'
  error?: string
  selectionError?: string
}

export class MapImageSession {
  private state: MapImageState = { image: {}, phase: 'idle' }
  private listeners = new Set<() => void>()
  private loadVersion = 0
  private retryAction?: () => Promise<void>
  private readonly repository: MapImageRepository
  private readonly projects: ProjectSession
  private readonly prepare: (file: Blob, projectId: string) => Promise<Asset>
  private attemptedSelection?: string
  private selectionWork = Promise.resolve()
  constructor(repository: MapImageRepository, projects: ProjectSession, prepare: (file: Blob, projectId: string) => Promise<Asset>, private readonly canEdit: () => boolean = () => true, private options: { workspace?: WorkspaceRepository; viewports?: ViewportMemory; prepareOpen?: (image: MapImage) => Promise<void> } = {}) {
    this.repository = repository
    this.projects = projects
    this.prepare = prepare
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private update(state: MapImageState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
  busy = () => ['loading', 'uploading', 'saving'].includes(this.state.phase)
  load = async (projectId?: string) => {
    const version = ++this.loadVersion
    this.retryAction = undefined
    this.attemptedSelection = undefined
    this.update({ projectId, image: {}, phase: projectId ? 'loading' : 'idle' })
    if (!projectId) return
    try {
      const workspace = await this.options.workspace?.load(projectId)
      const image = await this.repository.load(projectId,workspace?.mapId)
      await this.options.prepareOpen?.(image)
      if (version === this.loadVersion) {
        this.options.viewports?.hydrate(projectId,workspace?.cameras ?? {})
        this.update({ projectId, image, phase: image.background ? 'saved' : 'idle' })
      }
    } catch (error) {
      if (version !== this.loadVersion) return
      this.retryAction = () => this.load(projectId)
      this.update({ ...this.state, phase: 'error', error: message("ui.map.read.failed.value", { p0: error instanceof Error ? error.message : '' }) })
    }
  }
  confirmSelection = () => {
    const { projectId,image } = this.state
    const mapId = image.map?.id
    if (!projectId || !mapId || !this.options.workspace) return this.selectionWork
    const key = `${projectId}:${mapId}`
    if (this.attemptedSelection === key) return this.selectionWork
    this.attemptedSelection = key
    this.selectionWork = this.selectionWork.then(async () => {
      try {
        await this.options.workspace!.select(projectId,mapId)
        if (this.attemptedSelection === key) this.update({ ...this.state,selectionError: undefined })
      } catch (error) {
        if (this.attemptedSelection === key) this.update({ ...this.state,selectionError: message('order.selectionFailed',{detail:error instanceof Error ? error.message : ''}) })
      }
    })
    return this.selectionWork
  }
  retrySelection = () => { this.attemptedSelection = undefined; return this.confirmSelection() }
  upload = (file: Blob) => this.change(file)
  remove = () => this.change()
  retry = () => this.retryAction?.() ?? Promise.resolve()
  align = async (point: { x: number; y: number }) => {
    const mapId = this.state.image.map?.id
    if (!this.canEdit() || !mapId || !this.repository.align || this.busy()) throw new Error(message('alignment.invalid'))
    let image!: MapImage
    await this.projects.mutateProject(async (project) => { const result = await this.repository.align!(project, mapId, point); image = result.image; return result.project })
    this.update({ ...this.state, image, phase: 'saved', error: undefined })
  }
  readSelection = (mapId: string) => this.repository.load(this.projects.getSnapshot().project!.id, mapId)
  adoptSelection = (image: MapImage) => {
    ++this.loadVersion
    this.retryAction = undefined
    this.update({ projectId: this.projects.getSnapshot().project!.id, image, phase: 'saved' })
  }
  private async change(file?: Blob) {
    if (this.busy() || !this.canEdit()) return
    const project = this.projects.getSnapshot().project
    if (!project || project.id !== this.state.projectId) return
    let writing = false
    try {
      await this.projects.mutateProject(async (current) => {
        this.update({ ...this.state, phase: file ? 'uploading' : 'saving', error: undefined })
        const asset = file ? await this.prepare(file, current.id) : undefined
        writing = true
        this.update({ ...this.state, phase: 'saving' })
        const result = asset ? await this.repository.replace(current, asset, this.state.image.map?.id) : await this.repository.remove(current, this.state.image.map?.id)
        this.retryAction = undefined
        this.update({ ...this.state, image: result.image, phase: 'saved', error: undefined })
        return result.project
      })
    } catch (error) {
      this.retryAction = () => this.change(file)
      this.update({ ...this.state, phase: 'error', error: message(writing ? "errors.imageWrite" : "errors.imageLoad", { detail: error instanceof Error ? error.message : '' }) })
    }
  }
}
