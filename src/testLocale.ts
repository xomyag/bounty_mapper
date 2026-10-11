import { beforeEach } from 'vitest'
import { setLanguage } from './i18n'

// Existing Russian fixtures also exercise the supported Russian interface.
beforeEach(() => { setLanguage('ru', { setItem: () => {} }) })
