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

const AssetsContext = createContext<Record<string, Asset>>({})
function ImageNode({ node, deleteNode, editor }: NodeViewProps) {
  const assets = useContext(AssetsContext)
  return <NodeViewWrapper className="text-image" contentEditable={false}><AssetImage asset={assets[node.attrs.assetId]} alt={node.attrs.alt} />{editor.isEditable && <button type="button" aria-label="Удалить изображение из текста" onClick={deleteNode}>Удалить изображение</button>}</NodeViewWrapper>
}
const AssetNode = Image.extend({
  addAttributes() { return { assetId: { default: null, parseHTML: (element) => element.getAttribute('data-asset-id') }, alt: { default: '' } } },
  parseHTML() { return [{ tag: 'img[data-asset-id]' }] },
  renderHTML({ node }) { return ['img', { 'data-asset-id': node.attrs.assetId, alt: node.attrs.alt }] },
  addNodeView() { return ReactNodeViewRenderer(ImageNode) },
})
const extensions = [StarterKit.configure({ link: { openOnClick: false, isAllowedUri: (url) => !!safeLink(url) } }), TableKit.configure({ table: { resizable: false } }), AssetNode]

export function RichTextEditor({ label, value, assets, disabled, onChange, insertImage, onError }: { label: string; value: RichDocument; assets: Record<string, Asset>; disabled: boolean; onChange: (document: RichDocument) => void; insertImage: (file: Blob) => Promise<Asset>; onError: (error: unknown) => void }) {
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
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true' },
      transformPastedHTML: (html) => cleanPastedHtml(html, new Set(Object.keys(assets))),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
        if (files.length) { void addImages(files); return true }
        if ((event.clipboardData?.getData('text/html').length ?? 0) > 1048576 || (event.clipboardData?.getData('text/plain').length ?? 0) > 262144) { onError(new Error('Вставляемый текст превышает допустимый размер.')); return true }
        return false
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichDocument),
  })
  // Locking during a write is UI state, not a document edit. Otherwise Tiptap's
  // update event replaces the error/draft version with an unchanged document.
  useEffect(() => { const observer = new ResizeObserver(() => { if (toolbar.current) setCompact(toolbar.current.clientWidth < 510) }); if (toolbar.current) observer.observe(toolbar.current); return () => observer.disconnect() }, [editor])
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive('bold'), italic: editor?.isActive('italic'), underline: editor?.isActive('underline'), bullet: editor?.isActive('bulletList'), ordered: editor?.isActive('orderedList'), quote: editor?.isActive('blockquote'), heading: editor?.isActive('heading') ? editor.getAttributes('heading').level as number : 0, link: editor?.isActive('link') }) })
  async function addImages(files: Blob[]) {
    if (!editor || disabled) return
    const bookmark = editor.state.selection.getBookmark()
    try {
      const inserted: Asset[] = []
      for (const file of files) inserted.push(await insertImage(file))
      if (!editor.isDestroyed) {
        const selection = bookmark.resolve(editor.state.doc)
        editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).insertContent(inserted.map((a) => ({ type: 'image', attrs: { assetId: a.id, alt: 'Изображение в тексте' } }))).run()
      }
    } catch (error) { onError(error) }
  }
  if (!editor) return <p role="status">Подготовка редактора…</p>
  const remember = () => { const { from, to } = editor.state.selection; savedSelection.current = { from, to } }
  const chain = () => editor.chain().focus().setTextSelection(savedSelection.current)
  const button = (title: string, command: () => void, icon: ReactNode, pressed?: boolean) => <button type="button" title={title} aria-label={title} disabled={disabled} aria-pressed={pressed} onFocus={remember} onMouseDown={(event) => { event.preventDefault(); remember() }} onClick={() => { if (compact) moreMenu.current?.hidePopover(); command() }}>{icon}</button>
  return <section className="rich-field" aria-label={label + ' — визуальный редактор'}>
    <h3>{label}</h3><div ref={toolbar} className="format-toolbar" role="toolbar" aria-label={'Форматирование: ' + label}>
      <select aria-label={'Тип текста: ' + label} title="Тип текста" disabled={disabled} value={active?.heading ?? 0} onFocus={remember} onPointerDown={remember} onChange={(event) => { const level = Number(event.target.value); if (level) chain().setHeading({ level: level as 1 | 2 | 3 }).run(); else chain().setParagraph().run() }}>
        <option value={0}>Текст</option><option value={1}>Заголовок 1</option><option value={2}>Заголовок 2</option><option value={3}>Заголовок 3</option>
      </select>
      {button('Жирный', () => { chain().toggleBold().run() }, <Bold aria-hidden="true" />, active?.bold)}
      {button('Курсив', () => { chain().toggleItalic().run() }, <Italic aria-hidden="true" />, active?.italic)}
      {button('Подчёркнутый', () => { chain().toggleUnderline().run() }, <Underline aria-hidden="true" />, active?.underline)}
      {button('Маркированный список', () => { chain().toggleBulletList().run() }, <List aria-hidden="true" />, active?.bullet)}
      {button('Нумерованный список', () => { chain().toggleOrderedList().run() }, <ListOrdered aria-hidden="true" />, active?.ordered)}
      {compact && <button type="button" aria-label="Ещё" aria-expanded={moreOpen} aria-controls={moreId} title="Ещё форматирование" popoverTarget={moreId} disabled={disabled} onFocus={remember} onMouseDown={(event) => { event.preventDefault(); remember(); event.currentTarget.focus({ preventScroll: true }) }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (moreMenu.current) { moreMenu.current.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 220)) + 'px'; moreMenu.current.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 220)) + 'px' } }}><Ellipsis aria-hidden="true" /></button>}
      <div ref={moreMenu} id={moreId} onToggle={(event) => setMoreOpen(event.newState === 'open')} className={compact ? 'format-more' : 'format-secondary'} popover={compact ? 'auto' : undefined} role="group" aria-label={'Дополнительное форматирование: ' + label}>
        {button('Цитата', () => { chain().toggleBlockquote().run() }, <Quote aria-hidden="true" />, active?.quote)}
        {button('Ссылка', () => { setHref(editor.getAttributes('link').href ?? ''); setLinkOpen(true) }, <Link aria-hidden="true" />, active?.link)}
        {button('Вставить изображение', () => fileInput.current?.click(), <ImagePlus aria-hidden="true" />)}
        {button('Вставить таблицу', () => { chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() }, <Table aria-hidden="true" />)}
      </div>
    </div>
    {linkOpen && <form className="link-entry" onSubmit={(event) => { event.preventDefault(); const safe = safeLink(href); if (!safe) { onError(new Error('Укажите безопасную HTTP(S), mailto или относительную ссылку.')); return }; editor.chain().focus().setTextSelection(savedSelection.current).extendMarkRange('link').setLink({ href: safe }).run(); setLinkOpen(false) }}><input aria-label={'Адрес ссылки: ' + label} value={href} onChange={(event) => setHref(event.target.value)} /><button type="submit" disabled={disabled}>Применить ссылку</button><button type="button" disabled={disabled} onClick={() => { editor.chain().focus().setTextSelection(savedSelection.current).unsetLink().run(); setLinkOpen(false) }}>Удалить ссылку</button><button type="button" onClick={() => setLinkOpen(false)}>Закрыть</button></form>}
    <input ref={fileInput} type="file" className="file-input" accept="image/png,image/jpeg,image/webp" aria-label={'Изображение: ' + label} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addImages(files) }} />
    <AssetsContext.Provider value={assets}><EditorContent editor={editor} /></AssetsContext.Provider>
  </section>
}
