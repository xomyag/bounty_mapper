import { localize, message, t } from '../../i18n'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react'
import type { ReactNode } from 'react'
import { Bold, Italic, Underline, List, ListOrdered, Quote, Link, ImagePlus, Table, Ellipsis } from 'lucide-react'
import type { NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import type { Asset } from '../../domain/project'
import type { RichDocument } from '../../domain/richText'
import { safeLink } from '../../domain/richText'
import { AssetImage } from './RichTextView'
import { cleanPastedHtml } from './pasteHtml'
import { useLanguage } from '../../i18n/useLanguage'

const AssetsContext = createContext<Record<string, Asset>>({})
function ImageNode({ node, deleteNode, editor }: NodeViewProps) {
  useLanguage()
  const assets = useContext(AssetsContext)
  return <NodeViewWrapper className="text-image" contentEditable={false}><AssetImage asset={assets[node.attrs.assetId]} alt={node.attrs.alt} />{editor.isEditable && <button type="button" aria-label={t("ui.remove.image.from.text")} onClick={deleteNode}>{t("ui.remove.image")}</button>}</NodeViewWrapper>
}
const AssetNode = Image.extend({
  addAttributes() { return { assetId: { default: null, parseHTML: (element) => element.getAttribute('data-asset-id') }, alt: { default: '' } } },
  parseHTML() { return [{ tag: 'img[data-asset-id]' }] },
  renderHTML({ node }) { return ['img', { 'data-asset-id': node.attrs.assetId, alt: node.attrs.alt }] },
  addNodeView() { return ReactNodeViewRenderer(ImageNode) },
})
const extensions = [StarterKit.configure({ link: { openOnClick: false, isAllowedUri: (url) => !!safeLink(url) } }), TableKit.configure({ table: { resizable: false } }), AssetNode]

export function RichTextEditor({ label, value, assets, disabled, onChange, insertImage, onError }: { label: string; value: RichDocument; assets: Record<string, Asset>; disabled: boolean; onChange: (document: RichDocument) => void; insertImage: (file: Blob) => Promise<Asset>; onError: (error: unknown) => void }) {
  const language = useLanguage()
  const toolbar = useRef<HTMLDivElement>(null)
  const moreMenu = useRef<HTMLDivElement>(null)
  const moreId = useId()
  const [compact, setCompact] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  const savedSelection = useRef<{ from: number; to: number }>({ from: 1, to: 1 })
  const editor = useEditor({
    extensions, content: value, editable: !disabled, enablePasteRules: false,
    editorProps: { attributes: { role: 'textbox', 'aria-label': localize(label), 'aria-multiline': 'true', spellcheck: 'true' },
      transformPastedHTML: (html) => cleanPastedHtml(html, new Set(Object.keys(assets))),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
        if (files.length) { void addImages(files); return true }
        if ((event.clipboardData?.getData('text/html').length ?? 0) > 1048576 || (event.clipboardData?.getData('text/plain').length ?? 0) > 262144) { onError(new Error(message("ui.the.pasted.text.exceeds.the.allowed.size"))); return true }
        return false
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichDocument),
  })
  // Locking during a write is UI state, not a document edit. Otherwise Tiptap's
  // update event replaces the error/draft version with an unchanged document.
  useEffect(() => { const observer = new ResizeObserver(() => { if (toolbar.current) setCompact(toolbar.current.clientWidth < 510) }); if (toolbar.current) observer.observe(toolbar.current); return () => observer.disconnect() }, [editor])
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => { editor?.setOptions({ editorProps: { attributes: { role: 'textbox', 'aria-label': localize(label), 'aria-multiline': 'true', spellcheck: 'true' } } }) }, [editor, label, language])
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive('bold'), italic: editor?.isActive('italic'), underline: editor?.isActive('underline'), bullet: editor?.isActive('bulletList'), ordered: editor?.isActive('orderedList'), quote: editor?.isActive('blockquote'), heading: editor?.isActive('heading') ? editor.getAttributes('heading').level as number : 0, link: editor?.isActive('link') }) })
  async function addImages(files: Blob[]) {
    if (!editor || disabled) return
    const bookmark = editor.state.selection.getBookmark()
    try {
      const inserted: Asset[] = []
      for (const file of files) inserted.push(await insertImage(file))
      if (!editor.isDestroyed) {
        const selection = bookmark.resolve(editor.state.doc)
        editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).insertContent(inserted.map((a) => ({ type: 'image', attrs: { assetId: a.id, alt: t("ui.image.in.text") } }))).run()
      }
    } catch (error) { onError(error) }
  }
  if (!editor) return <p role="status">{t("ui.preparing.editor")}</p>
  const remember = () => { const { from, to } = editor.state.selection; savedSelection.current = { from, to } }
  const chain = () => editor.chain().focus().setTextSelection(savedSelection.current)
  const button = (title: string, command: () => void, icon: ReactNode, pressed?: boolean) => <button type="button" title={localize(title)} aria-label={localize(title)} disabled={disabled} aria-pressed={pressed} onFocus={remember} onMouseDown={(event) => { event.preventDefault(); remember() }} onClick={() => { if (compact) moreMenu.current?.hidePopover(); command() }}>{icon}</button>
  return <section className="rich-field" aria-label={t('editor.visualEditor', { label })}>
    <h3>{localize(label)}</h3><div ref={toolbar} className="format-toolbar" role="toolbar" aria-label={t('editor.formatting', { label })}>
      <select aria-label={t('editor.textType', { label })} title={t("ui.text.type.fb3bd2")} disabled={disabled} value={active?.heading ?? 0} onFocus={remember} onPointerDown={remember} onChange={(event) => { const level = Number(event.target.value); if (level) chain().setHeading({ level: level as 1 | 2 | 3 }).run(); else chain().setParagraph().run() }}>
        <option value={0}>{t("ui.text")}</option><option value={1}>{t("ui.heading.1")}</option><option value={2}>{t("ui.heading.2")}</option><option value={3}>{t("ui.heading.3")}</option>
      </select>
      {button(message("ui.bold"), () => { chain().toggleBold().run() }, <Bold aria-hidden="true" />, active?.bold)}
      {button(message("ui.italic"), () => { chain().toggleItalic().run() }, <Italic aria-hidden="true" />, active?.italic)}
      {button(message("ui.underline"), () => { chain().toggleUnderline().run() }, <Underline aria-hidden="true" />, active?.underline)}
      {button(message("ui.bullet.list"), () => { chain().toggleBulletList().run() }, <List aria-hidden="true" />, active?.bullet)}
      {button(message("ui.numbered.list"), () => { chain().toggleOrderedList().run() }, <ListOrdered aria-hidden="true" />, active?.ordered)}
      {compact && <button type="button" aria-label={t("ui.more")} aria-expanded={moreOpen} aria-controls={moreId} title={t("ui.more.formatting")} popoverTarget={moreId} disabled={disabled} onFocus={remember} onMouseDown={(event) => { event.preventDefault(); remember(); event.currentTarget.focus({ preventScroll: true }) }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (moreMenu.current) { moreMenu.current.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px'; moreMenu.current.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 220)) + 'px' } }}><Ellipsis aria-hidden="true" /></button>}
      <div ref={moreMenu} id={moreId} onToggle={(event) => setMoreOpen(event.newState === 'open')} className={compact ? 'format-more' : 'format-secondary'} popover={compact ? 'auto' : undefined} role="group" aria-label={localize(message("ui.additional.formatting") + label)}>
        {button(message("ui.quote"), () => { chain().toggleBlockquote().run() }, <Quote aria-hidden="true" />, active?.quote)}
        {button(message("ui.link"), () => { setHref(editor.getAttributes('link').href ?? ''); setLinkOpen(true) }, <Link aria-hidden="true" />, active?.link)}
        {button(message("ui.insert.image"), () => fileInput.current?.click(), <ImagePlus aria-hidden="true" />)}
        {button(message("ui.insert.table"), () => { chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() }, <Table aria-hidden="true" />)}
      </div>
    </div>
    {linkOpen && <form className="link-entry" onSubmit={(event) => { event.preventDefault(); const safe = safeLink(href); if (!safe) { onError(new Error(message("ui.enter.a.safe.http.s.mailto.or.relative.link"))); return }; editor.chain().focus().setTextSelection(savedSelection.current).extendMarkRange('link').setLink({ href: safe }).run(); setLinkOpen(false) }}><input aria-label={localize(message("ui.link.address") + label)} value={href} onChange={(event) => setHref(event.target.value)} /><button type="submit" disabled={disabled}>{t("ui.apply.link")}</button><button type="button" disabled={disabled} onClick={() => { editor.chain().focus().setTextSelection(savedSelection.current).unsetLink().run(); setLinkOpen(false) }}>{t("ui.remove.link")}</button><button type="button" onClick={() => setLinkOpen(false)}>{t("ui.close")}</button></form>}
    <input ref={fileInput} type="file" className="file-input" accept="image/png,image/jpeg,image/webp" aria-label={localize(message("ui.image") + label)} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addImages(files) }} />
    <AssetsContext.Provider value={assets}><EditorContent editor={editor} /></AssetsContext.Provider>
  </section>
}
