import type { Project } from '../domain/project'
import { createProject } from '../domain/project'
import type { ProjectRepository } from './projectRepository'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
export interface SessionState {
  project?: Project
  status: SaveStatus
  loading: boolean
  error?: string
}

export class ProjectSession {
  private state: SessionState = { status: 'idle', loading: true }
  private listeners = new Set<() => void>()
  private editVersion = 0
  private pending?: Promise<void>
  private initialization?: Promise<void>
  private readonly repository: ProjectRepository

  constructor(repository: ProjectRepository) { this.repository = repository }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private update(state: SessionState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
  initialize = (): Promise<void> => {
    this.initialization ??= this.restore()
    return this.initialization
  }
  private async restore() {
    this.update({ ...this.state, loading: true, error: undefined })
    try {
      const project = await this.repository.restore()
      this.update({ project, status: project ? 'saved' : 'idle', loading: false })
    } catch (error) { this.fail(error) }
  }
  private fail(error: unknown) {
    this.update({ ...this.state, status: 'error', loading: false, error: error instanceof Error ? error.message : 'Хранилище недоступно.' })
  }
  hasUnsavedChanges = () => !!this.state.project && this.state.status !== 'saved'

  create = async (name: string) => {
    if (this.state.loading || this.hasUnsavedChanges() || this.pending) throw new Error('Сначала сохраните текущий проект.')
    const project = createProject(name)
    this.editVersion++
    this.update({ project, status: 'dirty', loading: false })
    await this.save()
  }
  open = async (id: string, discardDraft = false) => {
    if (this.state.loading || (this.hasUnsavedChanges() && !discardDraft) || this.pending) throw new Error('Сначала сохраните текущий проект.')
    this.update({ ...this.state, loading: true, error: undefined })
    try {
      const project = await this.repository.open(id)
      this.editVersion++
      this.update({ project, status: 'saved', loading: false })
    } catch (error) {
      // An opening error is separate from the save status of the current project.
      this.update({ ...this.state, loading: false, error: error instanceof Error ? error.message : 'Не удалось открыть проект.' })
    }
  }
  retry = () => this.state.loading ? Promise.resolve() : this.state.project ? this.save() : this.restore()
  edit = (fields: Pick<Project, 'name' | 'contextMd'>) => {
    if (!this.state.project || this.state.loading) return
    this.editVersion++
    this.update({ ...this.state, project: { ...this.state.project, ...fields }, status: this.pending ? 'saving' : 'dirty', error: undefined })
  }
  save = (): Promise<void> => {
    if (this.state.loading) return Promise.resolve()
    if (this.pending) return this.pending
    const project = this.state.project
    if (!project || this.state.status === 'saved') return Promise.resolve()
    const version = this.editVersion
    this.update({ ...this.state, status: 'saving', error: undefined })
    this.pending = this.repository.save({ ...project }).then((saved) => {
      const changed = version !== this.editVersion
      this.update({ ...this.state, project: changed ? { ...this.state.project!, revision: saved.revision, updatedAt: saved.updatedAt } : saved, status: changed ? 'dirty' : 'saved', error: undefined })
    }).catch((error: unknown) => this.fail(error)).finally(() => { this.pending = undefined })
    return this.pending
  }
}
