import type { Asset } from '../domain/project'

// Repository tests check blob persistence; decoding is checked separately.
export function testAsset(projectId: string, width = 640): Asset {
  const blob = new Blob(['test image bytes'], { type: 'image/png' })
  return { id: crypto.randomUUID(), projectId, mimeType: blob.type, byteSize: blob.size, pixelWidth: width, pixelHeight: 320, checksum: 'test-checksum', tags: [], blob }
}
