import { describe, expect, it, vi } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import { getLanguage, getLanguageError, initializeLanguage, LANGUAGE_STORAGE_KEY, localize, message, setLanguage, t } from './index'

describe('Interface localization', () => {
  it('has identical keys and interpolation parameters in both dictionaries', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const values = (entry: unknown): string[] => typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, string>)
      const parameters = (entry: unknown) => [...new Set(values(entry).flatMap((text) => text.match(/\{\w+\}/g) ?? []))].sort()
      expect(parameters(ru[key]), key).toEqual(parameters(en[key]))
      expect(values(en[key]).every((value) => !/[А-Яа-яЁё]/.test(value)), key).toBe(true)
    }
  })
  it('defaults to English, restores a valid choice and handles unavailable storage', () => {
    initializeLanguage({ getItem: () => null })
    expect(getLanguage()).toBe('en')
    const saved = new Map<string, string>()
    setLanguage('ru', { setItem: (key, value) => { saved.set(key, value) } })
    expect(saved.get(LANGUAGE_STORAGE_KEY)).toBe('ru')
    initializeLanguage({ getItem: (key) => saved.get(key) ?? null })
    expect(getLanguage()).toBe('ru')
    initializeLanguage({ getItem: () => 'unknown' })
    expect(getLanguage()).toBe('en')
    setLanguage('ru', { setItem: () => { throw new Error('Blocked') } })
    expect(getLanguage()).toBe('ru')
    expect(getLanguageError()).toBe('language.persistenceError')
    setLanguage('ru', { setItem: vi.fn() })
    expect(getLanguageError()).toBeUndefined()
  })
  it('translates pending nested explanations without altering plain user text', () => {
    const original = 'Проекты — Сохранить — Карта 1 — English'
    const pending = message('errors.imageWrite', { detail: message('ui.project.not.found') })
    setLanguage('en', { setItem: () => {} })
    expect(localize(pending)).toBe('Could not save the image to storage. Project not found.')
    expect(localize(original)).toBe(original)
    setLanguage('ru', { setItem: () => {} })
    expect(localize(pending)).toBe('Ошибка записи изображения в хранилище. Проект не найден.')
    expect(t('project.deleteConfirm', { name: original })).toBe(`Удалить проект «${original}»?`)
  })
  it('selects English and Russian plural forms for visible counters', () => {
    setLanguage('en', { setItem: () => {} })
    expect([1, 2, 5].map((count) => t('counts.results', { count }))).toEqual(['1 result', '2 results', '5 results'])
    setLanguage('ru', { setItem: () => {} })
    expect([1, 2, 5, 21].map((count) => t('counts.vertices', { count }))).toEqual(['1 вершина', '2 вершины', '5 вершин', '21 вершина'])
  })
})
