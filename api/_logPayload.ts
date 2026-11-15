// Чистая (без Node/Vercel-типов) валидация тела клиентского лога.
// Файл начинается с `_`, поэтому Vercel НЕ деплоит его как функцию:
// https://vercel.com/docs/functions/configuring-functions/advanced-configuration
// Логика вынесена сюда, чтобы её можно было крыть юнит-тестами (tests/unit/logPayload.test.ts),
// а хендлер api/log.ts остался тонким.

export interface ClientErrorPayload {
  message: string
  stack?: string
  source?: string
  url?: string
  componentStack?: string
  ts?: number
}

export type ParseLogPayloadResult =
  | { ok: true; payload: ClientErrorPayload }
  | { ok: false; status: 400 | 413 }

/** Жёсткий лимит тела запроса, байт. */
export const MAX_BODY_BYTES = 8 * 1024
export const MAX_MESSAGE = 1000
export const MAX_STACK = 4000
export const MAX_SOURCE = 500
export const MAX_URL = 500
export const MAX_COMPONENT_STACK = 4000

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Парсит и нормализует JSON-строку тела запроса.
 * - битый JSON / не-объект / отсутствие или неверный тип `message` → { ok: false, status: 400 }
 * - тело длиннее MAX_BODY_BYTES (в символах строки; байтовый лимит дополнительно
 *   контролируется на чтении потока в api/log.ts) → { ok: false, status: 413 }
 * - неизвестные поля отбрасываются, известные строки обрезаются, `ts` принимается
 *   только конечным числом.
 */
export function parseLogPayload(body: string): ParseLogPayloadResult {
  if (typeof body !== 'string' || body.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413 }
  }

  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return { ok: false, status: 400 }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, status: 400 }
  }

  const raw = data as Record<string, unknown>
  if (typeof raw.message !== 'string' || raw.message.length === 0) {
    return { ok: false, status: 400 }
  }

  const payload: ClientErrorPayload = { message: clip(raw.message, MAX_MESSAGE) }
  if (typeof raw.stack === 'string' && raw.stack.length > 0) {
    payload.stack = clip(raw.stack, MAX_STACK)
  }
  if (typeof raw.source === 'string' && raw.source.length > 0) {
    payload.source = clip(raw.source, MAX_SOURCE)
  }
  if (typeof raw.url === 'string' && raw.url.length > 0) {
    payload.url = clip(raw.url, MAX_URL)
  }
  if (typeof raw.componentStack === 'string' && raw.componentStack.length > 0) {
    payload.componentStack = clip(raw.componentStack, MAX_COMPONENT_STACK)
  }
  if (typeof raw.ts === 'number' && Number.isFinite(raw.ts)) {
    payload.ts = raw.ts
  }

  return { ok: true, payload }
}
