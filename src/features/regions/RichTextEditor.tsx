import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react'
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
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive('bold'), italic: editor?.isActive('italic'), underline: editor?.isActive('underline'), bullet: editor?.isActive('bulletList'), ordered: editor?.isActive('orderedList'), quote: editor?.isActive('blockquote') }) })
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
  const button = (title: string, command: () => void, pressed?: boolean) => <button type="button" disabled={disabled} aria-pressed={pressed} onMouseDown={(event) => event.preventDefault()} onClick={command}>{title}</button>
  return <section className="rich-field" aria-label={label + ' — визуальный редактор'}>
    <h3>{label}</h3><div className="format-toolbar" role="toolbar" aria-label={'Форматирование: ' + label}>
      {button('Обычный текст', () => { editor.chain().focus().setParagraph().run() })}
      {[1, 2, 3].map((level) => <button key={level} type="button" disabled={disabled} aria-label={'Заголовок ' + level} onMouseDown={(e) => e.preventDefault()} onClick={() => { editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run() }}>H{level}</button>)}
      {button('Жирный', () => { editor.chain().focus().toggleBold().run() }, active?.bold)}
      {button('Курсив', () => { editor.chain().focus().toggleItalic().run() }, active?.italic)}
      {button('Подчёркнутый', () => { editor.chain().focus().toggleUnderline().run() }, active?.underline)}
      {button('Маркированный список', () => { editor.chain().focus().toggleBulletList().run() }, active?.bullet)}
      {button('Нумерованный список', () => { editor.chain().focus().toggleOrderedList().run() }, active?.ordered)}
      {button('Цитата', () => { editor.chain().focus().toggleBlockquote().run() }, active?.quote)}
      {button('Ссылка', () => { const { from, to } = editor.state.selection; savedSelection.current = { from, to }; setHref(editor.getAttributes('link').href ?? ''); setLinkOpen(true) })}
      {button('Вставить изображение', () => fileInput.current?.click())}
      {button('Вставить таблицу', () => { editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run() })}
    </div>
    {linkOpen && <form className="link-entry" onSubmit={(event) => { event.preventDefault(); const safe = safeLink(href); if (!safe) { onError(new Error('Укажите безопасную HTTP(S), mailto или относительную ссылку.')); return }; editor.chain().focus().setTextSelection(savedSelection.current).extendMarkRange('link').setLink({ href: safe }).run(); setLinkOpen(false) }}><input aria-label={'Адрес ссылки: ' + label} value={href} onChange={(event) => setHref(event.target.value)} /><button type="submit" disabled={disabled}>Применить ссылку</button><button type="button" disabled={disabled} onClick={() => { editor.chain().focus().setTextSelection(savedSelection.current).unsetLink().run(); setLinkOpen(false) }}>Удалить ссылку</button><button type="button" onClick={() => setLinkOpen(false)}>Закрыть</button></form>}
    <input ref={fileInput} type="file" className="file-input" accept="image/png,image/jpeg,image/webp" aria-label={'Изображение: ' + label} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addImages(files) }} />
    <AssetsContext.Provider value={assets}><EditorContent editor={editor} /></AssetsContext.Provider>
  </section>
}
