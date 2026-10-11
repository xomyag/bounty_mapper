import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { emptyDocument, safeLink } from '../domain/richText'
import type { RichDocument, RichMark, RichNode } from '../domain/richText'
import type { Region } from '../domain/region'

interface MdNode { type: string; value?: string; children?: MdNode[]; url?: string; alt?: string; depth?: number; ordered?: boolean; start?: number; checked?: boolean | null; lang?: string; identifier?: string; align?: (string | null)[] }
const parser = unified().use(remarkParse).use(remarkGfm)
export function markdownToDocument(markdown: string): RichDocument {
  const root = parser.parse(markdown) as unknown as MdNode
  const definitions = new Map<string, string>()
  const collect = (node: MdNode) => { if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url); node.children?.forEach(collect) }
  collect(root)
  const inline = (node: MdNode, marks: RichMark[] = []): RichNode[] => {
    if (['text', 'html', 'inlineCode'].includes(node.type)) return node.value ? [{ type: 'text', text: node.value, ...(marks.length || node.type === 'inlineCode' ? { marks: [...marks, ...(node.type === 'inlineCode' ? [{ type: 'code' }] : [])] } : {}) }] : []
    if (node.type === 'break') return [{ type: 'hardBreak' }]
    if (['image', 'imageReference'].includes(node.type)) {
      const url = node.url ?? definitions.get(node.identifier ?? '') ?? ''
      return [{ type: 'text', text: `[Изображение: ${node.alt ?? ''}]${url ? ` (${url})` : ''}`, ...(marks.length ? { marks } : {}) }]
    }
    const style = ({ strong: 'bold', emphasis: 'italic', delete: 'strike' } as Record<string, string>)[node.type]
    const href = safeLink(node.url ?? definitions.get(node.identifier ?? ''))
    const next = style ? [...marks, { type: style }] : ['link', 'linkReference'].includes(node.type) && href ? [...marks, { type: 'link', attrs: { href } }] : marks
    return (node.children ?? []).flatMap((c) => inline(c, next))
  }
  const block = (node: MdNode): RichNode[] => {
    const nested = () => (node.children ?? []).flatMap(block)
    switch (node.type) {
      case 'definition': return []
      case 'heading': return [{ type: 'heading', attrs: { level: node.depth }, content: (node.children ?? []).flatMap((c) => inline(c)) }]
      case 'paragraph': return [{ type: 'paragraph', content: (node.children ?? []).flatMap((c) => inline(c)) }]
      case 'list': return [{ type: node.ordered ? 'orderedList' : 'bulletList', ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}), content: nested() }]
      case 'listItem': {
        const nestedContent = nested()
        const content = nestedContent[0]?.type === 'paragraph' ? nestedContent : [{ type: 'paragraph' }, ...nestedContent]
        if (typeof node.checked === 'boolean') content[0].content = [{ type: 'text', text: node.checked ? '[x] ' : '[ ] ' }, ...(content[0].content ?? [])]
        return [{ type: 'listItem', content }]
      }
      case 'blockquote': return [{ type: 'blockquote', content: nested() }]
      case 'code': return [{ type: 'codeBlock', attrs: { language: node.lang ?? null }, ...(node.value ? { content: [{ type: 'text', text: node.value }] } : {}) }]
      case 'thematicBreak': return [{ type: 'horizontalRule' }]
      case 'table': return [{ type: 'table', content: (node.children ?? []).map((row, index) => ({ type: 'tableRow', content: (row.children ?? []).map((cell, col) => ({ type: index === 0 ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: node.align?.[col] ?? null }, content: [{ type: 'paragraph', content: (cell.children ?? []).flatMap((c) => inline(c)) }] })) })) }]
      default: return node.value ? [{ type: 'paragraph', content: [{ type: 'text', text: node.value }] }] : nested()
    }
  }
  const content = (root.children ?? []).flatMap(block)
  return content.length ? { type: 'doc', content } : emptyDocument()
}
export function migrateRegionText(value: Record<string, unknown>): Region {
  const { gmNotesMd, playerDescriptionMd, ...rest } = value
  return { shortDescription: '', checks: [], tags: [], ...rest, titleCustomized: value.title !== `Область ${value.number}`, gmNotes: markdownToDocument(typeof gmNotesMd === 'string' ? gmNotesMd : ''), playerDescription: markdownToDocument(typeof playerDescriptionMd === 'string' ? playerDescriptionMd : '') } as unknown as Region
}
