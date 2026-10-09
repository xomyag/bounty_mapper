import { describe, expect, it } from 'vitest'
import { documentAssetIds, documentHasContent, documentText, emptyDocument, remapDocumentAssets, safeLink, validateRichDocument } from './richText'
import { markdownToDocument } from '../storage/migrateRegionText'

describe('Visual text format and Markdown migration', () => {
  it('migrates headings, emphasis, lists, quotes, links, references, code and tables without HTML execution', () => {
    const doc = markdownToDocument('# Зал\n\n- **Золото** и *пыль*\n- [Карта][map]\n\n> Цитата\n\n| Навык | СЛ |\n| --- | --- |\n| Сила | 15 |\n\n`код`\n\n<script>alert(1)</script>\n\n[map]: https://example.org')
    expect(() => validateRichDocument(doc)).not.toThrow()
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'bulletList', 'blockquote', 'table', 'paragraph', 'paragraph'])
    expect(JSON.stringify(doc)).toContain('"type":"bold"')
    expect(JSON.stringify(doc)).toContain('"type":"italic"')
    expect(JSON.stringify(doc)).toContain('"href":"https://example.org"')
    expect(documentText(doc)).toContain('<script>alert(1)</script>')
    expect(documentHasContent(emptyDocument())).toBe(false)
    expect(documentHasContent(markdownToDocument('\n\n'))).toBe(false)
  })
  it('preserves task state and legacy image text/URL without downloading it', () => {
    const doc = markdownToDocument('- [x] Найдено\n- [ ] Осталось\n\n![План](https://example.org/map.png)')
    expect(() => validateRichDocument(doc)).not.toThrow()
    expect(documentText(doc)).toContain('[x] Найдено')
    expect(documentText(doc)).toContain('[ ] Осталось')
    expect(documentText(doc)).toContain('[Изображение: План] (https://example.org/map.png)')
    expect(documentAssetIds(doc)).toEqual([])
  })
  it('rejects dangerous links, arbitrary nodes/attrs, excessive nesting and dangling image metadata', () => {
    for (const link of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,boom', 'file:///C:/secret']) expect(safeLink(link)).toBe('')
    expect(safeLink('https://example.org')).toBe('https://example.org')
    expect(safeLink('#section')).toBe('#section')
    for (const node of [{ type: 'script' }, { type: 'image', attrs: { src: 'blob:temporary', alt: '' } }, { type: 'paragraph', attrs: { onclick: 'boom' } }, { type: 'paragraph', content: [{ type: 'text', text: 'X', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }]) expect(() => validateRichDocument({ type: 'doc', content: [node] })).toThrow()
    let doc = emptyDocument()
    for (let i = 0; i < 33; i++) doc = { type: 'doc', content: [{ type: 'blockquote', content: doc.content }] }
    expect(() => validateRichDocument(doc)).toThrow()
  })
  it('preserves and remaps shared asset references without mutating the original document', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'image', attrs: { assetId: 'a', alt: 'Снимок' } }, { type: 'image', attrs: { assetId: 'a', alt: '' } }] }
    expect(() => validateRichDocument(doc)).not.toThrow()
    expect(documentHasContent(doc)).toBe(true)
    expect(documentAssetIds(doc)).toEqual(['a'])
    expect(documentAssetIds(remapDocumentAssets(doc, new Map([['a', 'b']])))).toEqual(['b'])
    expect(documentAssetIds(doc)).toEqual(['a'])
  })
})
