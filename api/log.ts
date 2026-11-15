// Vercel Serverless Function (Node.js) — приёмник клиентских ошибок.
//
// По актуальной документации Vercel:
//  - в zero-config проекте (наш кейс: framework "vite") файл `api/**/*.ts`
//    автоматически собирается билдером `@vercel/node` — vercel.json не нужен;
//  - функция без доп. конфигурации по умолчанию исполняется на Node.js-рантайме,
//    поэтому `export const config = { runtime: 'nodejs' }` не требуется;
//    https://vercel.com/docs/functions/configuring-functions/runtime
//  - классическая сигнатура `(req, res)` с default-экспортом поддерживается.
//
// ВАЖНО: валидация тела живёт в ЭТОМ ЖЕ файле, а не в отдельном модуле.
// Вынос в `./_logPayload` ломал прод: `@vercel/node` компилирует файлы в ESM и
// оставляет относительный импорт без расширения, а Node ESM такое не резолвит
// (`ERR_MODULE_NOT_FOUND: /var/task/api/_logPayload`). Держим одним файлом.
//
// Логируется ровно одна строка через console.error — её видно в Vercel Runtime Logs.

import type { IncomingMessage, ServerResponse } from 'node:http'

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
 * - тело длиннее MAX_BODY_BYTES → { ok: false, status: 413 }
 *   (байтовый лимит дополнительно контролируется на чтении потока)
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

/** Читает тело с лимитом по байтам; null — если лимит превышен. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer)
    size += buf.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function finish(res: ServerResponse, status: number, headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.statusCode = status
  res.end() // тело всегда пустое — не отдаём ничего сверх статуса
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET'
  const originHeader = req.headers.origin
  const origin = typeof originHeader === 'string' ? originHeader : null

  const corsHeaders: Record<string, string> = { Vary: 'Origin' }
  if (origin !== null && isAllowedOrigin(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin
    corsHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    corsHeaders['Access-Control-Allow-Headers'] = 'content-type'
    corsHeaders['Access-Control-Max-Age'] = '86400'
  }
  const allowed = origin !== null && isAllowedOrigin(origin)

  try {
    // Preflight: разрешённый origin → 204, любой другой (или без Origin) → 403
    if (method === 'OPTIONS') {
      finish(res, allowed ? 204 : 403, corsHeaders)
      return
    }

    // Принимаем только POST
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS')
      finish(res, 405, corsHeaders)
      return
    }

    // CORS для браузерных запросов: запросы без Origin (curl, сервер-к-серверу) пропускаем
    if (origin !== null && !allowed) {
      finish(res, 403, corsHeaders)
      return
    }

    let raw: string | null
    try {
      raw = await readBody(req)
    } catch {
      finish(res, 400, corsHeaders)
      return
    }
    if (raw === null) {
      finish(res, 413, corsHeaders)
      return
    }

    const parsed = parseLogPayload(raw)
    if (!parsed.ok) {
      finish(res, parsed.status, corsHeaders)
      return
    }

    // Одна строка в Runtime Logs: [client-error] {payload}
    console.error('[client-error]', JSON.stringify(parsed.payload))
    finish(res, 204, corsHeaders)
  } catch {
    // Репортёр не должен уметь ронять функцию
    finish(res, 400, corsHeaders)
  }
}
