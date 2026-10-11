import type { Project } from '../domain/project'
import { createProject } from '../domain/project'
import type { ProjectRepository } from './projectRepository'
import type { ProjectAccess } from './projectAccess'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
export interface SessionState {
  project?: Project
  status: SaveStatus
  loading: boolean
  error?: string
  readOnly?: boolean
  accessMessage?: string
}

export class ProjectSession {
  private state: SessionState = { status: 'idle', loading: true }
  private listeners = new Set<() => void>()
  private editVersion = 0
  private pending?: Promise<void>
  private initialization?: Promise<void>
  private openVersion = 0
  private disposed = false
  private readonly repository: ProjectRepository

  constructor(repository: ProjectRepository, private readonly access?: ProjectAccess) { this.repository = repository }
  canEdit = () => !!this.state.project && (!this.access || this.access.canEdit(this.state.project.id))
  getSnapshot = () => this.state
  getOpenVersion = () => this.openVersion
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private update(state: SessionState) {
    this.state = { ...state, readOnly: !!state.project && !this.canEditProject(state.project.id), accessMessage: this.access?.message() }
    this.listeners.forEach((listener) => listener())
  }
  private canEditProject(id: string) { return !this.access || this.access.canEdit(id) }
  initialize = (): Promise<void> => {
    this.initialization ??= this.restore()
    return this.initialization
  }
  private async restore() {
    this.update({ ...this.state, loading: true, error: undefined })
    try {
      const project = await this.repository.restore()
      if (this.disposed) return
      await this.access?.select(project?.id)
      if (this.disposed) { await this.access?.release(); return }
      this.openVersion++
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
    this.update({ ...this.state, loading: true })
    try {
      await this.access?.select(project.id)
      if (!this.canEditProject(project.id)) throw new Error(this.access?.message() ?? 'Не удалось получить право редактирования нового проекта.')
    } catch (error) {
      this.update({ ...this.state, loading: false, error: error instanceof Error ? error.message : 'Не удалось получить право редактирования.' })
      throw error
    }
    this.openVersion++
    this.editVersion++
    this.update({ project, status: 'dirty', loading: false })
    await this.save()
  }
  open = async (id: string, discardDraft = false) => {
    if (this.state.loading || (this.hasUnsavedChanges() && !discardDraft) || this.pending) throw new Error('Сначала сохраните текущий проект.')
    this.update({ ...this.state, loading: true, error: undefined })
    try {
      const project = await this.repository.open(id)
      await this.access?.select(project.id)
      this.openVersion++
      this.editVersion++
      this.update({ project, status: 'saved', loading: false })
    } catch (error) {
      // An opening error is separate from the save status of the current project.
      this.update({ ...this.state, loading: false, error: error instanceof Error ? error.message : 'Не удалось открыть проект.' })
    }
  }
  retry = () => this.state.loading ? Promise.resolve() : this.state.project ? this.save() : this.restore()
  flush = async () => {
    if (this.state.loading) throw new Error('Дождитесь завершения текущей операции.')
    await this.save()
    if (this.state.status === 'dirty') await this.save()
    if (this.hasUnsavedChanges()) throw new Error('Экспорт остановлен: сначала сохраните изменения проекта.')
  }
  adoptProject = async (work: () => Promise<Project>) => {
    if (this.state.loading || this.pending || this.hasUnsavedChanges()) throw new Error('Сначала сохраните изменения текущего проекта.')
    this.update({ ...this.state, loading: true })
    try {
      const project = await work()
      await this.access?.select(project.id)
      this.openVersion++
      this.editVersion++
      this.update({ project, status: 'saved', loading: false })
    } finally {
      if (this.state.loading) this.update({ ...this.state, loading: false })
    }
  }
  // Image and region writes share the revision; lock editing and switching until completion.
  mutateProject = async (work: (project: Project) => Promise<Project>) => {
    if (!this.canEdit()) throw new Error('Проект открыт только для чтения. Получите право редактирования.')
    if (!this.state.project || this.state.loading || this.pending || this.hasUnsavedChanges()) {
      throw new Error('Сначала сохраните изменения проекта.')
    }
    this.update({ ...this.state, loading: true })
    try {
      const project = await work(this.state.project!)
      this.update({ project, status: 'saved', loading: false })
    } finally {
      if (this.state.loading) this.update({ ...this.state, loading: false })
    }
  }
  edit = (fields: Pick<Project, 'name' | 'contextMd'>) => {
    if (!this.state.project || this.state.loading || !this.canEdit()) return
    this.editVersion++
    this.update({ ...this.state, project: { ...this.state.project, ...fields }, status: this.pending ? 'saving' : 'dirty', error: undefined })
  }
  save = (): Promise<void> => {
    if (this.state.loading) return Promise.resolve()
    if (this.pending) return this.pending
    const project = this.state.project
    if (!project || this.state.status === 'saved') return Promise.resolve()
    if (!this.canEdit()) { this.fail(new Error('Проект открыт только для чтения. Получите право редактирования. Черновик сохранён в памяти.')); return Promise.resolve() }
    const version = this.editVersion
    this.update({ ...this.state, status: 'saving', error: undefined })
    this.pending = this.repository.save({ ...project }).then((saved) => {
      const changed = version !== this.editVersion
      this.update({ ...this.state, project: changed ? { ...this.state.project!, revision: saved.revision, updatedAt: saved.updatedAt } : saved, status: changed ? 'dirty' : 'saved', error: undefined })
    }).catch((error: unknown) => this.fail(error)).finally(() => { this.pending = undefined })
    return this.pending
  }
  inspectProject = async (work: (project: Project) => Promise<void>) => {
    if (!this.state.project || this.state.loading || this.pending || this.hasUnsavedChanges()) throw new Error('Сначала сохраните изменения текущего проекта.')
    this.update({ ...this.state, loading: true })
    try { await work(this.state.project) } finally { this.update({ ...this.state, loading: false }) }
  }
  requestEditing = async (refresh: () => Promise<void> = async () => {}) => {
    const id = this.state.project?.id
    if (!id || this.state.loading || this.pending || this.hasUnsavedChanges()) return
    this.update({ ...this.state, loading: true, error: undefined })
    try {
      await this.access?.select(id)
      const project = await this.repository.open(id)
      await refresh()
      this.update({ project, status: 'saved', loading: false })
    } catch (error) {
      await this.access?.release()
      this.update({ ...this.state, loading: false, error: error instanceof Error ? error.message : 'Не удалось перечитать проект. Право редактирования не получено.' })
    }
  }
  releaseEditing = async () => {
    if (this.state.loading || this.pending || this.hasUnsavedChanges()) return
    await this.access?.release(); this.update({ ...this.state })
  }
  dispose = () => { this.disposed = true; void this.access?.release() }
}
