import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetClientErrorReporting,
  installClientErrorReporting,
  reportClientError,
  type ClientErrorPayload,
} from './reportClientError'

let beaconSpy: ReturnType<typeof vi.fn>
let fetchSpy: ReturnType<typeof vi.fn>

async function lastPayload(at = 0): Promise<ClientErrorPayload> {
  const call = beaconSpy.mock.calls[at]
  expect(call).toBeDefined()
  const [url, blob] = call as unknown as [string, Blob]
  expect(url).toBe('/api/log')
  return JSON.parse(await blob.text()) as ClientErrorPayload
}

beforeEach(() => {
  // vitest не позволяет застабить import.meta.env.DEV через vi.stubEnv (он всегда true
  // в тестах), поэтому для «продакшн-ветки» используем тестовый шов { dev: false }.
  __resetClientErrorReporting({ dev: false })
  beaconSpy = vi.fn(() => true)
  fetchSpy = vi.fn(async () => undefined)
  Object.defineProperty(window.navigator, 'sendBeacon', {
    value: beaconSpy,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  vi.stubEnv('VITE_ERROR_REPORT', '')
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  __resetClientErrorReporting()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('installClientErrorReporting', () => {
  it('(а) отправляет на /api/log при window "error"', async () => {
    installClientErrorReporting()
    const error = new Error('boom')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))

    expect(beaconSpy).toHaveBeenCalledTimes(1)
    const payload = await lastPayload()
    expect(payload.message).toBe('boom')
    expect(payload.url).toBe('/') // pathname без query
    expect(typeof payload.ts).toBe('number')
  })

  it('(б) отправляет при "unhandledrejection"', async () => {
    installClientErrorReporting()
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new Error('rejected!')
    window.dispatchEvent(event)

    expect(beaconSpy).toHaveBeenCalledTimes(1)
    const payload = await lastPayload()
    expect(payload.message).toBe('rejected!')
  })

  it('(в) дедуплицирует одну сигнатуру в пределах сессии', async () => {
    installClientErrorReporting()
    const error = new Error('same')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))

    expect(beaconSpy).toHaveBeenCalledTimes(1)
  })

  it('(г) не отправляет больше 20 за сессию', () => {
    installClientErrorReporting()
    for (let i = 0; i < 25; i++) {
      const error = new Error(`unique-${i}`)
      window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    }
    expect(beaconSpy).toHaveBeenCalledTimes(20)
  })

  it('(д) не отправляет при VITE_ERROR_REPORT=off', () => {
    vi.stubEnv('VITE_ERROR_REPORT', 'off')
    installClientErrorReporting()
    const error = new Error('quiet')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    expect(beaconSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('(е) не отправляет в dev (import.meta.env.DEV)', () => {
    // Настоящее значение DEV в vitest — true; без тестового шва репортёр обязан молчать.
    expect(import.meta.env.DEV).toBe(true)
    __resetClientErrorReporting()
    installClientErrorReporting()
    const error = new Error('dev-only')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    expect(beaconSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('не отправляет браузерный шум ResizeObserver loop', () => {
    installClientErrorReporting()
    const error = new Error('ResizeObserver loop completed with undelivered notifications.')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    expect(beaconSpy).not.toHaveBeenCalled()
  })

  it('не отправляет при navigator.onLine === false', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    installClientErrorReporting()
    const error = new Error('offline')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    expect(beaconSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('использует fetch(keepalive) как fallback, когда sendBeacon недоступен', async () => {
    Reflect.deleteProperty(window.navigator, 'sendBeacon')
    installClientErrorReporting()
    const error = new Error('via-fetch')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/log')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    const payload = JSON.parse(String(init.body)) as ClientErrorPayload
    expect(payload.message).toBe('via-fetch')
  })
})

describe('reportClientError (экспорт для ErrorBoundary)', () => {
  it('отправляет componentStack и помечает ошибку от повторной отправки', async () => {
    installClientErrorReporting()
    const error = new Error('crash')
    reportClientError(error, { componentStack: '\n  in App' })
    // React 19 дублирует ошибку границы в window 'error' — дубля быть не должно
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))

    expect(beaconSpy).toHaveBeenCalledTimes(1)
    const payload = await lastPayload()
    expect(payload.message).toBe('crash')
    expect(payload.componentStack).toContain('in App')
    expect(payload.source).toBeUndefined()
  })

  it('обрезает message до 1000 и stack до 4000 символов', async () => {
    installClientErrorReporting()
    reportClientError('x'.repeat(1500))
    const error = new Error('long stack')
    error.stack = 's'.repeat(5000)
    reportClientError(error)

    expect(beaconSpy).toHaveBeenCalledTimes(2)
    const first = await lastPayload(0)
    expect(first.message).toHaveLength(1000)
    const second = await lastPayload(1)
    expect(second.stack).toHaveLength(4000)
  })

  it('никогда не бросает, если нет транспорта', () => {
    Reflect.deleteProperty(window.navigator, 'sendBeacon')
    fetchSpy.mockImplementation(() => {
      throw new TypeError('no fetch')
    })
    installClientErrorReporting()
    expect(() => reportClientError(new Error('no transport'))).not.toThrow()
  })

  it('installClientErrorReporting идемпотентна', async () => {
    installClientErrorReporting()
    installClientErrorReporting()
    const error = new Error('once')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    expect(beaconSpy).toHaveBeenCalledTimes(1)
    const payload = await lastPayload()
    expect(payload.message).toBe('once')
  })
})
