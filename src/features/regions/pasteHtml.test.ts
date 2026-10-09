// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { cleanPastedHtml } from './pasteHtml'
import { validateRichDocument } from '../../domain/richText'

describe('Supported clipboard HTML', () => {
  it('preserves supported markup and styles through the editor schema and removes executable content', () => {
    const html = cleanPastedHtml('<h2>Зал</h2><p><span style="font-weight:700;font-style:italic;text-decoration:underline;background-image:url(https://bad.example)">Текст</span><a href="javascript:alert(1)">Опасно</a><a href="https://example.org">Ссылка</a></p><ul><li>Первый</li></ul><blockquote>Цитата</blockquote><table><tr><th>СЛ</th></tr><tr><td>15</td></tr></table><script>alert(1)</script><img src="https://bad.example/a" onerror="alert(1)"><svg onload="alert(1)"></svg>', new Set())
    expect(html).not.toMatch(/script|onerror|onload|javascript:|background-image|bad.example/)
    const doc = generateJSON(html, [StarterKit, TableKit])
    expect(() => validateRichDocument(doc)).not.toThrow()
    const serialized = JSON.stringify(doc)
    for (const type of ['heading', 'bold', 'italic', 'underline', 'bulletList', 'blockquote', 'table']) expect(serialized).toContain(`"type":"${type}"`)
  })
})
