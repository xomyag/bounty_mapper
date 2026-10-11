import type { CardWidthRepository } from '../application/cardLayoutSession'
import { DATABASE_NAME, IndexedDb, requestResult } from './indexedDb'
const key = 'ui:cardWidth'
export class IndexedDbCardWidthRepository implements CardWidthRepository {
  private db: IndexedDb
  constructor(factory: () => IDBFactory = () => globalThis.indexedDB, name = DATABASE_NAME) { this.db = new IndexedDb(factory, name) }
  load(): Promise<number | undefined> { return this.db.transaction(['settings'], 'readonly', async (tx) => { const width: unknown = await requestResult(tx.objectStore('settings').get(key)); if (width === undefined) return; if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 900) throw new Error('Некорректная настройка ширины.'); return width }) }
  save(width: number): Promise<void> { return this.db.transaction(['settings'], 'readwrite', async (tx) => { if (!Number.isFinite(width) || width < 1 || width > 900) throw new Error('Некорректная ширина карточки.'); await requestResult(tx.objectStore('settings').put(width, key)) }) }
}
