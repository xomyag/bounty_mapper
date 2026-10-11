import { useId, useState } from 'react'
import { canonicalTags, suggestTags, tagKey } from '../../domain/tags'

export function TagsInput({ values, catalog, onChange, disabled }: { values: string[]; catalog: string[]; onChange: (tags: string[]) => void; disabled: boolean }) {
  const id = useId()
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const suggestions = suggestTags(catalog, values, input)
  const expanded = open && !!suggestions.length && !disabled
  const add = (value: string) => {
    if (!value.trim() || values.length >= 256) return
    onChange(canonicalTags([...values, value], catalog))
    setInput(''); setActive(-1); setOpen(true)
  }
  return <div className="tags-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <ul className="region-tags">{values.map((value) => <li key={value}><span>{value}</span><button type="button" disabled={disabled} aria-label={`Удалить тег «${value}»`} onClick={() => onChange(values.filter((tag) => tag !== value))}>×</button></li>)}</ul>
    <form className="tag-entry" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); add(expanded && active >= 0 ? suggestions[active] : input) }}>
      <input aria-label="Новый тег" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined} value={input} maxLength={120} disabled={disabled}
        onFocus={() => setOpen(true)} onChange={(event) => { setInput(event.target.value); setActive(-1); setOpen(true) }} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1) }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true); if (suggestions.length) setActive((current) => event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current < 0 ? suggestions.length - 1 : (current + suggestions.length - 1) % suggestions.length)) }
          else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); add(expanded && active >= 0 ? suggestions[active] : input) }
        }} />
      <button type="submit" disabled={disabled || !input.trim() || values.some((tag) => tagKey(tag) === tagKey(input)) || values.length >= 256}>Добавить тег</button>
    </form>
    {expanded && <ul className="tag-suggestions" id={id} role="listbox" aria-label="Подсказки тегов">{suggestions.map((tag, index) => <li key={tag} role="none"><button type="button" role="option" id={`${id}-${index}`} aria-selected={active === index} onPointerDown={(event) => event.preventDefault()} onClick={() => add(tag)}>{tag}</button></li>)}</ul>}
  </div>
}
