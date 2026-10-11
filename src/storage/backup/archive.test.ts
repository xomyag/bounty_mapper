import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { buildArchive, parseArchive, sha256 } from './archive'
import { BACKUP_LIMITS, unpackZip } from './zip'
import { testDecode, testSnapshot } from './testSnapshot'

function blob(bytes: Uint8Array) { return new Blob([new Uint8Array(bytes)], { type: 'application/zip' }) }
function read(bytes: Uint8Array) { return JSON.parse(new TextDecoder().decode(bytes)) }
function json(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)) }

describe('Project backup format', () => {
  it('round-trips context, all maps, empty maps, placements and original images', async () => {
    const original = await testSnapshot()
    const bytes = await buildArchive(original)
    const entries = unzipSync(bytes)
    expect(Object.keys(entries).sort()).toEqual(['assets/', 'assets/0.png', 'assets/1.png', 'manifest.json', 'project.json'])
    const manifest = read(entries['manifest.json'])
    expect(manifest.formatVersion).toBe(8)
    for (const file of manifest.files) {
      expect(file.byteSize).toBe(entries[file.path].length)
      expect(file.sha256).toBe(await sha256(entries[file.path]))
    }
    const restored = await parseArchive(blob(bytes), testDecode)
    expect(restored.project).toEqual(original.project)
    expect(restored.maps).toEqual(original.maps)
    expect(restored.imagePlacements).toEqual(original.imagePlacements)
    for (let i = 0; i < restored.assets.length; i++) {
      expect(await restored.assets[i].blob.arrayBuffer()).toEqual(await original.assets[i].blob.arrayBuffer())
      expect(restored.assets[i]).toMatchObject({ caption: original.assets[i].caption, tags: ['карта'], checksum: original.assets[i].checksum })
    }
  })

  it('supports projects with no maps or assets and projects with a removed image', async () => {
    const snapshot = await testSnapshot()
    for (const maps of [[], snapshot.maps]) {
      const empty = { ...snapshot, maps, assets: [], imagePlacements: [] }
      const copy = await parseArchive(blob(await buildArchive(empty)), testDecode)
      expect(copy.maps).toEqual(maps)
      expect(copy.assets).toEqual([])
    }
  })

  it('projects only domain fields and excludes settings or extra secret fields', async () => {
    const snapshot = await testSnapshot()
    Object.assign(snapshot.project, { apiKey: 'secret-value', camera: { x: 1 } })
    const doc = new TextDecoder().decode(unzipSync(await buildArchive(snapshot))['project.json'])
    expect(doc).not.toContain('secret-value')
    expect(doc).not.toContain('apiKey')
    expect(doc).not.toContain('camera')
  })

  it('rejects corruption, unknown versions, missing files and extra files', async () => {
    const archive = await buildArchive(await testSnapshot())
    const corrupted = unzipSync(archive)
    corrupted['assets/0.png'][20] ^= 1
    await expect(parseArchive(blob(zipSync(corrupted)), testDecode)).rejects.toThrow('контрольной суммы')
    const unknown = unzipSync(archive)
    unknown['manifest.json'] = json({ ...read(unknown['manifest.json']), formatVersion: 99 })
    await expect(parseArchive(blob(zipSync(unknown)), testDecode)).rejects.toThrow('Неизвестная версия')
    const missing = unzipSync(archive)
    delete missing['project.json']
    await expect(parseArchive(blob(zipSync(missing)), testDecode)).rejects.toThrow('обязательные')
    const extra = unzipSync(archive)
    extra['assets/99.png'] = new Uint8Array([1])
    await expect(parseArchive(blob(zipSync(extra)), testDecode)).rejects.toThrow('не соответствуют')
    await expect(parseArchive(blob(archive.subarray(0, archive.length - 15)), testDecode)).rejects.toThrow('ZIP')
  })

  it('rejects invalid references even when all JSON checksums were updated correctly', async () => {
    const entries = unzipSync(await buildArchive(await testSnapshot()))
    const doc = read(entries['project.json'])
    doc.imagePlacements[0].assetId = 'missing-image'
    entries['project.json'] = json(doc)
    const manifest = read(entries['manifest.json'])
    const file = manifest.files.find((entry: { path: string }) => entry.path === 'project.json')
    file.byteSize = entries['project.json'].length
    file.sha256 = await sha256(entries['project.json'])
    entries['manifest.json'] = json(manifest)
    await expect(parseArchive(blob(zipSync(entries)), testDecode)).rejects.toThrow('отсутствующую карту или изображение')
  })

  it('rejects a dimension mismatch or failed decoding', async () => {
    const archive = blob(await buildArchive(await testSnapshot()))
    await expect(parseArchive(archive, async (file, id) => ({ ...await testDecode(file, id), pixelWidth: 10 }))).rejects.toThrow('Размеры')
    await expect(parseArchive(archive, async () => { throw new Error('Ошибка декодирования') })).rejects.toThrow('декодирования')
  })

  it('enforces compressed, per-file and total expanded limits before collecting payloads', async () => {
    const bytes = await buildArchive(await testSnapshot())
    await expect(parseArchive(blob(bytes), testDecode, { ...BACKUP_LIMITS, archiveBytes: bytes.length - 1 })).rejects.toThrow('размер ZIP')
    await expect(unpackZip(bytes, { ...BACKUP_LIMITS, assetBytes: 1 })).rejects.toThrow('размер')
    await expect(unpackZip(bytes, { ...BACKUP_LIMITS, unpackedBytes: 100 })).rejects.toThrow('лимит распакованных')
    await expect(unpackZip(bytes, { ...BACKUP_LIMITS, files: 2 })).rejects.toThrow('лимит файлов')
  })

  it('rejects actual decompression overflow when both ZIP headers lie about the size', async () => {
    const bytes = zipSync({ 'manifest.json': json({}), 'project.json': json({}), 'assets/0.png': new Uint8Array(20000) })
    const view = new DataView(bytes.buffer)
    const decoder = new TextDecoder()
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      const signature = view.getUint32(offset, true)
      if (signature === 0x04034b50) {
        const length = view.getUint16(offset + 26, true)
        if (decoder.decode(bytes.subarray(offset + 30, offset + 30 + length)) === 'assets/0.png') view.setUint32(offset + 22, 1, true)
      }
      if (signature === 0x02014b50) {
        const length = view.getUint16(offset + 28, true)
        if (decoder.decode(bytes.subarray(offset + 46, offset + 46 + length)) === 'assets/0.png') view.setUint32(offset + 24, 1, true)
      }
    }
    await expect(unpackZip(bytes, { ...BACKUP_LIMITS, assetBytes: 100 })).rejects.toThrow()
  })

  it('rejects unsafe paths and unexpected schema fields', async () => {
    const entries = unzipSync(await buildArchive(await testSnapshot()))
    entries['../outside'] = new Uint8Array()
    await expect(unpackZip(zipSync(entries))).rejects.toThrow('Недопустимый')
    delete entries['../outside']
    const doc = read(entries['project.json'])
    doc.project.schemaVersion = 99
    entries['project.json'] = json(doc)
    const m = read(entries['manifest.json'])
    const file = m.files.find((entry: { path: string }) => entry.path === 'project.json')
    file.byteSize = entries['project.json'].length; file.sha256 = await sha256(entries['project.json'])
    entries['manifest.json'] = json(m)
    await expect(parseArchive(blob(zipSync(entries)), testDecode)).rejects.toThrow('Версия данных проекта')
  })
})
