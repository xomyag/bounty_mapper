import { en } from './en'
import { ru } from './ru'
import type { Language, MessageKey, MessageParams, Translation } from './types'
export { message } from './message'
export type { Language, MessageKey } from './types'

export const LANGUAGE_STORAGE_KEY = 'bounty-mapper:interface-language'
const dictionaries: Record<Language, Record<MessageKey, Translation>> = { en, ru }
const listeners = new Set<() => void>()
let language: Language = 'en'
let persistenceError: MessageKey | undefined
let snapshot: { language: Language; error: MessageKey | undefined } = { language, error: persistenceError }
export const getLanguageSnapshot = () => snapshot
export const getLanguage = () => language
export const getLanguageError = () => persistenceError
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function initializeLanguage(storage?: Pick<Storage, 'getItem'>) {
  persistenceError = undefined
  try {
    const selected = (storage ?? globalThis.localStorage)?.getItem(LANGUAGE_STORAGE_KEY)
    language = selected === 'ru' ? 'ru' : 'en'
  } catch { language = 'en' }
  if (typeof document !== 'undefined') document.documentElement.lang = language
  snapshot = { language, error: persistenceError }
  listeners.forEach((listener) => listener())
}

export function setLanguage(selected: Language, storage?: Pick<Storage, 'setItem'>) {
  language = selected
  persistenceError = undefined
  try { (storage ?? globalThis.localStorage)?.setItem(LANGUAGE_STORAGE_KEY, selected) }
  catch { persistenceError = 'language.persistenceError' }
  if (typeof document !== 'undefined') document.documentElement.lang = selected
  snapshot = { language, error: persistenceError }
  listeners.forEach((listener) => listener())
}

export function t(key: MessageKey, params: MessageParams = {}): string {
  const translation = dictionaries[language][key]
  if (translation === undefined) throw new Error(`Missing UI translation: ${key}`)
  const pattern = typeof translation === 'string' ? translation : translation[new Intl.PluralRules(language).select(Number(params.count))] ?? translation.other ?? ''
  return pattern.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Missing UI message parameter: ${key}.${name}`)
    return typeof value === 'string' ? localize(value) : String(value)
  })
}

export function localize<T>(value: T): T {
  if (typeof value !== 'string') return value
  return value.replace(/\uE000([^\uE001]*)\uE001/g, (original, payload: string) => {
    try {
      const [key, params] = JSON.parse(payload) as [MessageKey, MessageParams]
      return t(key, params)
    } catch { return original }
  }) as T
}
