// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { message, setLanguage } from '../../i18n'
import type { RichDocument } from '../../domain/richText'
import { RichTextView } from './RichTextView'

it('renders user text literally in both languages, including text resembling an internal UI message', () => {
  const text = `Сохранить — Projects — ${message('ui.save')}`
  const document: RichDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.org' } }] }] }] }
  const view = render(<RichTextView document={document} assets={{}} />)
  for (const language of ['en', 'ru'] as const) {
    setLanguage(language, { setItem: () => {} })
    view.rerender(<RichTextView document={document} assets={{}} />)
    expect(screen.getByRole('link').textContent).toBe(text)
    expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link').querySelector('strong')?.textContent).toBe(text)
  }
})
