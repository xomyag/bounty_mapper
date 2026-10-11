import { message } from '../i18n/message'
/** Preserve application errors (including RevisionConflictError) and explain DOM failures. */
export function storageError(error: unknown): unknown {
  if (!(error instanceof DOMException)) return error
  const explanation: Record<string, string> = {
    QuotaExceededError: message("ui.not.enough.local.storage.space.free.some.space.and"),
    VersionError: message("ui.the.local.database.is.newer.than.this.application.open"),
    SecurityError: message("ui.the.browser.blocked.local.storage.check.permissions.for.this"),
    NotAllowedError: message("ui.the.browser.did.not.allow.local.storage.access.check"),
    AbortError: message("ui.the.local.storage.operation.was.cancelled.the.write.is"),
    UnknownError: message("ui.local.storage.is.temporarily.unavailable.try.again.do.not"),
  }
  return explanation[error.name] ? new Error(`${explanation[error.name]} ${error.message}`, { cause: error }) : error
}
