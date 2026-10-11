import { localize } from '../i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineSession } from './offlineSession'

class Port { other?: Port; onmessage?: (event: { data: unknown }) => void; postMessage(data: unknown) { this.other?.onmessage?.({ data }) }; close() {} }
class Channel { port1 = new Port(); port2 = new Port(); constructor() { this.port1.other = this.port2; this.port2.other = this.port1 } }
function browser(complete = true) {
  const worker = Object.assign(new EventTarget(), { state: 'activated', postMessage: vi.fn((message: { type: string }, ports?: Port[]) => { if (message.type === 'CACHE_STATUS') ports?.[0]?.postMessage({ ready: complete }) }) })
  const registration = Object.assign(new EventTarget(), { active: worker, waiting: undefined as unknown, installing: undefined, update: vi.fn(async () => {}) })
  const container = Object.assign(new EventTarget(), { controller: worker, register: vi.fn(async () => registration) })
  return { worker, registration, container, api: container as unknown as ServiceWorkerContainer }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('Offline cache and explicit updates', () => {
  it('reports ready only after confirming all cached resources; incomplete cache remains retryable', async () => {
    vi.stubGlobal('MessageChannel', Channel)
    const failed = browser(false); const session = new OfflineSession(() => true)
    await session.initialize(true, failed.api, '/')
    expect(session.getSnapshot().phase).toBe('error'); expect(localize(session.getSnapshot().message)).toContain('не полностью')
    failed.worker.postMessage.mockImplementation((_message, ports) => ports?.[0]?.postMessage({ ready: true }))
    await session.checkUpdate(); expect(session.getSnapshot().phase).toBe('ready'); session.dispose()
  })
  it('never reloads for a background update and blocks applying while drafts exist', async () => {
    vi.stubGlobal('MessageChannel', Channel)
    const env = browser(); const reload = vi.fn(); let clean = false; const session = new OfflineSession(() => clean, reload)
    await session.initialize(true, env.api, '/')
    env.registration.waiting = env.worker; await session.checkUpdate()
    expect(session.getSnapshot().updateAvailable).toBe(true); expect(reload).not.toHaveBeenCalled()
    session.applyUpdate(); expect(session.getSnapshot().phase).toBe('ready')
    clean = true; session.applyUpdate(); expect(session.getSnapshot().phase).toBe('applying')
    env.container.dispatchEvent(new Event('controllerchange')); expect(reload).toHaveBeenCalledTimes(1); session.dispose()
  })
  it('rechecks dirty state on activation, handles another tab and ignores late activation after timeout', async () => {
    vi.useFakeTimers(); vi.stubGlobal('MessageChannel', Channel)
    const env = browser(); const reload = vi.fn(); let clean = true; const session = new OfflineSession(() => clean, reload)
    await session.initialize(true, env.api, '/'); env.registration.waiting = env.worker; await session.checkUpdate()
    session.applyUpdate(); clean = false; env.container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled(); expect(session.getSnapshot().updateAvailable).toBe(true)
    clean = true; session.applyUpdate(); await vi.advanceTimersByTimeAsync(10001)
    expect(session.getSnapshot().phase).toBe('error'); env.container.dispatchEvent(new Event('controllerchange')); expect(reload).not.toHaveBeenCalled(); session.dispose()
  })
  it('reports rejected update messages without becoming stuck in applying', async () => {
    vi.stubGlobal('MessageChannel', Channel)
    const env = browser(); const session = new OfflineSession(() => true, vi.fn()); await session.initialize(true, env.api, '/')
    env.registration.waiting = { postMessage: () => { throw new Error('Вкладка недоступна') } }; await session.checkUpdate(); session.applyUpdate()
    expect(session.getSnapshot().phase).toBe('error'); expect(localize(session.getSnapshot().message)).toContain('Вкладка недоступна'); session.dispose()
  })
})
