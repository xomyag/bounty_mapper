import type { RegionSession } from '../../application/regionSession'
import type { Asset } from '../../domain/project'
import { prepareImage } from '../map/prepareImage'

export async function prepareCardImage(file: Blob, session: RegionSession, addAsset: (asset: Asset) => void): Promise<Asset> {
  session.beginImageInsertion()
  let failure: unknown
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error('Изображение превышает лимит 64 МиБ.')
    const asset = await prepareImage(file, session.getProjectId()!)
    if (asset.pixelWidth * asset.pixelHeight > 64 * 1024 * 1024) throw new Error('Изображение превышает лимит 64 мегапикселей.')
    addAsset(asset); return asset
  } catch (error) { failure = error; throw error }
  finally { session.endImageInsertion(failure) }
}
