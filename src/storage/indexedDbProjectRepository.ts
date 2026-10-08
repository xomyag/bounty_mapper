import type { ProjectRepository } from '../application/projectRepository'
import { RevisionConflictError } from '../application/projectRepository'
import { PROJECT_SCHEMA_VERSION } from '../domain/project'
import type { Project } from '../domain/project'

export const DATABASE_NAME = 'bounty-mapper'
export const DATABASE_VERSION = 1

function readProject(value: unknown): Project {
  if (typeof value !== 'object' || value === null) throw new Error('Повреждённая запись проекта.')
  const p = value as Partial<Project>
  if (p.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается.')
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() ||
      typeof p.contextMd !== 'string' || !Number.isInteger(p.revision) || (p.revision ?? 0) < 1 ||
      typeof p.createdAt !== 'string' || typeof p.updatedAt !== 'string') {
    throw new Error('Повреждённая запись проекта.')
  }
  return p as Project
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Запись отменена.'))
    tx.onerror = () => { /* abort is the final outcome, including request errors */ }
  })
}

export class IndexedDbProjectRepository implements ProjectRepository {
  private readonly factory: () => IDBFactory
  private readonly name: string

  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) {
    this.factory = factory
    this.name = name
  }

  private connect(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const factory = this.factory()
      if (!factory) throw new Error('IndexedDB недоступна в этом браузере.')
      const request = factory.open(this.name, DATABASE_VERSION)
      let blocked = false
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('maps', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('settings')
      }
      request.onblocked = () => {
        blocked = true
        reject(new Error('Закройте другие вкладки Bounty Mapper и повторите попытку.'))
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        if (blocked) { db.close(); return }
        db.onversionchange = () => db.close()
        resolve(db)
      }
    })
  }

  private async transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.connect()
    try {
      const tx = db.transaction(stores, mode)
      const done = transactionDone(tx)
      // Attach a rejection handler immediately; work may reject before abort arrives.
      void done.catch(() => {})
      try {
        const result = await work(tx)
        await done
        return result
      } catch (error) {
        try { tx.abort() } catch { /* already completed or aborted */ }
        await done.catch(() => {})
        throw error
      }
    } finally { db.close() }
  }

  list(): Promise<Project[]> {
    return this.transaction(['projects'], 'readonly', async (tx) => {
      const values: unknown[] = await requestResult(tx.objectStore('projects').getAll())
      return values.map(readProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    })
  }

  restore(): Promise<Project | undefined> {
    return this.transaction(['settings', 'projects'], 'readonly', async (tx) => {
      const id: unknown = await requestResult(tx.objectStore('settings').get('activeProjectId'))
      if (typeof id !== 'string') return undefined
      const value: unknown = await requestResult(tx.objectStore('projects').get(id))
      return value === undefined ? undefined : readProject(value)
    })
  }

  open(id: string): Promise<Project> {
    return this.transaction(['settings', 'projects'], 'readwrite', async (tx) => {
      const value: unknown = await requestResult(tx.objectStore('projects').get(id))
      if (value === undefined) throw new Error('Проект не найден.')
      const project = readProject(value)
      await requestResult(tx.objectStore('settings').put(id, 'activeProjectId'))
      return project
    })
  }

  save(project: Project): Promise<Project> {
    return this.transaction(['projects', 'settings'], 'readwrite', async (tx) => {
      if (!project.name.trim()) throw new Error('Укажите название проекта.')
      if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается.')
      const store = tx.objectStore('projects')
      const value: unknown = await requestResult(store.get(project.id))
      const existing = value === undefined ? undefined : readProject(value)
      if ((existing?.revision ?? 0) !== project.revision) throw new RevisionConflictError()
      const saved = { ...project, name: project.name.trim(), revision: project.revision + 1, updatedAt: new Date().toISOString() }
      await requestResult(store.put(saved))
      await requestResult(tx.objectStore('settings').put(saved.id, 'activeProjectId'))
      return saved
    })
  }
}
