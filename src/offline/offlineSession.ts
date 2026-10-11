import { message } from '../i18n/message'
export interface OfflineState { phase: 'disabled' | 'loading' | 'ready' | 'error' | 'applying'; updateAvailable: boolean; message?: string }
export class OfflineSession {
  private state: OfflineState = { phase: 'disabled', updateAvailable: false }
  private listeners = new Set<() => void>()
  private registration?: ServiceWorkerRegistration
  private container?: ServiceWorkerContainer
  private initialization?: Promise<void>
  private requested = false
  private hadController = false
  private applyTimeout?: ReturnType<typeof setTimeout>
  private base = '/'
  private disposed = false
  private failures = 0
  private cleanups: (() => void)[] = []
  constructor(private readonly canReload: () => boolean, private readonly reload: () => void = () => location.reload()) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(change: Partial<OfflineState>) { this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()) }
  initialize = (enabled: boolean, container = navigator.serviceWorker, base = import.meta.env.BASE_URL): Promise<void> => {
    if (!enabled) return Promise.resolve()
    this.initialization ??= this.start(container, base)
    return this.initialization
  }
  private async start(container: ServiceWorkerContainer | undefined, base: string) {
    if (!container) { this.update({ phase: 'error', message: message("ui.offline.startup.is.unavailable.service.worker.support.and.https") }); return }
    this.container = container; this.base = base; this.hadController = !!container.controller
    this.update({ phase: 'loading', message: undefined })
    container.addEventListener('controllerchange', this.controllerChanged)
    this.cleanups.push(() => container.removeEventListener('controllerchange', this.controllerChanged))
    try {
      const registration = await container.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      if (this.disposed) return
      this.registration = registration
      const found = () => { if (registration.installing) this.watch(registration.installing) }
      registration.addEventListener('updatefound', found)
      this.cleanups.push(() => registration.removeEventListener('updatefound', found))
      if (registration.installing) this.watch(registration.installing)
      if (registration.waiting) this.update({ updateAvailable: true })
      if (registration.active) await this.probe(registration.active)
    } catch (error) { this.failure(error) }
  }
  private failure(error: unknown) { ++this.failures; this.update({ phase: 'error', message: message("ui.could.not.prepare.offline.startup.or.the.update.value", { p0: error instanceof Error ? error.message : '' }) }) }
  private watch(worker: ServiceWorker) {
    const changed = () => {
      if (worker.state === 'installed' && this.container?.controller) { this.update({ updateAvailable: true }); void this.probe(worker) }
      else if (worker.state === 'redundant') this.failure(new Error(message("ui.the.application.cache.was.not.saved.check.the.network")))
      else if (worker.state === 'activated') void this.probe(worker)
    }
    worker.addEventListener('statechange', changed)
    this.cleanups.push(() => worker.removeEventListener('statechange', changed))
    changed()
  }
  private async probe(worker: ServiceWorker) {
    const channel = new MessageChannel()
    const failures = this.failures
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const ready = await new Promise<boolean>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message("ui.no.response.from.the.offline.cache"))), 5000)
        channel.port1.onmessage = (event: MessageEvent<{ ready: boolean }>) => { clearTimeout(timeout); resolve(event.data.ready === true) }
        worker.postMessage({ type: 'CACHE_STATUS' }, [channel.port2])
      })
      if (!ready) throw new Error(message("ui.the.application.was.not.completely.cached.retry.setup.while"))
      if (!this.disposed && failures === this.failures && this.state.phase !== 'applying') this.update({ phase: 'ready', message: undefined })
    } catch (error) { if (!this.disposed && this.state.phase !== 'applying') this.failure(error) }
    finally { clearTimeout(timeout); channel.port1.close(); channel.port2.close() }
  }
  private controllerChanged = () => {
    clearTimeout(this.applyTimeout)
    if (this.requested && this.canReload()) { this.requested = false; this.reload(); return }
    this.requested = false
    this.update({ phase: 'loading', updateAvailable: this.hadController || this.state.updateAvailable })
    this.hadController = true
    if (this.container?.controller) void this.probe(this.container.controller)
  }
  checkUpdate = async () => {
    if (this.state.phase === 'applying') return
    try {
      if (!this.registration) { this.initialization = undefined; await this.initialize(true, this.container, this.base); return }
      await this.registration.update()
      if (this.registration.waiting) this.update({ updateAvailable: true })
      if (this.registration.active) await this.probe(this.registration.active)
    } catch (error) { this.failure(error) }
  }
  applyUpdate = () => {
    if (!this.canReload() || !this.state.updateAvailable || this.state.phase === 'applying') return
    this.requested = true; this.update({ phase: 'applying', message: undefined })
    if (!this.registration?.waiting) { this.requested = false; this.reload(); return }
    try {
      this.registration.waiting.postMessage({ type: 'APPLY_UPDATE' })
      this.applyTimeout = setTimeout(() => { this.requested = false; this.failure(new Error(message("ui.the.update.has.not.been.activated.yet.you.can"))) }, 10000)
    } catch (error) { this.requested = false; this.failure(error) }
  }
  dispose = () => { this.disposed = true; this.requested = false; clearTimeout(this.applyTimeout); this.cleanups.forEach((cleanup) => cleanup()); this.cleanups = [] }
}
