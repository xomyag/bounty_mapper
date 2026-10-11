import { localize } from './i18n'

// Assert the displayed explanation while production errors retain deferred keys.
export function localizedFailure<T>(value: T): T {
  const fail = (error: unknown): never => {
    if (error instanceof Error) Object.defineProperty(error, 'message', { value: localize(error.message), configurable: true })
    throw error
  }
  if (typeof value === 'function') return (() => { try { return value() } catch (error) { return fail(error) } }) as T
  if (value instanceof Promise) return value.catch(fail) as T
  return value
}
