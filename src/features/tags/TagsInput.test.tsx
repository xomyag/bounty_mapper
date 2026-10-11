// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TagsInput } from './TagsInput'

afterEach(cleanup)
it('adds suggested/new tags to the draft and consumes arrows/Enter/Escape locally', () => {
  const ancestorKey = vi.fn()
  function Card() {
    const [values, setValues] = useState<string[]>(['Север'])
    return <div onKeyDown={ancestorKey}><TagsInput values={values} catalog={['Ловушка', 'Север', 'Тайна']} onChange={setValues} disabled={false} /></div>
  }
  render(<Card />)
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  expect(screen.getAllByRole('option').map((node) => node.textContent)).toEqual(['Ловушка', 'Тайна'])
  fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('button', { name: 'Удалить тег «Ловушка»' })).toBeTruthy()
  fireEvent.change(input, { target: { value: ' ловУШКа ' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getAllByRole('button', { name: 'Удалить тег «Ловушка»' })).toHaveLength(1)
  fireEvent.change(input, { target: { value: ' Новый ' } }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('button', { name: 'Удалить тег «Новый»' })).toBeTruthy()
  fireEvent.keyDown(input, { key: 'ArrowUp' }); fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(ancestorKey).not.toHaveBeenCalled()
})
