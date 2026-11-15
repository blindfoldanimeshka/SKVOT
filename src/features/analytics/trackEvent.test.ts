import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockClient {
  auth: { getSession: ReturnType<typeof vi.fn> }
  functions: { invoke: ReturnType<typeof vi.fn> }
}

const SESSION = { access_token: 'test-jwt', user: { id: 'u1' } }

function makeClient(session: unknown = SESSION): MockClient {
  return {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session } }) },
    functions: { invoke: vi.fn().mockResolvedValue({ error: null, data: { ok: true } }) },
  }
}

/** Подменяем '@/lib/supabase' и загружаем модуль заново, чтобы он увидел мок. */
async function importTrackEvent(client: MockClient) {
  vi.doMock('@/lib/supabase', () => ({ getSupabaseClient: () => client }))
  const { trackEvent } = await import('./trackEvent')
  return trackEvent
}

describe('trackEvent (F12 funnel)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends event_type and payload when a session exists', async () => {
    const client = makeClient()
    const trackEvent = await importTrackEvent(client)

    await trackEvent('view_listing', { listing_id: 'l1' })

    expect(client.auth.getSession).toHaveBeenCalledTimes(1)
    expect(client.functions.invoke).toHaveBeenCalledWith('track-event', {
      body: { event_type: 'view_listing', payload: { listing_id: 'l1' } },
    })
  })

  it('sends null payload when none is provided', async () => {
    const client = makeClient()
    const trackEvent = await importTrackEvent(client)

    await trackEvent('open_chat')

    expect(client.functions.invoke.mock.calls[0][1]).toEqual({
      body: { event_type: 'open_chat', payload: null },
    })
  })

  it('skips guest clicks (no session) without invoking or warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient(null)
    const trackEvent = await importTrackEvent(client)

    await trackEvent('view_listing', { listing_id: 'l1' })

    expect(client.functions.invoke).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('swallows invoke errors without throwing (analytics never breaks UX)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient()
    client.functions.invoke.mockRejectedValue(new Error('cors blocked'))
    const trackEvent = await importTrackEvent(client)

    await expect(trackEvent('send_message')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('swallows session lookup failures too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient()
    client.auth.getSession.mockRejectedValue(new Error('offline'))
    const trackEvent = await importTrackEvent(client)

    await expect(trackEvent('create_listing')).resolves.toBeUndefined()
    expect(client.functions.invoke).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
