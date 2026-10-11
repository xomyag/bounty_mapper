import type { ModeRepository } from '../application/modeRepository'
import type { WorkspaceMode } from '../domain/workspaceMode'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
import { readProject } from './indexedDbProjectRepository'

export class IndexedDbModeRepository implements ModeRepository {
  private readonly db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) { this.db = new IndexedDb(factory, name) }
  load(projectId: string): Promise<WorkspaceMode> {
    return this.db.transaction(['settings'], 'readonly', async (tx) => {
      const mode: unknown = await requestResult(tx.objectStore('settings').get(`workspaceMode:${projectId}`))
      if (mode === undefined) return 'prepare'
      if (mode !== 'prepare' && mode !== 'play') throw new Error('Некорректная настройка режима проекта.')
      return mode
    })
  }
  save(projectId: string, mode: WorkspaceMode): Promise<void> {
    if (mode !== 'prepare' && mode !== 'play') return Promise.reject(new Error('Неизвестный режим.'))
    return this.db.transaction(['projects', 'settings'], 'readwrite', async (tx) => {
      readProject(await requestResult(tx.objectStore('projects').get(projectId)))
      await requestResult(tx.objectStore('settings').put(mode, `workspaceMode:${projectId}`))
    })
  }
}
