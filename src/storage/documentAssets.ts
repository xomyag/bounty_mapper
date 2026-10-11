import { message } from '../i18n/message'
import type { Asset } from '../domain/project'
import type { RichDocument } from '../domain/richText'
import { documentAssetIds, validateRichDocument } from '../domain/richText'
import { requestResult } from './indexedDb'

export async function writeDocumentAssets(tx: IDBTransaction, projectId: string, assets: Asset[], documents: RichDocument[]) {
  const store = tx.objectStore('assets')
  for (const document of documents) validateRichDocument(document)
  for (const asset of assets) {
    if (asset.projectId !== projectId || !asset.id.trim() || !(asset.blob instanceof Blob) || asset.blob.size !== asset.byteSize || asset.byteSize < 1 || asset.byteSize > 64 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) || !/^[a-f0-9]{64}$/.test(asset.checksum) || !Number.isSafeInteger(asset.pixelWidth) || !Number.isSafeInteger(asset.pixelHeight) || asset.pixelWidth < 1 || asset.pixelHeight < 1 || asset.pixelWidth * asset.pixelHeight > 64 * 1024 * 1024) throw new Error(message("ui.invalid.document.image"))
    await requestResult(store.add(asset))
  }
  for (const id of new Set(documents.flatMap(documentAssetIds))) {
    const asset = await requestResult(store.get(id)) as Asset | undefined
    if (!asset || asset.projectId !== projectId) throw new Error(message("ui.a.document.image.is.missing.or.belongs.to.another"))
  }
}
