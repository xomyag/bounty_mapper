import type { ProjectSnapshot } from './projectBackupRepository'
import { independentCopy } from './projectBackupRepository'
import type { Project } from '../domain/project'
import { documentAssetIds, emptyDocument } from '../domain/richText'
import { message } from '../i18n/message'
import { parseArchive } from '../storage/backup/archive'
import type { ProjectSession } from './projectSession'
import { availableCopyNames } from '../domain/copy'

export interface LevelImportRepository {
  snapshot(projectId: string): Promise<ProjectSnapshot>
  insertLevels(project: Project, copy: ProjectSnapshot): Promise<{ project: Project; snapshot: ProjectSnapshot }>
}

export function levelSubset(source: ProjectSnapshot, mapIds: string | readonly string[]): ProjectSnapshot {
  const selected = new Set(typeof mapIds === 'string' ? [mapIds] : mapIds)
  const maps = source.maps.filter((m) => selected.has(m.id)).sort((a,b) => a.order-b.order)
  if (!maps.length || maps.length !== selected.size) throw new Error(message('level.notFound'))
  const regions = source.regions.filter((r) => selected.has(r.mapId))
  const markerPlacements = source.markerPlacements.filter((m) => selected.has(m.mapId))
  const entityIds = new Set(markerPlacements.map((marker) => marker.entityId))
  const entities = source.entities.filter((e) => entityIds.has(e.id))
  const imagePlacements = source.imagePlacements.filter((p) => selected.has(p.mapId))
  const used = new Set([...maps.flatMap((map) => documentAssetIds(map.description)), ...imagePlacements.map((p) => p.assetId), ...regions.flatMap((r) => [...documentAssetIds(r.gmNotes), ...documentAssetIds(r.playerDescription)]), ...entities.flatMap((e) => documentAssetIds(e.description))])
  return { project: { ...source.project, context: emptyDocument() }, maps, regions, markerPlacements, entities, imagePlacements, assets: source.assets.filter((a) => used.has(a.id)) }
}

export function excludedLevelLinks(source: ProjectSnapshot, mapIds: string | readonly string[]): number {
  const selected = new Set(typeof mapIds === 'string' ? [mapIds] : mapIds)
  const ids = new Set(source.markerPlacements.filter((m) => selected.has(m.mapId)).map((m) => m.entityId))
  return source.markerPlacements.filter((m) => !selected.has(m.mapId) && ids.has(m.entityId)).length
}

interface State { phase: 'idle' | 'validating' | 'choosing' | 'saving' | 'error'; source?: ProjectSnapshot; selectedIds: string[]; targetNames?: string[]; targetRevision?: number; projectId?: string; error?: string; importedCount?: number }
export class LevelImportSession {
  private state: State = { phase: 'idle', selectedIds: [] }
  private listeners = new Set<() => void>()
  constructor(private projects: ProjectSession, private repository: LevelImportRepository, private canEdit: () => boolean, private decode = parseArchive) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(state: State) { this.state = state; this.listeners.forEach((listener) => listener()) }
  busy = () => this.state.phase === 'validating' || this.state.phase === 'saving'
  active = () => this.state.phase !== 'idle'
  cancel = () => { if (!this.busy()) this.update({ phase: 'idle', selectedIds: [] }) }
  select = (selectedIds: string[]) => {
    if (!this.busy() && this.state.source) this.update({ ...this.state, selectedIds: this.state.source.maps.filter((map) => selectedIds.includes(map.id)).sort((a,b) => a.order-b.order).map((map) => map.id), error: undefined })
  }
  choices = () => {
    const maps = [...this.state.source?.maps ?? []].sort((a,b) => a.order-b.order)
    const selected = maps.filter((map) => this.state.selectedIds.includes(map.id))
    const names = availableCopyNames(selected.map((map) => map.name), this.state.targetNames ?? [])
    const finalNames = new Map(selected.map((map, index) => [map.id, names[index]]))
    return maps.map((map) => ({ id: map.id, name: map.name, finalName: finalNames.get(map.id) }))
  }
  read = async (file: Blob) => {
    const projectId = this.projects.getSnapshot().project?.id
    if (this.busy() || !projectId || !this.canEdit()) return
    this.update({ phase: 'validating', projectId, selectedIds: [] })
    try {
      const [source, target] = await Promise.all([this.decode(file), this.repository.snapshot(projectId)])
      if (!source.maps.length) throw new Error(message('level.noMaps'))
      if (this.projects.getSnapshot().project?.id !== projectId || !this.canEdit()) throw new Error(message('level.projectChanged'))
      this.update({ phase: 'choosing', projectId, source, selectedIds: [...source.maps].sort((a,b) => a.order-b.order).map((map) => map.id), targetNames: target.maps.map((map) => map.name), targetRevision: target.project.revision })
    } catch (error) { this.update({ phase: 'error', projectId, selectedIds: [], error: error instanceof Error ? error.message : message('errors.importRead') }) }
  }
  confirm = async (prepare: (copy: ProjectSnapshot) => Promise<void>, open: (copy: ProjectSnapshot) => void) => {
    if (this.busy() || !this.state.source || !this.state.selectedIds.length || !this.state.projectId || !this.canEdit()) return
    const { source, selectedIds, projectId, targetRevision } = this.state
    this.update({ ...this.state, phase: 'saving', error: undefined })
    try {
      if (this.projects.getSnapshot().project?.id !== projectId) throw new Error(message('level.projectChanged'))
      const copy = independentCopy(levelSubset(source, selectedIds), projectId)
      await prepare(copy)
      let inserted!: ProjectSnapshot
      await this.projects.mutateProject(async (project) => {
        if (project.id !== projectId || project.revision !== targetRevision || !this.canEdit()) throw new Error(message('level.projectChanged'))
        const result = await this.repository.insertLevels(project, copy); inserted = result.snapshot; return result.project
      })
      open(inserted)
      this.update({ phase: 'idle', selectedIds: [], projectId, importedCount: inserted.maps.length })
    } catch (error) { this.update({ ...this.state, phase: 'error', error: error instanceof Error ? error.message : message('errors.importRead') }) }
  }
}
