// Клиентский сбор ошибок в обход Sentry: шлём их на Vercel-функцию /api/log,
// где они попадают в Runtime Logs проекта (одной строкой '[client-error] ...').
//
// Ограничения на стороне клиента:
//  - одна и та же сигнатура (message + первые 200 символов stack) — не чаще раза за сессию;
//  - всего не более 20 отправок за сессию;
//  - не отправляем в dev (import.meta.env.DEV), при VITE_ERROR_REPORT=off,
//    когда браузер offline и на браузерный шум вида "ResizeObserver loop".

export interface ClientErrorPayload {
  message: string
  stack?: string
  source?: string
  url?: string
  componentStack?: string
  ts?: number
}

export interface ReportContext {
  componentStack?: string | null
  source?: string | null
}

const ENDPOINT = '/api/log'
const MAX_MESSAGE = 1000
const MAX_STACK = 4000
const MAX_SOURCE = 500
const MAX_COMPONENT_STACK = 4000
const MAX_SENDS_PER_SESSION = 20
const SIGNATURE_STACK_LEN = 200
// Browser-шум, который не является багом приложения
const IGNORED_MESSAGE_PATTERNS = ['ResizeObserver loop']

let sentCount = 0
let signatures = new Set<string>()
// Ошибки, уже отправленные напрямую (например, из ErrorBoundary), чтобы
// глобальный window-обработчик не отправил их второй раз.
let reportedErrorObjects = new WeakSet<object>()
let installed = false
let errorHandler: ((event: ErrorEvent) => void) | null = null
let rejectionHandler: ((event: Event) => void) | null = null

function flagOn(value: unknown): boolean {
  return value === true || value === 'true'
}

// Тестовый шов: vitest не даёт переопределить import.meta.env.DEV через vi.stubEnv
// (DEV/PROD — булевы константы, фиксированные при транформации Vite).
// Бандл это никогда не трогает: __resetClientErrorReporting вызывается только из тестов.
let devOverride: boolean | null = null

function isDev(): boolean {
  return devOverride ?? flagOn(import.meta.env.DEV)
}

function reportingDisabled(): boolean {
  const env = import.meta.env
  if (isDev()) return true
  if (env.VITE_ERROR_REPORT === 'off') return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return false
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function signatureOf(message: string, stack: string | undefined): string {
  return `${message}|${(stack ?? '').slice(0, SIGNATURE_STACK_LEN)}`
}

function describeReason(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object') {
    const candidate = reason as { message?: unknown; stack?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.length > 0) return candidate.message
    try {
      return JSON.stringify(reason) ?? String(reason)
    } catch {
      return String(reason)
    }
  }
  return String(reason)
}

function send(payload: ClientErrorPayload): void {
  let body: string
  try {
    body = JSON.stringify(payload)
  } catch {
    return
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(ENDPOINT, blob)) return
    }
  } catch {
    // sendBeacon бросил — уходим на fetch
  }
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // транспорта нет — тихо игнорируем
  }
}

/**
 * Отправляет ошибку в /api/log с учётом дедупликации и лимитов.
 * Экспортируется для ErrorBoundary: отправленный Error-объект помечается,
 * и глобальный обработчик window 'error' (React 19 дублирует в него ошибки
 * из границ) его повторно не отправит.
 */
export function reportClientError(error: Error | string, context?: ReportContext): void {
  try {
    if (reportingDisabled()) return

    const isErrorObject = typeof error === 'object' && error !== null
    const message =
      typeof error === 'string' ? error : String((error as Error).message ?? '')
    if (!message) return
    if (IGNORED_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) return
    if (isErrorObject && reportedErrorObjects.has(error as object)) return

    const stack =
      isErrorObject && typeof (error as Error).stack === 'string' ? (error as Error).stack : undefined
    const signature = signatureOf(message, stack)
    if (signatures.has(signature)) return
    if (sentCount >= MAX_SENDS_PER_SESSION) return

    signatures.add(signature)
    if (isErrorObject) reportedErrorObjects.add(error as object)
    sentCount++

    const payload: ClientErrorPayload = { message: clip(message, MAX_MESSAGE) }
    if (typeof location !== 'undefined') payload.url = location.pathname // без query-параметров
    payload.ts = Date.now()
    if (stack) payload.stack = clip(stack, MAX_STACK)
    const componentStack = context?.componentStack
    if (componentStack) payload.componentStack = clip(componentStack, MAX_COMPONENT_STACK)
    const source = context?.source
    if (source) payload.source = clip(source, MAX_SOURCE)

    send(payload)
  } catch {
    // репортёр никогда не должен бросать в приложение
  }
}

/**
 * Вешает глобальные обработчики window 'error' и 'unhandledrejection'.
 * Идемпотентна; вызывается из main.tsx до createRoot.
 */
export function installClientErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  errorHandler = (event: ErrorEvent) => {
    const source =
      typeof event.filename === 'string' && event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : null
    const target: Error | string | null = event.error instanceof Error ? event.error : event.message
    if (!target) return
    reportClientError(target, { source })
  }

  rejectionHandler = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason
    reportClientError(reason instanceof Error ? reason : describeReason(reason))
  }

  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectionHandler)
}

/**
 * Только для тестов: сбрасывает in-memory состояние и слушатели.
 * `dev` — переопределение флага import.meta.env.DEV (vitest его не стабит);
 * без него флаг читается из реального import.meta.env.
 */
export function __resetClientErrorReporting(options?: { dev?: boolean }): void {
  if (typeof window !== 'undefined') {
    if (errorHandler) window.removeEventListener('error', errorHandler)
    if (rejectionHandler) window.removeEventListener('unhandledrejection', rejectionHandler)
  }
  errorHandler = null
  rejectionHandler = null
  installed = false
  signatures = new Set<string>()
  reportedErrorObjects = new WeakSet<object>()
  sentCount = 0
  devOverride = options?.dev ?? null
}
