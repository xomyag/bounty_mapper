// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbProjectRepository } from './storage/indexedDbProjectRepository'
import { IndexedDbInformationRepository } from './storage/indexedDbInformationRepository'
import { IndexedDbMapImageRepository } from './storage/indexedDbMapImageRepository'
import { documentText } from './domain/richText'
import { App } from './App'

vi.mock('./features/map/MapCanvas', () => ({ MapCanvas: () => <div>Canvas</div> }))
vi.mock('./features/regions/RichTextEditor', async () => {
  const { legacyContextDocument } = await import('./storage/migrateProjectContext')
  const { documentText } = await import('./domain/richText')
  return { RichTextEditor: ({ label, value, onChange }: { label: string; value: Parameters<typeof documentText>[0]; onChange: (v: ReturnType<typeof legacyContextDocument>) => void }) => <textarea aria-label={label} value={documentText(value)} onChange={(event) => onChange(legacyContextDocument(event.target.value))} /> }
})
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('indexedDB', new IDBFactory())
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLElement.prototype.hidePopover = function () {}
})
afterEach(cleanup)
const projects = () => screen.getByRole('menuitem', { name: 'Проекты', hidden: true })
const card = () => screen.getByRole('region', { name: 'Контекст приключения' })
async function createInUi(name: string) {
  await waitFor(() => expect((projects() as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(projects())
  fireEvent.change(screen.getByLabelText('Название нового проекта'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
  await screen.findByLabelText('Общий контекст приключения')
}
describe('Project information UI', () => {
  it('stages creation, explicitly saves, reopens and restores context in the single panel', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectRepository(() => factory)
    const props = { repository: repo, mapRepository: new IndexedDbMapImageRepository(() => factory), informationRepository: new IndexedDbInformationRepository(() => factory) }
    const app = render(<App {...props} />)
    await createInUi('Приключение')
    expect(await repo.list()).toEqual([])
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Новая история' } })
    fireEvent.change(screen.getByLabelText('Общий контекст приключения'), { target: { value: '# Заметки\nНайти башню' } })
    fireEvent.click(within(card()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect(documentText((await repo.restore())!.context)).toContain('Найти башню'))
    const first = (await repo.restore())!
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть контекст приключения' }))
    await createInUi('Вторая история')
    fireEvent.click(within(card()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect((await repo.list()).length).toBe(2))
    await waitFor(() => expect((projects() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(projects())
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть проект «Новая история»' }))
    await waitFor(async () => expect((await repo.restore())?.id).toBe(first.id))
    app.unmount(); render(<App {...props} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Контекст приключения' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Контекст приключения' }))
    await waitFor(() => expect(card().textContent).toContain('Найти башню'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Общий контекст приключения')).toBeNull()
  })
  it('keeps a failed creation draft and retries without a partial project', async () => {
    const factory = new IDBFactory(); const repo = new IndexedDbProjectRepository(() => factory)
    const information = new IndexedDbInformationRepository(() => factory)
    render(<App repository={repo} mapRepository={new IndexedDbMapImageRepository(() => factory)} informationRepository={information} />)
    await createInUi('Проект')
    vi.spyOn(information, 'create').mockRejectedValueOnce(new DOMException('Нет места', 'QuotaExceededError'))
    fireEvent.change(screen.getByLabelText('Общий контекст приключения'), { target: { value: 'Несохранённая заметка' } })
    fireEvent.click(within(card()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(within(card()).getByRole('status').textContent).toBe('Ошибка сохранения'))
    expect((screen.getByLabelText('Общий контекст приключения') as HTMLTextAreaElement).value).toBe('Несохранённая заметка')
    expect(await repo.list()).toEqual([])
    fireEvent.click(within(card()).getByRole('button', { name: 'Сохранить' }))
    await waitFor(async () => expect(documentText((await repo.restore())!.context)).toBe('Несохранённая заметка'))
  })
})
