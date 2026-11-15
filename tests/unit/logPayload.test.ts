// Тесты приёмника клиентских ошибок: валидатор parseLogPayload + fetch-хендлер api/log.ts.
//
// Хендлер вызывается по Web Standard контракту (export default { fetch(request) }),
// поэтому моки `IncomingMessage`/`ServerResponse` и типы `node:http` здесь не нужны:
// используем нативные Request/Response из окружения Node (vitest jsdom их не перекрывает).
import { describe, expect, it, vi } from 'vitest'
import handler, {
  MAX_BODY_BYTES,
  MAX_COMPONENT_STACK,
  MAX_MESSAGE,
  MAX_SOURCE,
  MAX_STACK,
  MAX_URL,
  parseLogPayload,
  type ClientErrorPayload,
} from '../../api/log'

function okPayload(body: string): ClientErrorPayload {
  const result = parseLogPayload(body)
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.status}`)
  }
  return result.payload
}

describe('parseLogPayload (api/log.ts)', () => {
  it('принимает минимальное валидное тело', () => {
    expect(parseLogPayload(JSON.stringify({ message: 'boom' }))).toEqual({
      ok: true,
      payload: { message: 'boom' },
    })
  })

  it('сохраняет все известные поля', () => {
    const body = JSON.stringify({
      message: 'm',
      stack: 's',
      source: 'app.js:1:2',
      url: '/profile',
      componentStack: '\n  in Foo',
      ts: 123,
    })
    expect(parseLogPayload(body)).toEqual({
      ok: true,
      payload: {
        message: 'm',
        stack: 's',
        source: 'app.js:1:2',
        url: '/profile',
        componentStack: '\n  in Foo',
        ts: 123,
      },
    })
  })

  it('обрезает message до MAX_MESSAGE', () => {
    const payload = okPayload(JSON.stringify({ message: 'm'.repeat(MAX_MESSAGE + 500) }))
    expect(payload.message).toHaveLength(MAX_MESSAGE)
  })

  it('обрезает stack до MAX_STACK', () => {
    const payload = okPayload(JSON.stringify({ message: 'm', stack: 's'.repeat(MAX_STACK + 500) }))
    expect(payload.stack).toHaveLength(MAX_STACK)
  })

  it('обрезает componentStack до MAX_COMPONENT_STACK', () => {
    const payload = okPayload(
      JSON.stringify({ message: 'm', componentStack: 'c'.repeat(MAX_COMPONENT_STACK + 500) }),
    )
    expect(payload.componentStack).toHaveLength(MAX_COMPONENT_STACK)
  })

  it('обрезает source и url', () => {
    const payload = okPayload(
      JSON.stringify({ message: 'm', source: 'o'.repeat(MAX_SOURCE + 100), url: '/'.repeat(MAX_URL + 100) }),
    )
    expect(payload.source).toHaveLength(MAX_SOURCE)
    expect(payload.url).toHaveLength(MAX_URL)
  })

  it('отбрасывает неизвестные поля', () => {
    const body = JSON.stringify({ message: 'm', secret: 'token', nested: { a: 1 }, extra: [1, 2] })
    expect(Object.keys(okPayload(body))).toEqual(['message'])
  })

  it('битый JSON и пустое тело → 400', () => {
    expect(parseLogPayload('{"message": ')).toEqual({ ok: false, status: 400 })
    expect(parseLogPayload('')).toEqual({ ok: false, status: 400 })
  })

  it('не-объект JSON → 400 (массив, строка, число, null)', () => {
    for (const body of ['[]', '"str"', '5', 'null']) {
      expect(parseLogPayload(body)).toEqual({ ok: false, status: 400 })
    }
  })

  it('message обязателен и должен быть непустой строкой → 400', () => {
    for (const body of [
      JSON.stringify({ stack: 's' }),
      JSON.stringify({ message: 42 }),
      JSON.stringify({ message: '' }),
      JSON.stringify({}),
    ]) {
      expect(parseLogPayload(body)).toEqual({ ok: false, status: 400 })
    }
  })

  it('нестроковые optional-поля отбрасываются, а не коэрцируются', () => {
    const body = JSON.stringify({
      message: 'm',
      stack: 42,
      source: {},
      url: [],
      componentStack: true,
    })
    expect(okPayload(body)).toEqual({ message: 'm' })
  })

  it('ts принимается только числом', () => {
    expect(okPayload(JSON.stringify({ message: 'm', ts: 1 })).ts).toBe(1)
    for (const body of [
      JSON.stringify({ message: 'm', ts: '1700000000000' }),
      JSON.stringify({ message: 'm', ts: null }),
      JSON.stringify({ message: 'm', ts: true }),
    ]) {
      expect(okPayload(body)).not.toHaveProperty('ts')
    }
  })

  it('тело ровно MAX_BODY_BYTES проходит, больше — 413', () => {
    // `{"message":""}` — 14 символов, подбираем длину сообщения точно в лимит
    const exact = JSON.stringify({ message: 'x'.repeat(MAX_BODY_BYTES - 14) })
    expect(exact).toHaveLength(MAX_BODY_BYTES)
    expect(parseLogPayload(exact).ok).toBe(true)

    const tooBig = JSON.stringify({ message: 'x'.repeat(MAX_BODY_BYTES - 14 + 1) })
    expect(tooBig.length).toBeGreaterThan(MAX_BODY_BYTES)
    expect(parseLogPayload(tooBig)).toEqual({ ok: false, status: 413 })
  })
})

// --- Смоук-тесты хендлера api/log.ts через fetch-контракт (Request → Response) ---

const PROD = 'https://skvot.vercel.app'
const PREVIEW = 'https://skvot-git-main-blindfoldstudios.vercel.app'
const EVIL = 'https://evil.example.com'
const ENDPOINT = `${PROD}/api/log`

interface CallOptions {
  method?: string
  /** null — заголовок Origin отсутствует (curl, сервер-к-серверу) */
  origin?: string | null
  body?: string | Uint8Array
  extraHeaders?: Record<string, string>
}

async function call(opts: CallOptions = {}): Promise<Response> {
  const method = (opts.method ?? 'POST').toUpperCase()
  const headers: Record<string, string> = { ...opts.extraHeaders }
  if (opts.origin !== null && opts.origin !== undefined) headers.origin = opts.origin

  // GET/HEAD не могут иметь тело — Request на этом бросает TypeError
  const body = method === 'GET' || method === 'HEAD' ? undefined : opts.body
  return handler.fetch(new Request(ENDPOINT, { method, headers, body }))
}

describe('api/log handler (fetch)', () => {
  it('POST с валидным телом и разрешённым origin → 204 и одна строка в console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ origin: PROD, body: JSON.stringify({ message: 'boom', junk: 'x' }) })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD)
    expect(res.headers.get('Vary')).toBe('Origin')
    expect(await res.text()).toBe('')
    expect(errSpy).toHaveBeenCalledTimes(1)
    const [tag, line] = errSpy.mock.calls[0] as [string, string]
    expect(tag).toBe('[client-error]')
    expect(JSON.parse(line)).toEqual({ message: 'boom' })
    errSpy.mockRestore()
  })

  it('POST без Origin (curl) проходит', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ origin: null, body: '{"message":"probe"}' })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    errSpy.mockRestore()
  })

  it('тело читается через request.text(): байтовый Buffer без content-type → 204', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Так летит navigator.sendBeacon с Blob('application/json'): тело — байты,
    // и legacy-рантайм @vercel node не давал к нему доступ (400 в проде).
    const body = new TextEncoder().encode(JSON.stringify({ message: 'кириллица', stack: 'at x' }))
    const res = await call({ origin: PROD, body })
    expect(res.status).toBe(204)
    const line = errSpy.mock.calls[0]?.[1] as string
    expect(JSON.parse(line)).toEqual({ message: 'кириллица', stack: 'at x' })
    errSpy.mockRestore()
  })

  it('превью-домен skvot-*-blindfoldstudios разрешён', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ origin: PREVIEW, body: '{"message":"m"}' })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PREVIEW)
    errSpy.mockRestore()
  })

  it('чужой origin → 403 на POST и на preflight; на своём origin отвечает 204', async () => {
    const post = await call({ origin: EVIL, body: '{"message":"m"}' })
    expect(post.status).toBe(403)
    const preflight = await call({ method: 'OPTIONS', origin: EVIL })
    expect(preflight.status).toBe(403)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(preflight.headers.get('Vary')).toBe('Origin')
    const ok = await call({ method: 'OPTIONS', origin: PROD })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(ok.headers.get('Access-Control-Allow-Headers')).toBe('content-type')
    expect(ok.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('localhost:5173 разрешён только вне продакшена', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = process.env.VERCEL_ENV
    try {
      delete process.env.VERCEL_ENV
      const dev = await call({ origin: 'http://localhost:5173', body: '{"message":"m"}' })
      expect(dev.status).toBe(204)
      process.env.VERCEL_ENV = 'production'
      const prod = await call({ origin: 'http://localhost:5173', body: '{"message":"m"}' })
      expect(prod.status).toBe(403)
    } finally {
      if (original === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = original
      errSpy.mockRestore()
    }
  })

  it('не-POST → 405 с Allow', async () => {
    const res = await call({ method: 'GET', origin: null })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST, OPTIONS')
    expect(await res.text()).toBe('')
  })

  it('тело больше 8 КБ → 413', async () => {
    const res = await call({ origin: PROD, body: 'a'.repeat(MAX_BODY_BYTES + 1) })
    expect(res.status).toBe(413)
  })

  it('лимит в байтах, а не в символах: многобайтное тело → 413', async () => {
    // 8172 символа «й» ≈ 16 КБ в UTF-8 при длине строки меньше MAX_BODY_BYTES
    const body = JSON.stringify({ message: 'й'.repeat(MAX_BODY_BYTES - 20) })
    expect(body.length).toBeLessThan(MAX_BODY_BYTES)
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MAX_BODY_BYTES)
    const res = await call({ origin: PROD, body })
    expect(res.status).toBe(413)
  })

  it('битый JSON → 400 с пустым телом', async () => {
    const res = await call({ origin: PROD, body: '{"message":' })
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('')
  })

  it('пустое тело → 400 без диагностических логов', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ origin: PROD, body: '' })
    expect(res.status).toBe(400)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('POST без тела вообще (null body) → 400 и функция жива', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ origin: PROD })
    expect(res.status).toBe(400)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
