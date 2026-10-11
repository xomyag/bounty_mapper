import { message } from '../i18n/message'
import { migrateProjectContext, migrateMapDescription } from './migrateProjectContext'
import { migrateRegionText } from './migrateRegionText'
import { migrateMarkerPlacement } from './migrateMarkerPlacements'
import { validateRegion } from '../domain/region'
import { validateEntity } from '../domain/marker'
import { storageError } from './storageError'
export const DATABASE_NAME = 'bounty-mapper'
export const DATABASE_VERSION = 9

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error(message("ui.write.cancelled")))
    tx.onerror = () => { /* onabort reports the final outcome */ }
  })
}

export class IndexedDb {
  private readonly factory: () => IDBFactory
  private readonly name: string
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) {
    this.factory = factory
    this.name = name
  }

  private connect(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const factory = this.factory()
      if (!factory) throw new Error(message("ui.indexeddb.is.unavailable.in.this.browser"))
      const request = factory.open(this.name, DATABASE_VERSION)
      let blocked = false
      let migrationError: Error | undefined
      request.onupgradeneeded = (event) => {
        const db = request.result
        if (event.oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' })
          db.createObjectStore('maps', { keyPath: 'id' }).createIndex('projectId', 'projectId')
          db.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
          db.createObjectStore('settings')
        }
        if (event.oldVersion < 2) {
          db.createObjectStore('imagePlacements', { keyPath: 'id' }).createIndex('mapId', 'mapId', { unique: true })
        }
        if (event.oldVersion < 3) {
          db.createObjectStore('regions', { keyPath: 'id' }).createIndex('mapId', 'mapId')
        }
        if (event.oldVersion < 6) {
          db.createObjectStore('entities', { keyPath: 'id' }).createIndex('projectId', 'projectId')
          const markers = db.createObjectStore('markerPlacements', { keyPath: 'id' })
          markers.createIndex('mapId', 'mapId')
          markers.createIndex('entityId', 'entityId')
        }
        if (event.oldVersion < 7) {
          const cursor = request.transaction!.objectStore('markerPlacements').openCursor()
          cursor.onsuccess = () => {
            const row = cursor.result
            if (!row) return
            try { row.update(migrateMarkerPlacement(row.value)); row.continue() }
            catch (error) { migrationError = new Error(message("ui.could.not.migrate.marker.bindings.original.data.is.unchanged", { p0: error instanceof Error ? error.message : '' })); request.transaction!.abort() }
          }
        }
        if (event.oldVersion < 9) {
          for (const name of ['projects', 'maps'] as const) {
            const cursor = request.transaction!.objectStore(name).openCursor()
            cursor.onsuccess = () => { const row = cursor.result; if (!row) return; try { row.update(name === 'projects' ? migrateProjectContext(row.value) : migrateMapDescription(row.value)); row.continue() } catch (error) { migrationError = new Error(message("ui.could.not.migrate.adventure.and.map.context.original.data", { p0: error instanceof Error ? error.message : '' })); request.transaction!.abort() } }
          }
        }
        if (event.oldVersion < 8) {
          const cursor = request.transaction!.objectStore('regions').openCursor()
          cursor.onsuccess = () => {
            const row = cursor.result
            if (!row) return
            try { const migrated = event.oldVersion < 5 ? migrateRegionText(row.value) : { shortDescription: '', ...row.value }; validateRegion(migrated); row.update(migrated); row.continue() }
            catch (error) { migrationError = new Error(message("ui.could.not.migrate.region.cards.original.data.is.unchanged", { p0: error instanceof Error ? error.message : '' })); request.transaction!.abort() }
          }
          const entities = request.transaction!.objectStore('entities').openCursor()
          entities.onsuccess = () => {
            const row = entities.result
            if (!row) return
            try { const migrated = { checks: [], ...row.value }; validateEntity(migrated); row.update(migrated); row.continue() }
            catch (error) { migrationError = new Error(message("ui.could.not.migrate.marker.entities.original.data.is.unchanged", { p0: error instanceof Error ? error.message : '' })); request.transaction!.abort() }
          }
        }
      }
      request.onblocked = () => {
        blocked = true
        reject(new Error(message("ui.close.other.bounty.mapper.tabs.and.try.again")))
      }
      request.onerror = () => reject(migrationError ?? request.error)
      request.onsuccess = () => {
        const db = request.result
        if (blocked) { db.close(); return }
        db.onversionchange = () => db.close()
        resolve(db)
      }
    })
  }

  async transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.connect().catch((error: unknown) => { throw storageError(error) })
    try {
      const tx = db.transaction(stores, mode)
      const done = transactionDone(tx)
      void done.catch(() => {})
      try {
        const result = await work(tx)
        await done
        return result
      } catch (error) {
        try { tx.abort() } catch { /* already completed or aborted */ }
        await done.catch(() => {})
        throw storageError(error)
      }
    } finally { db.close() }
  }
}
