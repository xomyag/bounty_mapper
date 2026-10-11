import type { ProjectAccess } from '../../application/projectAccess'

/** A project lock lives with its tab; the browser also releases it on a crash. */
export class BrowserProjectAccess implements ProjectAccess {
  private projectId?: string
  private owned = false
  private reason?: string
  private generation = 0
  private unlock?: () => void
  private completion?: Promise<void>
  constructor(private readonly manager: () => LockManager | undefined = () => globalThis.navigator?.locks) {}
  canEdit = (projectId: string) => this.projectId === projectId && this.owned
  message = () => this.reason
  release = async () => {
    ++this.generation
    this.owned = false; this.projectId = undefined; this.reason = undefined
    this.unlock?.(); this.unlock = undefined
    const completion = this.completion; this.completion = undefined
    await completion?.catch(() => {})
  }
  select = async (projectId?: string) => {
    if (projectId && this.canEdit(projectId)) return
    const released = this.release()
    const generation = this.generation
    await released
    if (generation !== this.generation) return
    if (!projectId) return
    this.projectId = projectId
    let manager: LockManager | undefined
    try { manager = this.manager() } catch (error) { this.reason = `Не удалось получить право редактирования. ${error instanceof Error ? error.message : ''}`; return }
    if (!manager) {
      // Older/insecure browsers retain the existing transactional revision check.
      this.owned = true; this.reason = 'Web Locks недоступен: конфликты вкладок защищены проверкой версии проекта.'
      return
    }
    let resolve!: () => void
    const acquired = new Promise<void>((done) => { resolve = done })
    let release!: () => void
    const held = new Promise<void>((done) => { release = done })
    this.completion = Promise.resolve().then(() => manager.request(`bounty-mapper:editor:${projectId}`, { ifAvailable: true }, async (lock) => {
      if (generation !== this.generation || !lock) { resolve(); return }
      this.owned = true; this.unlock = release; resolve()
      await held
    })).catch((error: unknown) => {
      if (generation === this.generation) { this.owned = false; this.reason = `Не удалось получить право редактирования. ${error instanceof Error ? error.message : ''}` }
      resolve()
    })
    await acquired
    if (generation === this.generation && !this.owned && !this.reason) this.reason = 'Проект редактируется в другой вкладке. Здесь доступен просмотр. Закройте её или освободите редактирование, затем получите право здесь.'
  }
}
