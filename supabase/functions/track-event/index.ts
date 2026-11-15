// Edge Function: приёмник funnel-событий (F12).
// Принимает { event_type, payload } от аутентифицированного клиента и пишет
// событие в public.funnel_events через service_role.
// user_id берётся только из проверенного JWT, никогда из тела запроса.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Белый список = enum funnel_event_type из миграции F12: чужое имя события не
// должно доходить до вставки (иначе получил бы ошибку на уровне БД).
const ALLOWED = new Set([
  'view_listing',
  'open_chat',
  'send_message',
  'create_listing',
  'complete_deal',
  'boost_listing',
])

// Разрешённые origin'ы: прод и превью-деплои вида
// https://skvot-<git-ref>-blindfoldstudios.vercel.app.
const PROD_ORIGIN = 'https://skvot.vercel.app'
const PREVIEW_ORIGIN_RE = /^https:\/\/skvot-[\w.-]+-blindfoldstudios\.vercel\.app$/
// Локальный Vite (5173) разрешаем только локальному запуску функции
// (`supabase functions serve` поднимает SUPABASE_URL на 127.0.0.1), чтобы
// боевая функция не отвечала чужому origin.
const LOCAL_ORIGIN = 'http://localhost:5173'

function isLocalDev(): boolean {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  return url.includes('://127.0.0.1') || url.includes('://localhost')
}

function isAllowedOrigin(origin: string | null): boolean {
  if (origin === null) return false
  if (origin === PROD_ORIGIN || PREVIEW_ORIGIN_RE.test(origin)) return true
  return isLocalDev() && origin === LOCAL_ORIGIN
}

// CORS-заголовки нужны на каждом ответе, включая ошибки: без них браузер не
// даёт странице прочитать тело, а preflight (OPTIONS) вообще блокирует запрос
// с сообщением «No 'Access-Control-Allow-Origin' header».
function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  if (origin === null || !allowed) return { vary: 'Origin' }
  return {
    vary: 'Origin',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors, ...extra },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const allowed = isAllowedOrigin(origin)
  const cors = corsHeaders(origin, allowed)

  // Preflight: разрешённый origin → 204 без тела, чужой → 403.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: allowed ? 204 : 403, headers: cors })
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method_not_allowed' }, cors, {
      allow: 'POST, OPTIONS',
    })
  }

  // Чужой браузерный origin отклоняем. Запросы без Origin (curl,
  // сервер-к-серверу, мониторинг) не считаем чужими.
  if (origin !== null && !allowed) {
    return jsonResponse(403, { ok: false, error: 'forbidden_origin' }, cors)
  }

  // Токен вытаскиваем из Authorization и валидируем именно его: админский
  // клиент сам по себе ничего не знает о пользователе.
  const authHeader = req.headers.get('authorization') ?? ''
  const [scheme, token] = authHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors)
  }

  // Единственный клиент — админский (service_role) и БЕЗ global.headers.
  // Раньше пользовательский Authorization подмешивался во все запросы клиента,
  // поэтому insert в funnel_events уходил с JWT пользователя, а не service_role:
  // при RLS на таблице вставка отклонялась и аналитика падала с 500.
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // getUser(token) проверяет присланный JWT (битый/чужой/просроченный → 401),
  // а не ключ клиента: роль service_role остаётся у самого клиента.
  const { data: userData, error: userError } = await adminClient.auth.getUser(token)
  if (userError || !userData.user) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors)
  }

  let body: { event_type?: unknown; payload?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { ok: false, error: 'invalid_json' }, cors)
  }

  const eventType = body.event_type
  if (typeof eventType !== 'string' || !ALLOWED.has(eventType)) {
    return jsonResponse(400, { ok: false, error: 'invalid_event_type' }, cors)
  }

  // user_id — из проверенного токена, так что клиент не может записать событие
  // на чужого пользователя.
  const { error } = await adminClient.from('funnel_events').insert({
    user_id: userData.user.id,
    event_type: eventType,
    payload: body.payload ?? null,
  })

  if (error) {
    return jsonResponse(500, { ok: false, error: error.message }, cors)
  }

  return jsonResponse(200, { ok: true }, cors)
})
