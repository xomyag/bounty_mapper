import type { Project } from '../domain/project'
import { requestResult } from './indexedDb'
export const workspaceKey = (projectId: string) => `mapWorkspace:${projectId}`

// Seed exactly the former updatedAt/getAll order once; later writes never sort
// an established local list by timestamp again.
export async function projectList(tx: IDBTransaction): Promise<Project[]> {
  const projects = await requestResult(tx.objectStore('projects').getAll()) as Project[]
  projects.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
  const saved: unknown = await requestResult(tx.objectStore('settings').get('projectOrder'))
  const ids = Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string'))] : []
  const ordered = ids.flatMap(id => projects.filter(project => project.id === id))
  return [...ordered, ...projects.filter(project => !ids.includes(project.id))]
}
export async function appendProject(tx: IDBTransaction, id: string) {
  const projects = await projectList(tx)
  await requestResult(tx.objectStore('settings').put([...projects.map(project => project.id).filter(value => value !== id), id], 'projectOrder'))
}
