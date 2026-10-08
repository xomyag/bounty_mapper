import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const swatches = [
  ['Золотой', '#d7ad62'], ['Красный', '#ef6543'], ['Оранжевый', '#eaa746'], ['Жёлтый', '#f2d35e'],
  ['Зелёный', '#22aa77'], ['Бирюзовый', '#36b8bd'], ['Синий', '#4a90e2'], ['Фиолетовый', '#9b6bd3'],
  ['Розовый', '#df7ba5'], ['Коричневый', '#966b4b'], ['Белый', '#ffffff'], ['Чёрный', '#000000'],
]
const channels = ['Красный', 'Зелёный', 'Синий']
function palettePosition(trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect()
  const top = rect.bottom + 286 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - 286)
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
    top,
    maxHeight: Math.max(0, window.innerHeight - top - 8),
  }
}

export function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (color: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 0 })
  const [hex, setHex] = useState(value)
  const trigger = useRef<HTMLButtonElement>(null)
  const palette = useRef<HTMLDivElement>(null)
  const id = useId()
  const rgb = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
  const choose = (color: string) => { setHex(color); onChange(color) }

  useEffect(() => {
    if (!open) return
    palette.current?.querySelector('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !palette.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    const reposition = () => { if (trigger.current) setPosition(palettePosition(trigger.current)) }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  return <div className="region-color-picker">
    <span>Цвет</span>
    <button ref={trigger} className="color-trigger" type="button" aria-label="Цвет области" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => { setPosition(palettePosition(trigger.current!)); setOpen((current) => !current) }}>
      <span style={{ backgroundColor: value }} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={palette} id={id} className="color-palette" role="dialog" aria-label="Палитра цвета области" style={position}>
      <strong>Цвет области</strong>
      <div className="color-swatches" role="group" aria-label="Готовые цвета">
        {swatches.map(([name, color]) => <button key={color} type="button" aria-label={`${name} (${color})`} title={`${name} (${color})`} aria-pressed={value.toLowerCase() === color} disabled={disabled} style={{ backgroundColor: color }} onClick={() => choose(color)} />)}
      </div>
      <label>HEX<input aria-label="HEX цвета" value={hex} maxLength={7} spellCheck={false} disabled={disabled} onChange={(event) => {
        const next = event.target.value
        setHex(next)
        if (/^#[a-f0-9]{6}$/i.test(next)) onChange(next.toLowerCase())
      }} onBlur={() => { if (!/^#[a-f0-9]{6}$/i.test(hex)) setHex(value) }} /></label>
      {channels.map((name, index) => <label className="color-channel" key={name}><span>{name}: {rgb[index]}</span><input type="range" aria-label={`${name} канал`} min="0" max="255" value={rgb[index]} disabled={disabled} onChange={(event) => {
        const next = rgb.map((channel, i) => i === index ? Number(event.target.value) : channel)
        choose(`#${next.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`)
      }} /></label>)}
    </div>, document.body)}
  </div>
}
