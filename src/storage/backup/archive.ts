import { zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import type { Asset } from '../../domain/project'
import type { ProjectSnapshot } from '../../application/projectBackupRepository'
import { prepareImage } from '../../features/map/prepareImage'
import { documentFromSnapshot, validateDocument } from './document'
import { BACKUP_LIMITS, fileLimit, unpackZip, validPath } from './zip'
import type { BackupLimits } from './zip'

export const BACKUP_FORMAT = 'bounty-mapper-project'
export const BACKUP_VERSION = 2
interface Manifest { format: string; formatVersion: number; createdAt: string; files: { path: string; byteSize: number; sha256: string }[] }
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function jsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value, null, 2)) }
function json(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { throw new Error('Повреждённый JSON в архиве.') }
}
function manifest(value: unknown, limits: BackupLimits): Manifest {
  if (!value || typeof value !== 'object') throw new Error('Некорректный manifest.json.')
  const m = value as Partial<Manifest>
  if (m.format !== BACKUP_FORMAT || ![1, BACKUP_VERSION].includes(m.formatVersion!)) throw new Error('Неизвестная версия или формат архива.')
  if (Object.keys(m).some((key) => !['format', 'formatVersion', 'createdAt', 'files'].includes(key)) ||
      typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || !Array.isArray(m.files) || m.files.length > limits.files - 1) throw new Error('Некорректный manifest.json.')
  const paths = new Set<string>()
  for (const f of m.files) {
    if (!f || typeof f !== 'object' || Object.keys(f).some((key) => !['path', 'byteSize', 'sha256'].includes(key)) ||
        typeof f.path !== 'string' || !validPath(f.path) || ['manifest.json', 'assets/'].includes(f.path) || paths.has(f.path) ||
        !Number.isSafeInteger(f.byteSize) || f.byteSize < 0 || f.byteSize > fileLimit(f.path, limits) ||
        typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Некорректный перечень файлов manifest.json.')
    paths.add(f.path)
  }
  return m as Manifest
}

export async function buildArchive(snapshot: ProjectSnapshot): Promise<Uint8Array> {
  const doc = documentFromSnapshot(snapshot)
  const files = new Map<string, Uint8Array>([['project.json', jsonBytes(doc)]])
  for (let i = 0; i < doc.assets.length; i++) {
    const record = doc.assets[i]
    if (snapshot.assets[i].blob.size !== record.byteSize) throw new Error('Размер сохранённого изображения не соответствует метаданным.')
    const bytes = new Uint8Array(await snapshot.assets[i].blob.arrayBuffer())
    if (bytes.length !== record.byteSize || await sha256(bytes) !== record.checksum) throw new Error('Сохранённое изображение не соответствует метаданным или контрольной сумме.')
    files.set(record.path, bytes)
  }
  let total = 0
  const entries: Manifest['files'] = []
  for (const [path, bytes] of files) {
    if (bytes.length > fileLimit(path, BACKUP_LIMITS)) throw new Error('Данные проекта превышают лимит файла резервной копии.')
    total += bytes.length
    if (total > BACKUP_LIMITS.unpackedBytes) throw new Error('Превышен лимит распакованных данных.')
    entries.push({ path, byteSize: bytes.length, sha256: await sha256(bytes) })
  }
  const m = jsonBytes({ format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, createdAt: new Date().toISOString(), files: entries } satisfies Manifest)
  const input: Zippable = { 'manifest.json': m, 'assets/': new Uint8Array() }
  for (const [path, bytes] of files) input[path] = [bytes, { level: path.startsWith('assets/') ? 0 : 6 }]
  const archive = zipSync(input)
  if (archive.length > BACKUP_LIMITS.archiveBytes) throw new Error('Архив превышает лимит 128 МиБ.')
  return archive
}

export async function parseArchive(file: Blob, decode: typeof prepareImage = prepareImage, limits: BackupLimits = BACKUP_LIMITS): Promise<ProjectSnapshot> {
  if (file.size > limits.archiveBytes) throw new Error('Архив превышает допустимый размер ZIP.')
  const files = await unpackZip(new Uint8Array(await file.arrayBuffer()), limits)
  const m = manifest(json(files.get('manifest.json')!), limits)
  const listed = new Set(m.files.map((entry) => entry.path))
  if (!listed.has('project.json') || [...files.keys()].some((path) => path !== 'manifest.json' && path !== 'assets/' && !listed.has(path))) throw new Error('Файлы ZIP не соответствуют manifest.json.')
  for (const entry of m.files) {
    const bytes = files.get(entry.path)
    if (!bytes || bytes.length !== entry.byteSize || await sha256(bytes) !== entry.sha256) throw new Error(`Ошибка контрольной суммы или размера файла: ${entry.path}`)
  }
  const doc = validateDocument(json(files.get('project.json')!), limits, m.formatVersion)
  const paths = new Set(doc.assets.map((asset) => asset.path))
  if ([...listed].some((path) => path !== 'project.json' && !paths.has(path)) || doc.assets.some((asset) => !listed.has(asset.path))) throw new Error('Перечень изображений не соответствует данным проекта.')
  const assets: Asset[] = []
  for (const record of doc.assets) {
    const bytes = files.get(record.path)!
    if (bytes.length !== record.byteSize || await sha256(bytes) !== record.checksum) throw new Error('Метаданные изображения не соответствуют содержимому архива.')
    const blob = new Blob([new Uint8Array(bytes)], { type: record.mimeType })
    const actual = await decode(blob, doc.project.id)
    if (actual.pixelWidth !== record.pixelWidth || actual.pixelHeight !== record.pixelHeight || actual.mimeType !== record.mimeType) throw new Error('Размеры или тип декодированного изображения не соответствуют метаданным.')
    const { path: _path, ...metadata } = record
    void _path
    assets.push({ ...metadata, blob })
  }
  return { project: doc.project, maps: doc.maps, imagePlacements: doc.imagePlacements, regions: doc.regions, assets }
}
