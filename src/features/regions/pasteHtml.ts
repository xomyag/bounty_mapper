import DOMPurify from 'dompurify'
import { safeLink } from '../../domain/richText'

export function cleanPastedHtml(html: string, allowedAssetIds: Set<string>): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'hr', 'img'],
    ALLOWED_ATTR: ['href', 'style', 'colspan', 'rowspan', 'start', 'type', 'align', 'data-asset-id', 'alt'], ALLOW_DATA_ATTR: false,
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  for (const node of doc.body.querySelectorAll<HTMLElement>('*')) {
    const style = node.style
    const weight = /^(bold|[6-9]00)$/.test(style.fontWeight) ? style.fontWeight : ''
    const italic = style.fontStyle === 'italic'
    const decoration = /underline/.test(style.textDecoration + style.textDecorationLine) ? 'underline' : /line-through/.test(style.textDecoration + style.textDecorationLine) ? 'line-through' : ''
    const align = ['left', 'center', 'right'].includes(style.textAlign) ? style.textAlign : ''
    node.removeAttribute('style')
    if (weight) style.fontWeight = weight
    if (italic) style.fontStyle = 'italic'
    if (decoration) style.textDecoration = decoration
    if (align) style.textAlign = align
    if (node.hasAttribute('href') && !safeLink(node.getAttribute('href'))) node.removeAttribute('href')
    if (node.tagName === 'IMG' && !allowedAssetIds.has(node.getAttribute('data-asset-id') ?? '')) node.remove()
  }
  return doc.body.innerHTML
}
