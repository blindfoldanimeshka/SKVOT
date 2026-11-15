import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mockSession = {
  user: { id: 'u1', email: 'test@example.com', email_confirmed_at: 'now' },
  access_token: 'token',
}

// Колбэк supabase.auth.onAuthStateChange, подсмотренный у AuthProvider,
// чтобы «дойти» вход прямо в тесте без сети.
let authStateCb: ((event: string, session: unknown) => void) | null = null

function mockSupabase(session: unknown) {
  authStateCb = null

  const queryResult = { data: [], error: null, count: 0 }
  const chain: Record<string, Mock> = {}
  const self = vi.fn(() => chain)
  for (const method of [
    'select',
    'eq',
    'ilike',
    'lte',
    'is',
    'in',
    'order',
    'range',
    'insert',
    'update',
    'delete',
  ]) {
    chain[method] = self
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  // Запросы-билдеры Supabase then-able; await без range()/maybeSingle()
  // тоже должен резолвиться (listMyOrganizations и т. п.).
  chain.then = vi.fn(
    (onFulfilled?: (value: typeof queryResult) => unknown) =>
      Promise.resolve(queryResult).then(onFulfilled),
  )

  vi.doMock('@/lib/supabase', () => ({
    getSupabaseClient: () => ({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session } }),
        onAuthStateChange: vi.fn(
          (cb: (event: string, nextSession: unknown) => void) => {
            authStateCb = cb
            return { data: { subscription: { unsubscribe: vi.fn() } } }
          },
        ),
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        signUp: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn(() => chain),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      })),
      removeChannel: vi.fn(),
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }))
}

async function renderApp(session: unknown) {
  mockSupabase(session)
  const { App: AppModule } = await import('@/app/App')
  render(<AppModule />)
  return AppModule
}

describe('App', () => {
  beforeEach(() => {
    vi.resetModules()
    authStateCb = null
  })

  it('shows the product name when a session is present', async () => {
    await renderApp(mockSession)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Объявления' }),
      ).toBeInTheDocument(),
    )
  })

  it('anonymous user sees the feed instead of the login gate', async () => {
    await renderApp(null)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Объявления' }),
      ).toBeInTheDocument(),
    )
    // Никакого экрана входа и никаких баннеров «для залогиненных».
    expect(
      screen.queryByRole('heading', { name: 'Вход' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/подтвердите email/i),
    ).not.toBeInTheDocument()
  })

  it('gated dock action for an anonymous user opens login with a hint, and «← Назад» returns to the feed', async () => {
    await renderApp(null)
    await screen.findByRole('heading', { name: 'Объявления' })

    fireEvent.click(screen.getByRole('button', { name: 'Новое' }))

    await screen.findByRole('heading', { name: 'Вход' })
    expect(
      screen.getByText('Войдите, чтобы подать объявление'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← Назад' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Объявления' }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('heading', { name: 'Вход' }),
    ).not.toBeInTheDocument()
  })

  it('after sign-in returns to the screen the anonymous user asked for', async () => {
    await renderApp(null)
    await screen.findByRole('heading', { name: 'Объявления' })

    fireEvent.click(screen.getByRole('button', { name: 'Новое' }))
    await screen.findByRole('heading', { name: 'Вход' })

    // «Вход» прошёл: прокидываем сессию через onAuthStateChange, как Supabase.
    await waitFor(() => expect(authStateCb).toBeTruthy())
    act(() => {
      authStateCb!('SIGNED_IN', mockSession)
    })

    // Основной интерфейс вернулся — и сразу на целевой экран создания.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Новое объявление' }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('heading', { name: 'Вход' }),
    ).not.toBeInTheDocument()
  })
})
