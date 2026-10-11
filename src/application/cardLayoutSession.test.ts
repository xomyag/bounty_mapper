import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { CardLayoutSession, clampCardWidth } from './cardLayoutSession'
import { IndexedDbCardWidthRepository } from '../storage/indexedDbCardWidthRepository'

describe('Shared card width', () => {
  it('clamps a preference without changing it, leaving map space or fitting a narrow window', () => {
    expect(clampCardWidth(900, 1000)).toBe(736)
    expect(clampCardWidth(100, 1000)).toBe(320)
    expect(clampCardWidth(900, 390)).toBe(366)
    expect(clampCardWidth(550, 1400)).toBe(550)
  })
  it('persists one shared width in local settings and restores after reload', async () => {
    const factory = new IDBFactory(); const repository = new IndexedDbCardWidthRepository(() => factory)
    const session = new CardLayoutSession(repository); await session.initialize(); session.resize(620); await session.save()
    const restored = new CardLayoutSession(repository); await restored.initialize()
    expect(restored.getSnapshot()).toMatchObject({ width: 620, phase: 'saved' })
  })
  it('keeps newer resizing when initialization is slow; serializes writes and retains failed preferences', async () => {
    let finishLoad!: (width: number) => void; let finishWrite!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve })).mockResolvedValue(undefined)
    const session = new CardLayoutSession({ load: () => new Promise((resolve) => { finishLoad = resolve }), save })
    const loading = session.initialize(); session.resize(500); finishLoad(410); await loading
    expect(session.getSnapshot().width).toBe(500)
    const writing = session.save(); session.resize(600); const latest = session.save(); finishWrite(); await Promise.all([writing, latest])
    expect(save.mock.calls.map(([width]) => width)).toEqual([500, 600])
    save.mockRejectedValueOnce(new Error('Нет места')); session.resize(640); await session.save()
    expect(session.getSnapshot()).toMatchObject({ width: 640, phase: 'error' })
    await session.save(); expect(session.getSnapshot().phase).toBe('saved')
  })
})
