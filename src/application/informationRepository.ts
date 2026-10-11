import type { Asset, Map, Project } from '../domain/project'
import type { RichDocument } from '../domain/richText'

export interface InformationRepository {
  load(projectId: string, mapId?: string): Promise<{ map?: Map; assets: Asset[] }>
  save(project: Project, fields: { name: string; document: RichDocument; mapId?: string }, assets: Asset[]): Promise<Project>
  create(project: Project, assets: Asset[]): Promise<Project>
}
