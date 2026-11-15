// Vercel Function (Node.js runtime) — приёмник клиентских ошибок.
//
//  - https://vercel.com/docs/functions/functions-api-reference#fetch-web-standard
//  - https://vercel.com/docs/functions/runtimes/node-js («Create a Node.js function in /api»)
//
// Почему переписали. На проде (рантайм `nodejs26.x`) сигнатура
// `export default async function handler(req: IncomingMessage, res: ServerResponse)`
// не получала тело: `@vercel/node` заранее парсит запрос по `Content-Type` и прячет
// результат в геттере `req.body`, а поток к этому моменту уже вычитан. Геттер бросает
// `Invalid JSON` на битом/пустом теле и на `text/plain` от `navigator.sendBeacon` —
// в результате ЛЮБОЙ POST отвечал 400. В fetch-контракте рантаймовых парсеров нет:
// тело читаем ровно один раз через `await request.text()`.
//
// ВАЖНО: валидация тела живёт в ЭТОМ ЖЕ файле, а не в отдельном модуле.
// Вынос в `./_logPayload` ломал прод: `@vercel/node` компилирует файлы в ESM и
// оставляет относительный импорт без расширения, а Node ESM такое не резолвит
// (`ERR_MODULE_NOT_FOUND: /var/task/api/_logPayload`). Держим одним файлом.
//
// Логируется ровно одна строка через console.error — её видно в Vercel Runtime Logs.

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

/** Методы, которые хендлер принимает: используется и в `Allow`, и в CORS-префлайте. */
const ALLOWED_METHODS = 'POST, OPTIONS'

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Парсит и нормализует JSON-строку тела запроса.
 * - битый JSON / не-объект / отсутствие или неверный тип `message` → { ok: false, status: 400 }
 * - тело длиннее MAX_BODY_BYTES → { ok: false, status: 413 }
 *   (байтовый лимит контролируется в хендлере по `Buffer.byteLength`)
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

const PROD_ORIGIN = 'https://skvot.vercel.app'
// Превью-деплои вида https://skvot-<git-ref>-blindfoldstudios.vercel.app
const PREVIEW_ORIGIN_RE = /^https:\/\/skvot-[\w.-]+-blindfoldstudios\.vercel\.app$/
// Локальный dev-сервер Vite — только вне продакшена
const LOCAL_ORIGIN = 'http://localhost:5173'

function isAllowedOrigin(origin: string): boolean {
  if (origin === PROD_ORIGIN || PREVIEW_ORIGIN_RE.test(origin)) return true
  return process.env.VERCEL_ENV !== 'production' && origin === LOCAL_ORIGIN
}

/** Ответ всегда с пустым телом: репортёру нужен только статус. */
function empty(status: number, headers: Record<string, string>): Response {
  return new Response(null, { status, headers })
}

/**
 * Node-рантайм (nodejs26.x). Тело читаем через `request.text()` в fetch-контракте,
 * потому что legacy `(req, res)` его не получает (`req.body` бросает `Invalid JSON`).
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const method = request.method.toUpperCase()
    const origin = request.headers.get('origin')
    const allowed = origin !== null && isAllowedOrigin(origin)

    // `Vary: Origin` отдаём всегда — ответ зависит от проверяемого заголовка.
    const headers: Record<string, string> = { Vary: 'Origin' }
    if (allowed && origin !== null) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS
      headers['Access-Control-Allow-Headers'] = 'content-type'
      headers['Access-Control-Max-Age'] = '86400'
    }

    try {
      // Preflight: разрешённый origin → 204, любой другой (или без Origin) → 403
      if (method === 'OPTIONS') {
        return empty(allowed ? 204 : 403, headers)
      }

      // Принимаем только POST
      if (method !== 'POST') {
        return empty(405, { ...headers, Allow: ALLOWED_METHODS })
      }

      // CORS для браузерных запросов: запросы без Origin (curl, сервер-к-серверу) пропускаем
      if (origin !== null && !allowed) {
        return empty(403, headers)
      }

      // Тело читаем один раз и целиком: `request.text()` — единственный способ,
      // который не зависит от рантаймовых парсеров @vercel/node.
      const raw = await request.text()
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        return empty(413, headers)
      }

      const parsed = parseLogPayload(raw)
      if (!parsed.ok) {
        // Временная диагностика: на проде тело приходило (contentLength=24), но
        // парсер отвечал 400 — нужно увидеть фактическое содержимое строки.
        console.error(
          '[client-error] reject',
          JSON.stringify({ status: parsed.status, len: raw.length, sample: JSON.stringify(raw.slice(0, 120)) }),
        )
        return empty(parsed.status, headers)
      }

      // Одна строка в Runtime Logs: [client-error] {payload}
      console.error('[client-error]', JSON.stringify(parsed.payload))
      return empty(204, headers)
    } catch {
      // Репортёр не должен уметь ронять функцию: битое/оборванное тело → обычный 400
      return empty(400, headers)
    }
  },
}
