import { message } from '../i18n/message'
export interface RichMark { type: string; attrs?: Record<string, unknown> }
export interface RichNode { type: string; text?: string; attrs?: Record<string, unknown>; marks?: RichMark[]; content?: RichNode[] }
export interface RichDocument extends RichNode { type: 'doc'; content: RichNode[] }
export const emptyDocument = (): RichDocument => ({ type: 'doc', content: [{ type: 'paragraph' }] })
export function safeLink(value: unknown): string {
  if (typeof value !== 'string' || [...value].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) === 127)) return ''
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(value, 'https://bounty-mapper.invalid').protocol) ? value : '' } catch { return '' }
}
export function documentText(node: RichNode, imageLabel = '[Image]'): string {
  return node.text ?? (node.type === 'hardBreak' ? '\n' : node.type === 'image' ? imageLabel : (node.content ?? []).map((child) => documentText(child, imageLabel)).join(['doc', 'blockquote', 'bulletList', 'orderedList', 'table', 'tableRow'].includes(node.type) ? '\n' : ''))
}
export function documentHasContent(node: RichNode): boolean {
  return node.type === 'image' || !!node.text?.trim() || (node.content ?? []).some(documentHasContent)
}
export function documentAssetIds(node: RichNode): string[] {
  return [...new Set([...(node.type === 'image' ? [String(node.attrs?.assetId)] : []), ...(node.content ?? []).flatMap(documentAssetIds)])]
}
export function remapDocumentAssets(doc: RichDocument, ids: Map<string, string>): RichDocument {
  const copy = structuredClone(doc)
  const visit = (node: RichNode) => { if (node.type === 'image') node.attrs = { ...node.attrs, assetId: ids.get(String(node.attrs?.assetId))! }; node.content?.forEach(visit) }
  visit(copy); return copy
}

export function validateRichDocument(value: unknown): asserts value is RichDocument {
  const invalid = (): never => { throw new Error(message("ui.invalid.region.text.format")) }
  const blocks = ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image']
  const children: Record<string, string[]> = { doc: blocks, paragraph: ['text', 'hardBreak'], heading: ['text', 'hardBreak'], codeBlock: ['text'], bulletList: ['listItem'], orderedList: ['listItem'], listItem: blocks, blockquote: blocks, table: ['tableRow'], tableRow: ['tableCell', 'tableHeader'], tableCell: blocks, tableHeader: blocks }
  const attributes: Record<string, string[]> = { heading: ['level'], codeBlock: ['language'], orderedList: ['start', 'type'], tableCell: ['colspan', 'rowspan', 'colwidth', 'align'], tableHeader: ['colspan', 'rowspan', 'colwidth', 'align'], image: ['assetId', 'alt'] }
  let count = 0; let characters = 0
  const visit = (value: unknown, parent: string | undefined, depth: number): void => {
    if (++count > 10000 || depth > 32 || !value || typeof value !== 'object' || Array.isArray(value)) return invalid()
    const node = value as RichNode
    if (Object.keys(node).some((k) => !['type', 'text', 'attrs', 'marks', 'content'].includes(k)) || typeof node.type !== 'string' || (parent ? !children[parent]?.includes(node.type) : node.type !== 'doc')) return invalid()
    if (node.type === 'text') { if (typeof node.text !== 'string' || !node.text || node.content || node.attrs) return invalid(); characters += node.text.length }
    else if (node.text !== undefined) return invalid()
    if (node.attrs !== undefined) {
      if (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs) || Object.keys(node.attrs).some((k) => !attributes[node.type]?.includes(k))) return invalid()
    }
    const a = node.attrs ?? {}
    if (node.type === 'heading' && (!Number.isInteger(a.level) || Number(a.level) < 1 || Number(a.level) > 6)) return invalid()
    if (node.type === 'image' && (typeof a.assetId !== 'string' || !a.assetId || typeof a.alt !== 'string')) return invalid()
    if (node.type === 'orderedList' && (a.start !== undefined && (!Number.isSafeInteger(a.start) || Number(a.start) < 1) || a.type !== undefined && a.type !== null && !['1', 'a', 'A', 'i', 'I'].includes(String(a.type)))) return invalid()
    if (node.type === 'codeBlock' && a.language !== undefined && a.language !== null && typeof a.language !== 'string') return invalid()
    if (['tableCell', 'tableHeader'].includes(node.type)) {
      for (const key of ['colspan', 'rowspan']) if (a[key] !== undefined && (!Number.isInteger(a[key]) || Number(a[key]) < 1 || Number(a[key]) > 100)) return invalid()
      if (a.colwidth !== undefined && a.colwidth !== null && (!Array.isArray(a.colwidth) || a.colwidth.length > 100 || a.colwidth.some((x) => !Number.isInteger(x) || x < 1 || x > 10000))) return invalid()
      if (a.align !== undefined && a.align !== null && !['left', 'center', 'right'].includes(String(a.align))) return invalid()
    }
    if (node.marks !== undefined) {
      if (node.type !== 'text' || !Array.isArray(node.marks) || node.marks.length > 6) return invalid()
      for (const m of node.marks) {
        if (!m || !['bold', 'italic', 'underline', 'strike', 'code', 'link'].includes(m.type) || Object.keys(m).some((k) => !['type', 'attrs'].includes(k))) return invalid()
        if (m.type === 'link') {
          if (!m.attrs || !safeLink(m.attrs.href) || Object.keys(m.attrs).some((k) => !['href', 'target', 'rel', 'class', 'title'].includes(k)) || Object.values(m.attrs).some((v) => v !== null && typeof v !== 'string')) return invalid()
        } else if (m.attrs && Object.keys(m.attrs).length) return invalid()
      }
    }
    if (node.content !== undefined && (!children[node.type] || !Array.isArray(node.content))) return invalid()
    if (['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type) && !node.content?.length) return invalid()
    if (node.type === 'listItem' && node.content?.[0]?.type !== 'paragraph') return invalid()
    node.content?.forEach((child) => visit(child, node.type, depth + 1))
  }
  visit(value, undefined, 0)
  if (characters > 262144 || JSON.stringify(value).length > 524288) invalid()
}
