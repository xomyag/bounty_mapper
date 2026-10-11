import type { Asset, Project } from '../domain/project'

export interface ProjectRepository {
  list(): Promise<Project[]>
  restore(): Promise<Project | undefined>
  open(id: string): Promise<Project>
  // revision 0 means a new project. Resolves only after the transaction commits.
  save(project: Project, assets?: Asset[]): Promise<Project>
  remove(project: Project): Promise<void>
}

export class RevisionConflictError extends Error {
  constructor() {
    super('Проект изменён в другой вкладке. Скопируйте свой текст перед повторным открытием проекта.')
    this.name = 'RevisionConflictError'
  }
}
