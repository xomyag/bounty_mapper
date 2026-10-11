import type { Asset } from '../domain/project'
import type { MapImage, MapImageRepository } from './mapImageRepository'
import type { ProjectSession } from './projectSession'

export interface MapImageState {
  projectId?: string
  image: MapImage
  phase: 'idle' | 'loading' | 'uploading' | 'saving' | 'saved' | 'error'
  error?: string
}

export class MapImageSession {
  private state: MapImageState = { image: {}, phase: 'idle' }
  private listeners = new Set<() => void>()
  private loadVersion = 0
  private retryAction?: () => Promise<void>
  private readonly repository: MapImageRepository
  private readonly projects: ProjectSession
  private readonly prepare: (file: Blob, projectId: string) => Promise<Asset>
  constructor(repository: MapImageRepository, projects: ProjectSession, prepare: (file: Blob, projectId: string) => Promise<Asset>, private readonly canEdit: () => boolean = () => true) {
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
    this.update({ projectId, image: {}, phase: projectId ? 'loading' : 'idle' })
    if (!projectId) return
    try {
      const image = await this.repository.load(projectId)
      if (version === this.loadVersion) this.update({ projectId, image, phase: image.background ? 'saved' : 'idle' })
    } catch (error) {
      if (version !== this.loadVersion) return
      this.retryAction = () => this.load(projectId)
      this.update({ ...this.state, phase: 'error', error: `Ошибка чтения карты. ${error instanceof Error ? error.message : ''}` })
    }
  }
  upload = (file: Blob) => this.change(file)
  remove = () => this.change()
  retry = () => this.retryAction?.() ?? Promise.resolve()
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
      this.update({ ...this.state, phase: 'error', error: `${writing ? 'Ошибка записи изображения в хранилище.' : 'Ошибка загрузки изображения.'} ${error instanceof Error ? error.message : ''}` })
    }
  }
}
