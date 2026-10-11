import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type WorkerEvent = { request?: { url: string; method: string; mode: string }; data?: { type: string }; ports?: { postMessage: (data: unknown) => void }[]; waitUntil: (work: Promise<unknown>) => void; respondWith: (work: Promise<unknown>) => void }
function harness({ fail = false, clients = 1, base = '/' } = {}) {
  const old = new Map<string, string>([['https://local.test/assets/old.js', 'old chunk']])
  const stores = new Map<string, Map<string, string>>([['bounty-mapper-shell-old', old]])
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const skipWaiting = vi.fn(async () => {}); const fetch = vi.fn(async () => 'network'); const claim = vi.fn(async () => {})
  const cache = (name: string) => { let entries = stores.get(name); if (!entries) { entries = new Map(); stores.set(name, entries) }; return { match: async (key: string) => entries!.get(key), addAll: async (requests: Request[]) => { for (const request of requests) { entries!.set(request.url, request.url.endsWith('index.html') ? 'shell' : 'chunk'); if (fail) throw new Error('QuotaExceededError') } } } }
  const caches = { open: async (name: string) => cache(name), delete: async (name: string) => stores.delete(name), has: async (name: string) => stores.has(name), keys: async () => [...stores.keys()], match: async (key: string) => { for (const entries of stores.values()) { if (entries.has(key)) return entries.get(key) } } }
  const self = { registration: { scope: `https://local.test${base}` }, location: { origin: 'https://local.test' }, clients: { matchAll: async () => Array(clients), claim }, skipWaiting, addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener) }
  const source = readFileSync('src/offline/worker.js', 'utf8').replace("'__BM_PRECACHE__'", JSON.stringify(JSON.stringify({ version: 'new', urls: ['index.html', 'assets/main.js', 'assets/editor.js'].map((path) => `${base}${path}`) })))
  runInNewContext(source, { self, caches, fetch, URL, Request })
  const dispatch = (name: string, data: Partial<WorkerEvent> = {}) => { let promise: Promise<unknown> | undefined; listeners.get(name)!({ ...data, waitUntil: (p) => { promise = p }, respondWith: (p) => { promise = p } }); return promise }
  return { dispatch, stores, skipWaiting, fetch, claim }
}
describe('Production service worker', () => {
  it('serves a repository subpath and keeps another Pages site cache during activation', async () => {
    const env = harness({ base: '/bounty_mapper/' }); await env.dispatch('install'); await env.dispatch('activate')
    expect(env.stores.has('bounty-mapper-shell-old')).toBe(true)
    expect(await env.dispatch('fetch', { request: { url: 'https://local.test/bounty_mapper/', method: 'GET', mode: 'navigate' } })).toBe('shell')
    expect(await env.dispatch('fetch', { request: { url: 'https://local.test/bounty_mapper/assets/editor.js', method: 'GET', mode: 'cors' } })).toBe('chunk')
    expect(env.fetch).not.toHaveBeenCalled()
  })
  it('preloads even unopened editor chunks and serves the shell offline without auto-activating an update', async () => {
    const env = harness(); await env.dispatch('install')
    expect(env.stores.get('bounty-mapper-shell-new')?.size).toBe(3); expect(env.skipWaiting).not.toHaveBeenCalled()
    await env.dispatch('activate'); expect(env.claim).toHaveBeenCalledOnce(); expect(env.stores.has('bounty-mapper-shell-old')).toBe(false)
    expect(await env.dispatch('fetch', { request: { url: 'https://local.test/', method: 'GET', mode: 'navigate' } })).toBe('shell')
    expect(await env.dispatch('fetch', { request: { url: 'https://local.test/assets/editor.js', method: 'GET', mode: 'cors' } })).toBe('chunk'); expect(env.fetch).not.toHaveBeenCalled()
  })
  it('drops an incomplete new cache and retains the previously working shell after install failure', async () => {
    const env = harness({ fail: true }); await expect(env.dispatch('install')).rejects.toThrow('QuotaExceededError')
    expect(env.stores.has('bounty-mapper-shell-new')).toBe(false); expect(env.stores.has('bounty-mapper-shell-old')).toBe(true)
  })
  it('keeps old lazy resources for other editing tabs and activates only after an explicit message', async () => {
    const env = harness({ clients: 2 }); await env.dispatch('install'); await env.dispatch('activate')
    expect(await env.dispatch('fetch', { request: { url: 'https://local.test/assets/old.js', method: 'GET', mode: 'cors' } })).toBe('old chunk')
    expect(env.dispatch('fetch', { request: { url: 'https://outside.test/assets/main.js', method: 'GET', mode: 'cors' } })).toBeUndefined()
    await env.dispatch('message', { data: { type: 'APPLY_UPDATE' } }); expect(env.skipWaiting).toHaveBeenCalledOnce()
    const reply = vi.fn(); await env.dispatch('message', { data: { type: 'CACHE_STATUS' }, ports: [{ postMessage: reply }] }); expect(reply).toHaveBeenCalledWith({ ready: true, version: 'new' })
  })
})
