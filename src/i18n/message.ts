import type { MessageKey, MessageParams } from './types'

// Deferred messages remain language-independent in transient state and errors.
// Only the presentation layer resolves them. Never persist them as project text.
export function message(key: MessageKey, params: MessageParams = {}): string {
  return '\uE000' + JSON.stringify([key, params]).replaceAll('\uE000', '\\uE000').replaceAll('\uE001', '\\uE001') + '\uE001'
}
