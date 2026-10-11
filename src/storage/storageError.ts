/** Preserve application errors (including RevisionConflictError) and explain DOM failures. */
export function storageError(error: unknown): unknown {
  if (!(error instanceof DOMException)) return error
  const explanation: Record<string, string> = {
    QuotaExceededError: 'Недостаточно места в локальном хранилище. Освободите место и повторите запись; сохранённые данные не изменены.',
    VersionError: 'Версия локальной базы новее этого приложения. Откройте актуальную версию; база не очищена.',
    SecurityError: 'Браузер запретил локальное хранилище. Проверьте разрешения для этого адреса.',
    NotAllowedError: 'Браузер не разрешил доступ к локальному хранилищу. Проверьте разрешения для этого адреса.',
    AbortError: 'Операция локального хранилища отменена. Запись не подтверждена; повторите попытку.',
    UnknownError: 'Локальное хранилище временно недоступно. Повторите попытку; не очищайте данные браузера.',
  }
  return explanation[error.name] ? new Error(`${explanation[error.name]} ${error.message}`, { cause: error }) : error
}
