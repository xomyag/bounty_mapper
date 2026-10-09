import { useState } from 'react'
import type { Region } from '../../domain/region'
import type { RegionSession, RegionState } from '../../application/regionSession'
import { ColorPicker } from './ColorPicker'

export function RegionTools({ region, state, session, disabled }: { region: Region; state: RegionState; session: RegionSession; disabled: boolean }) {
  const [number, setNumber] = useState(String(region.number))
  const [title, setTitle] = useState(region.title)
  const [color, setColor] = useState(region.color)
  const [opacity, setOpacity] = useState(Math.round(region.fillOpacity * 100))
  const dirty = Number(number) !== region.number || title !== region.title || color !== region.color || opacity / 100 !== region.fillOpacity
  return <section className="region-tools" aria-label="Свойства области">
    <div className="region-tools-heading"><strong>Область {region.number}</strong><button type="button" disabled={disabled} aria-label="Снять выделение области" onClick={() => session.select()}>×</button></div>
    <form onSubmit={(event) => { event.preventDefault(); void session.change({ ...region, number: Number(number), title: title.trim(), color, fillOpacity: opacity / 100 }) }}>
      <fieldset disabled={disabled}>
        <label>Номер<input aria-label="Номер области" type="number" min="1" step="1" required value={number} onChange={(event) => setNumber(event.target.value)} /></label>
        <label>Название<input aria-label="Название области" required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="region-appearance"><ColorPicker value={color} onChange={setColor} disabled={disabled} /><label>Заливка: {opacity}%<input aria-label="Непрозрачность заливки" type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label></div>
        <button type="submit">Применить</button>
        {dirty && <p className="form-hint" role="status">Свойства ещё не применены.</p>}
      </fieldset>
    </form>
    <button type="button" disabled={disabled} aria-pressed={state.vertexMode} onClick={() => session.setVertexMode(!state.vertexMode)}>{state.vertexMode ? 'Закончить правку вершин' : 'Редактировать вершины'}</button>
    {state.vertexMode && <button type="button" disabled={disabled || state.selectedVertex === undefined || region.vertices.length <= 3} onClick={() => { void session.removeVertex() }}>Удалить вершину</button>}
    <button type="button" disabled={disabled} onClick={() => { void session.remove() }}>Удалить область</button>
  </section>
}
