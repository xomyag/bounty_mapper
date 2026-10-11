export interface ProjectAccess {
  select(projectId?: string): Promise<void>
  canEdit(projectId: string): boolean
  message(): string | undefined
  release(): Promise<void>
}
