// Vercel Serverless Function (Node.js) — приёмник клиентских ошибок.
//
// По актуальной документации Vercel:
//  - в zero-config проекте (наш кейс: framework "vite") файл `api/**/*.ts`
//    автоматически собирается билдером `@vercel/node` — верcel.json не нужен;
//  - функция без доп. конфигурации по умолчанию исполняется на Node.js-рантайме,
//    поэтому `export const config = { runtime: 'nodejs' }` не требуется;
//    https://vercel.com/docs/functions/configuring-functions/runtime
//  - классическая сигнатура `(req, res)` с default-экспортом поддерживается.
//
// Ограничения/валидация тела — в ./_logPayload (файл с `_` не деплоится как функция).
// Логируется ровно одна строка через console.error — её видно в Vercel Runtime Logs.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseLogPayload, MAX_BODY_BYTES } from './_logPayload'

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
