import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import handler from '../../api/log'
import {
  MAX_BODY_BYTES,
  MAX_COMPONENT_STACK,
  MAX_MESSAGE,
  MAX_SOURCE,
  MAX_STACK,
  MAX_URL,
  parseLogPayload,
  type ClientErrorPayload,
} from '../../api/_logPayload'

function okPayload(body: string): ClientErrorPayload {
  const result = parseLogPayload(body)
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.status}`)
  }
  return result.payload
}

describe('parseLogPayload (api/_logPayload.ts)', () => {
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

// --- Смоук-тесты хендлера api/log.ts на моках req/res (без Vercel-рантайма) ---

const PROD = 'https://skvot.vercel.app'
const PREVIEW = 'https://skvot-git-main-blindfoldstudios.vercel.app'
const EVIL = 'https://evil.example.com'

function mockReq(opts: { method?: string; origin?: string | null; body?: string | Buffer }): IncomingMessage {
  const chunks = opts.body === undefined ? [] : [Buffer.from(opts.body)]
  const headers: Record<string, string> = {}
  if (opts.origin !== null && opts.origin !== undefined) headers.origin = opts.origin
  return {
    method: opts.method ?? 'POST',
    headers,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  } as unknown as IncomingMessage
}

interface MockRes {
  statusCode: number
  ended: boolean
  headers: Record<string, string>
  setHeader(name: string, value: string): void
  end(): void
}

function mockRes(): MockRes {
  return {
    statusCode: 0,
    ended: false,
    headers: {},
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
    end() {
      this.ended = true
    },
  }
}

async function call(req: IncomingMessage): Promise<MockRes> {
  const res = mockRes()
  await handler(req, res as unknown as ServerResponse)
  return res
}

describe('api/log handler', () => {
  it('POST с валидным телом и разрешённым origin → 204 и одна строка в console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(mockReq({ origin: PROD, body: JSON.stringify({ message: 'boom', junk: 'x' }) }))
    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Origin']).toBe(PROD)
    expect(errSpy).toHaveBeenCalledTimes(1)
    const [tag, line] = errSpy.mock.calls[0] as [string, string]
    expect(tag).toBe('[client-error]')
    expect(JSON.parse(line)).toEqual({ message: 'boom' })
    errSpy.mockRestore()
  })

  it('POST без Origin (curl) проходит', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(mockReq({ origin: null, body: '{"message":"probe"}' }))
    expect(res.statusCode).toBe(204)
    errSpy.mockRestore()
  })

  it('превью-домен skvot-*-blindfoldstudios разрешён', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(mockReq({ origin: PREVIEW, body: '{"message":"m"}' }))
    expect(res.statusCode).toBe(204)
    expect(res.headers['Access-Control-Allow-Origin']).toBe(PREVIEW)
    errSpy.mockRestore()
  })

  it('чужой origin → 403 на POST и на preflight; на своём origin отвечает 204', async () => {
    expect((await call(mockReq({ origin: EVIL, body: '{"message":"m"}' }))).statusCode).toBe(403)
    const preflight = await call(mockReq({ method: 'OPTIONS', origin: EVIL }))
    expect(preflight.statusCode).toBe(403)
    expect(preflight.headers['Access-Control-Allow-Origin']).toBeUndefined()
    const ok = await call(mockReq({ method: 'OPTIONS', origin: PROD }))
    expect(ok.statusCode).toBe(204)
    expect(ok.headers['Access-Control-Allow-Methods']).toContain('POST')
  })

  it('localhost:5173 разрешён только вне продакшена', async () => {
    const original = process.env.VERCEL_ENV
    try {
      delete process.env.VERCEL_ENV
      const dev = await call(mockReq({ origin: 'http://localhost:5173', body: '{"message":"m"}' }))
      expect(dev.statusCode).toBe(204)
      process.env.VERCEL_ENV = 'production'
      const prod = await call(mockReq({ origin: 'http://localhost:5173' }))
      expect(prod.statusCode).toBe(403)
    } finally {
      if (original === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = original
    }
  })

  it('не-POST → 405 с Allow', async () => {
    const res = await call(mockReq({ method: 'GET', origin: null }))
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST, OPTIONS')
  })

  it('тело больше 8 КБ → 413', async () => {
    const res = await call(mockReq({ origin: PROD, body: Buffer.alloc(MAX_BODY_BYTES + 1, 0x61) }))
    expect(res.statusCode).toBe(413)
  })

  it('битый JSON → 400 с пустым телом', async () => {
    const res = await call(mockReq({ origin: PROD, body: '{"message":' }))
    expect(res.statusCode).toBe(400)
    expect('body' in res).toBe(false)
  })
})
