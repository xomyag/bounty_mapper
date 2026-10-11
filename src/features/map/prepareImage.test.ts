import { localizedFailure } from '../../localizedTestFailure'
import { describe, expect, it, vi } from 'vitest'
import { prepareImage } from './prepareImage'

const signatures = [
  ['image/png', [137, 80, 78, 71, 13, 10, 26, 10]],
  ['image/jpeg', [255, 216, 255]],
  ['image/webp', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
] as const
const decoded = { naturalWidth: 800, naturalHeight: 400 } as HTMLImageElement

describe('Image preparation', () => {
  it.each(signatures)('checks %s contents and records original dimensions and checksum', async (type, signature) => {
    const blob = new Blob([new Uint8Array(signature)], { type })
    const decode = vi.fn().mockResolvedValue(decoded)
    const asset = await prepareImage(blob, 'project', decode)
    expect(asset).toMatchObject({ projectId: 'project', mimeType: type, pixelWidth: 800, pixelHeight: 400, byteSize: blob.size })
    expect(asset.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(await asset.blob.arrayBuffer()).toEqual(await blob.arrayBuffer())
    expect(decode).toHaveBeenCalledOnce()
  })
  it('rejects unsupported contents and a misleading MIME type before decoding', async () => {
    const decode = vi.fn().mockResolvedValue(decoded)
    await expect(localizedFailure(prepareImage(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'p', decode))).rejects.toThrow('Неподдерживаемый файл')
    await expect(localizedFailure(prepareImage(new Blob(['broken'], { type: 'image/png' }), 'p', decode))).rejects.toThrow('Неподдерживаемый файл')
    await expect(localizedFailure(prepareImage(new Blob([new Uint8Array(signatures[0][1])], { type: 'image/jpeg' }), 'p', decode))).rejects.toThrow('Неподдерживаемый файл')
    expect(decode).not.toHaveBeenCalled()
  })
  it('propagates a decoding failure without producing an asset', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('Не удалось декодировать изображение'))
    await expect(localizedFailure(prepareImage(new Blob([new Uint8Array(signatures[0][1])], { type: 'image/png' }), 'p', decode))).rejects.toThrow('декодировать')
  })
})
