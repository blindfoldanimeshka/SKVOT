// Удаление аккаунта и всех связанных данных (право субъекта 152-ФЗ).
// Вызывается только аутентифицированным пользователем для своего аккаунта.
// Каскадное удаление public.users + listings + messages настроено на уровне БД.
import { createClient } from 'npm:@supabase/supabase-js@2'

// CORS для браузерного вызова с боевого фронта: preflight (OPTIONS) и все ответы.
const corsHeaders = {
  'access-control-allow-origin': 'https://skvot.vercel.app',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const jsonResponse = (
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...corsHeaders,
      ...extraHeaders,
    },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, { allow: 'POST, OPTIONS' })
  }

  // Вытаскиваем Bearer-токен из заголовка Authorization: валидируем именно его.
  const authHeader = req.headers.get('authorization') ?? ''
  const [scheme, token] = authHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Админ-клиент на service-role БЕЗ global-заголовков. В прошлой версии
  // пользовательский Authorization подмешивался во все запросы клиента,
  // включая auth.admin.deleteUser, и админский API отклонял вызов (400/401) —
  // аккаунт в итоге не удалялся, хотя getUser() выглядел «успешным».
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Проверяем присланный токен явно: getUser(token) валидирует этот JWT,
  // а не ключ клиента. Битый/чужой/просроченный токен → 401.
  const { data: userData, error: userError } = await adminClient.auth.getUser(token)
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Удаляем только того пользователя, чей токен прошёл проверку (152-ФЗ:
  // субъект удаляет только себя). user.id из тела запроса не читаем.
  const { error } = await adminClient.auth.admin.deleteUser(userData.user.id)

  if (error) {
    return jsonResponse({ error: error.message }, 400)
  }

  return jsonResponse({ ok: true }, 200)
})
