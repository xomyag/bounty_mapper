import type { ProjectBackupRepository } from './projectBackupRepository'
import { independentCopy } from './projectBackupRepository'
import type { ProjectSession } from './projectSession'
import { buildArchive, parseArchive } from '../storage/backup/archive'

export interface BackupState {
  phase: 'idle' | 'exporting' | 'validating' | 'importing' | 'done' | 'error'
  message?: string
}
export class ProjectBackupSession {
  private state: BackupState = { phase: 'idle' }
  private listeners = new Set<() => void>()
  private readonly projects: ProjectSession
  private readonly repository: ProjectBackupRepository
  private readonly encode: typeof buildArchive
  private readonly decode: typeof parseArchive
  constructor(projects: ProjectSession, repository: ProjectBackupRepository, encode = buildArchive, decode = parseArchive) {
    this.projects = projects; this.repository = repository; this.encode = encode; this.decode = decode
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(state: BackupState) { this.state = state; this.listeners.forEach((listener) => listener()) }
  busy = () => ['exporting', 'validating', 'importing'].includes(this.state.phase)
  dismiss = () => { if (!this.busy()) this.update({ phase: 'idle' }) }
  export = async (download: (bytes: Uint8Array, filename: string) => void | Promise<void>, beforeSnapshot: () => Promise<void> = async () => {}) => {
    if (this.busy()) return
    this.update({ phase: 'exporting' })
    try {
      await beforeSnapshot()
      await this.projects.flush()
      await this.projects.inspectProject(async (project) => {
        const snapshot = await this.repository.snapshot(project.id)
        const bytes = await this.encode(snapshot)
        await download(bytes, `bounty-mapper-${project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`)
      })
      this.update({ phase: 'done', message: 'Архив подготовлен и передан браузеру для скачивания.' })
    } catch (error) { this.update({ phase: 'error', message: `Ошибка экспорта. ${error instanceof Error ? error.message : 'Не удалось создать архив.'}` }) }
  }
  import = async (file: Blob) => {
    if (this.busy()) return
    this.update({ phase: 'validating' })
    try {
      await this.projects.adoptProject(async () => {
        const snapshot = await this.decode(file)
        const copy = independentCopy(snapshot)
        this.update({ phase: 'importing' })
        return this.repository.insertCopy(copy)
      })
      this.update({ phase: 'done', message: 'Копия проекта импортирована и сохранена на устройстве.' })
    } catch (error) { this.update({ phase: 'error', message: `Ошибка импорта. ${error instanceof Error ? error.message : 'Не удалось прочитать архив.'} Существующие проекты не изменены.` }) }
  }
}
