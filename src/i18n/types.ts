import type { en } from './en'
export type Language = 'en' | 'ru'
export type MessageKey = keyof typeof en
export type Translation = string | Partial<Record<Intl.LDMLPluralRule, string>>
export type MessageParams = Record<string, string | number>
