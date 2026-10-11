import type { Asset } from '../../domain/project'
import { decodeImage } from './prepareImage'

const decoded = new Map<string, HTMLImageElement>()
export const cachedBitmap = (assetId?: string) => assetId ? decoded.get(assetId) : undefined
export async function prepareBitmap(asset: Asset) {
  const cached = decoded.get(asset.id)
  if (cached) return cached
  const image = await decodeImage(asset.blob)
  decoded.set(asset.id, image)
  // Bound decoded-image memory; an evicted map is decoded before navigation.
  if (decoded.size > 8) decoded.delete(decoded.keys().next().value!)
  return image
}
