import { message } from '../../i18n/message'
import { Unzip, UnzipInflate } from 'fflate'
import { MAX_PROJECT_MAPS } from '../../domain/project'

export const BACKUP_LIMITS = {
  archiveBytes: 128 * 1024 * 1024,
  unpackedBytes: 256 * 1024 * 1024,
  assetBytes: 64 * 1024 * 1024,
  projectBytes: 4 * 1024 * 1024,
  manifestBytes: 512 * 1024,
  files: 512,
  maps: MAX_PROJECT_MAPS,
  assets: 256,
}
export type BackupLimits = typeof BACKUP_LIMITS

export function fileLimit(path: string, limits: BackupLimits) {
  return path === 'manifest.json' ? limits.manifestBytes : path === 'project.json' ? limits.projectBytes : limits.assetBytes
}
export function validPath(path: string) {
  return /^(manifest\.json|project\.json|assets\/|assets\/[0-9]+\.(png|jpg|webp))$/.test(path)
}

// Read directory metadata before inflation. Reject ZIP64, encryption, duplicates and unsafe paths.
function directory(bytes: Uint8Array, limits: BackupLimits) {
  if (bytes.length > limits.archiveBytes) throw new Error(message("ui.the.archive.exceeds.the.allowed.zip.size"))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = new Map<string, number>()
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0) throw new Error(message("ui.corrupted.zip.archive.directory.missing"))
  const count = view.getUint16(end + 10, true)
  const size = view.getUint32(end + 12, true)
  const start = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count ||
      count > limits.files || count === 65535 || start + size !== end) throw new Error(message("ui.unsupported.zip.structure.or.file.limit.exceeded"))
  let offset = start
  let total = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error(message("ui.corrupted.zip.directory"))
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const original = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > end || local + 30 > start || view.getUint32(local, true) !== 0x04034b50 || compressed > bytes.length ||
        view.getUint16(offset + 6, true) > 20 || view.getUint16(local + 4, true) > 20 || view.getUint16(offset + 34, true) !== 0 ||
        flags & 1 || ![0, 8].includes(method)) throw new Error(message("ui.corrupted.encrypted.or.unsupported.zip"))
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    const localNameLength = view.getUint16(local + 26, true)
    const localExtraLength = view.getUint16(local + 28, true)
    if (!validPath(path) || entries.has(path) || local + 30 + localNameLength + localExtraLength + compressed > start ||
        decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== path ||
        view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) throw new Error(message("ui.invalid.or.duplicate.zip.file"))
    if (original > fileLimit(path, limits) || (path === 'assets/' && original !== 0)) throw new Error(message("ui.an.archive.file.exceeds.the.allowed.size"))
    total += original
    if (total > limits.unpackedBytes) throw new Error(message("ui.the.uncompressed.data.limit.was.exceeded"))
    entries.set(path, original)
    offset = next
  }
  if (offset !== end || !entries.has('manifest.json') || !entries.has('project.json')) throw new Error(message("ui.required.archive.files.are.missing.or.the.directory.is"))
  return entries
}

export async function unpackZip(bytes: Uint8Array, limits = BACKUP_LIMITS): Promise<Map<string, Uint8Array>> {
  const expected = directory(bytes, limits)
  const files = new Map<string, Uint8Array>()
  const seen = new Set<string>()
  let total = 0
  const unzip = new Unzip((file) => {
    const size = expected.get(file.name)
    if (size === undefined || seen.has(file.name) || (file.originalSize !== undefined && file.originalSize !== size)) throw new Error(message("ui.invalid.zip.size.or.duplicate.zip.file"))
    seen.add(file.name)
    const chunks: Uint8Array[] = []
    let length = 0
    file.ondata = (error, data, final) => {
      if (error) throw new Error(message("ui.could.not.extract.zip.corrupted.data"))
      length += data.length
      total += data.length
      // Check actual emitted bytes, even if an attacker lied in ZIP headers.
      if (length > size || length > fileLimit(file.name, limits) || total > limits.unpackedBytes) {
        file.terminate()
        throw new Error(message("ui.uncompressed.data.limit.exceeded.or.incorrect.size"))
      }
      chunks.push(data)
      if (final) {
        if (length !== size) throw new Error(message("ui.invalid.uncompressed.file.size"))
        const combined = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length }
        files.set(file.name, combined)
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  // Small compressed chunks bound an inflater's temporary output before the limit callback.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, Math.min(bytes.length, offset + 1024)), offset + 1024 >= bytes.length)
    if (offset && offset % (64 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  if (files.size !== expected.size) throw new Error(message("ui.incomplete.zip.file.data.is.missing"))
  return files
}
