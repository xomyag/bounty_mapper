import { message } from '../../i18n/message'
import type { Asset } from '../../domain/project'

export async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error(message("ui.empty.image"))
    return image
  } catch {
    throw new Error(message("ui.could.not.decode.the.image.choose.a.valid.png"))
  } finally { URL.revokeObjectURL(url) }
}

export async function prepareImage(file: Blob, projectId: string, decode = decodeImage): Promise<Asset> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const matches = (offset: number, bytes: number[]) => bytes.every((byte, i) => header[offset + i] === byte)
  const mimeType = matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : matches(0, [255, 216, 255]) ? 'image/jpeg'
    : matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80]) ? 'image/webp' : undefined
  if (!mimeType || (file.type && file.type !== mimeType)) {
    throw new Error(message("ui.unsupported.file.use.png.jpeg.or.webp.the.contents"))
  }
  const blob = file.slice(0, file.size, mimeType)
  const image = await decode(blob)
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return {
    id: crypto.randomUUID(), projectId, mimeType, blob, byteSize: blob.size,
    pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight,
    checksum: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''), tags: [],
  }
}
