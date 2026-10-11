import type { NavigationRepository } from './navigationRepository'
import type { ProjectSession } from './projectSession'
import { emptyNavigationData } from '../domain/navigation'
import type { NavigationData } from '../domain/navigation'

export class NavigationSession {
  private state: { projectId?: string; data: NavigationData; loading: boolean; error?: string } = { data: emptyNavigationData(), loading: false }
  private generation = 0
  private listeners = new Set<() => void>()
  constructor(private readonly repository: NavigationRepository, private readonly projects: ProjectSession, private readonly canEdit: () => boolean = () => true) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(fields: Partial<typeof this.state>) { this.state = { ...this.state, ...fields }; this.listeners.forEach((listener) => listener()) }
  load = async (projectId = this.projects.getSnapshot().project?.id) => {
    const generation = ++this.generation
    this.update({ projectId, data: projectId === this.state.projectId ? this.state.data : emptyNavigationData(), loading: !!projectId, error: undefined })
    if (!projectId) return
    try { const data = await this.repository.load(projectId); if (generation === this.generation) this.update({ data, loading: false }) }
    catch (error) { if (generation === this.generation) this.update({ loading: false, error: error instanceof Error ? error.message : 'Не удалось прочитать объекты проекта.' }) }
  }
  createMap = async (name: string): Promise<string | undefined> => {
    if (!this.canEdit()) return undefined
    let mapId: string | undefined
    try {
      await this.projects.mutateProject(async (project) => { const result = await this.repository.createMap(project, name); mapId = result.map.id; return result.project })
      await this.load(); return mapId
    } catch (error) { this.update({ error: error instanceof Error ? error.message : 'Не удалось создать карту.' }); return undefined }
  }
  renameMap = async (mapId: string, name: string): Promise<boolean> => {
    if (!this.canEdit()) return false
    try { await this.projects.mutateProject((project) => this.repository.renameMap(project, mapId, name)); await this.load(); return true }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'Не удалось переименовать карту.' }); return false }
  }
  deleteMap = async (mapId: string): Promise<boolean> => {
    if (!this.canEdit()) return false
    try { await this.projects.mutateProject((project) => this.repository.deleteMap(project, mapId)); await this.load(); return true }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'Не удалось удалить карту.' }); return false }
  }
}
