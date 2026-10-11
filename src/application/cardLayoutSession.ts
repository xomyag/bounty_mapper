export interface CardWidthRepository { load(): Promise<number | undefined>; save(width: number): Promise<void> }
export function cardWidthBounds(viewWidth: number) {
  const available = Math.max(1, viewWidth - 24)
  return viewWidth <= 720 ? { min: available, max: available } : { min: 320, max: Math.max(320, Math.min(900, available - 240)) }
}
export function clampCardWidth(preferred: number, viewWidth: number) { const { min, max } = cardWidthBounds(viewWidth); return Math.min(max, Math.max(min, preferred)) }
export class CardLayoutSession {
  private state: { width: number; phase: 'idle' | 'saving' | 'saved' | 'error'; error?: string } = { width: 410, phase: 'idle' }
  private listeners = new Set<() => void>()
  private version = 0
  private initialization?: Promise<void>
  private writing?: Promise<void>
  constructor(private readonly repository: CardWidthRepository) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(change: Partial<typeof this.state>) { this.state = { ...this.state, ...change }; this.listeners.forEach((listener) => listener()) }
  initialize = () => this.initialization ??= this.repository.load().then((width) => { if (!this.version && width !== undefined) this.update({ width, phase: 'saved' }) }).catch((error: unknown) => this.update({ phase: 'error', error: `Не удалось прочитать ширину карточки. ${error instanceof Error ? error.message : ''}` }))
  resize = (width: number) => { if (!Number.isFinite(width)) return; ++this.version; this.update({ width: Math.round(Math.min(900, Math.max(1, width))), phase: 'idle', error: undefined }) }
  save = () => this.writing ??= this.write().finally(() => { this.writing = undefined })
  private async write() {
    while (true) {
      const version = this.version; const width = this.state.width
      this.update({ phase: 'saving', error: undefined })
      try { await this.repository.save(width) }
      catch (error) { this.update({ phase: 'error', error: `Не удалось сохранить ширину карточки. ${error instanceof Error ? error.message : ''}` }); return }
      if (version === this.version) { this.update({ phase: 'saved' }); return }
    }
  }
}
