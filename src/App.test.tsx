// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbProjectRepository } from './storage/indexedDbProjectRepository'
import { App } from './App'

beforeEach(() => {
  // jsdom does not implement the native modal API or focus trapping.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
})
afterEach(cleanup)

async function createInUi(name: string) {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Проекты' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Проекты' }))
  fireEvent.change(screen.getByLabelText('Название нового проекта'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
  await screen.findByLabelText('Общий контекст приключения')
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('Сохранено на устройстве'))
}

describe('Project UI', () => {
  it('creates, autosaves edits, restores after reload and opens another project', async () => {
    const factory = new IDBFactory()
    const repo = new IndexedDbProjectRepository(() => factory)
    const app = render(<App repository={repo} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await createInUi('Приключение')
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Новая история' } })
    fireEvent.change(screen.getByLabelText('Общий контекст приключения'), { target: { value: '# Заметки\nНайти башню' } })
    await waitFor(async () => expect((await repo.restore())?.contextMd).toBe('# Заметки\nНайти башню'))
    const first = (await repo.restore())!
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно проекта' }))
    await createInUi('Вторая история')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно проекта' }))
    fireEvent.click(screen.getByRole('button', { name: 'Проекты' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть проект «Новая история»' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await repo.restore())?.id).toBe(first.id)
    app.unmount()
    render(<App repository={new IndexedDbProjectRepository(() => factory)} />)
    await screen.findByText('Новая история')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Контекст' }))
    expect((screen.getByLabelText('Общий контекст приключения') as HTMLTextAreaElement).value).toBe('# Заметки\nНайти башню')
  })

  it('shows a write error without losing typed text or showing saved, then retries', async () => {
    const factory = new IDBFactory()
    const repo = new IndexedDbProjectRepository(() => factory)
    render(<App repository={repo} />)
    await createInUi('Проект')
    vi.spyOn(repo, 'save').mockRejectedValueOnce(new DOMException('Нет места', 'QuotaExceededError'))
    fireEvent.change(screen.getByLabelText('Общий контекст приключения'), { target: { value: 'Несохранённая заметка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('Ошибка сохранения'))
    expect(screen.queryByText('Сохранено на устройстве')).toBeNull()
    expect((screen.getByLabelText('Общий контекст приключения') as HTMLTextAreaElement).value).toBe('Несохранённая заметка')
    expect((await repo.restore())?.contextMd).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('Сохранено на устройстве'))
    expect((await repo.restore())?.contextMd).toBe('Несохранённая заметка')
  })
})
