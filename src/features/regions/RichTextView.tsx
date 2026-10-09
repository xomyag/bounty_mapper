import { createElement, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Asset } from '../../domain/project'
import type { RichDocument, RichNode } from '../../domain/richText'
import { safeLink } from '../../domain/richText'

export function AssetImage({ asset, alt }: { asset?: Asset; alt: string }) {
  const [loaded, setLoaded] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!asset) return
    const url = URL.createObjectURL(asset.blob)
    let active = true
    queueMicrotask(() => { if (active) setLoaded({ blob: asset.blob, url }) })
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [asset])
  return asset && loaded?.blob === asset.blob ? <img src={loaded.url} alt={alt || 'Изображение в тексте'} /> : <span role="status">{asset ? 'Подготовка изображения…' : 'Изображение недоступно'}</span>
}
export function RichTextView({ document, assets }: { document: RichDocument; assets: Record<string, Asset> }) {
  const render = (node: RichNode, index: number): ReactNode => {
    if (node.type === 'text') {
      let text: ReactNode = node.text
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link') { const href = safeLink(mark.attrs?.href); text = href ? <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> : text }
        else { const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' } as Record<string, string>)[mark.type]; if (tag) text = createElement(tag, {}, text) }
      }
      return <span key={index}>{text}</span>
    }
    if (node.type === 'image') return <AssetImage key={index} asset={assets[String(node.attrs?.assetId)]} alt={String(node.attrs?.alt ?? '')} />
    if (node.type === 'hardBreak') return <br key={index} />
    if (node.type === 'horizontalRule') return <hr key={index} />
    if (node.type === 'table') return <table key={index}><tbody>{node.content?.map(render)}</tbody></table>
    if (node.type === 'codeBlock') return <pre key={index}><code>{node.content?.map(render)}</code></pre>
    const tag = node.type === 'heading' ? `h${Number(node.attrs?.level)}` : ({ paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote', tableRow: 'tr', tableCell: 'td', tableHeader: 'th' } as Record<string, string>)[node.type]
    return tag ? createElement(tag, { key: index, ...(node.type === 'orderedList' ? { start: node.attrs?.start } : {}), ...(['tableCell', 'tableHeader'].includes(node.type) ? { colSpan: node.attrs?.colspan, rowSpan: node.attrs?.rowspan, style: { textAlign: node.attrs?.align } } : {}) }, node.content?.map(render)) : null
  }
  return <div className="rich-text-view">{document.content.map(render)}</div>
}
