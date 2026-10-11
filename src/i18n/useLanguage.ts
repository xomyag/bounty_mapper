import { useSyncExternalStore } from 'react'
import { getLanguageSnapshot, subscribeLanguage } from './index'
import type { Language, MessageKey } from './types'
const serverSnapshot = { language: 'en' as Language, error: undefined as MessageKey | undefined }

export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, () => serverSnapshot).language
}
