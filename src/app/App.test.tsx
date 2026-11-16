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

  it('gated header action for an anonymous user opens login with a hint, and «← Назад» returns to the feed', async () => {
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

/**
 * Навигация переехала из нижнего дока в шапку (`AppShell`): те же подписи
 * пунктов на них завязаны e2e, активный раздел помечен `aria-current="page"`,
 * на входе и юридических страницах навигации нет, бейджа «MVP» и кастомного
 * курсора больше нет вовсе.
 */
describe('App: навигация в шапке', () => {
  const NAV_LABELS = ['Поиск', 'Новое', 'Мои', 'Чаты', 'Профиль'] as const

  beforeEach(() => {
    vi.resetModules()
    authStateCb = null
  })

  /**
   * AppShell живёт внутри экрана, поэтому на время перехода (`mode="wait"`)
   * в DOM висят две шапки: старая уезжает, новая приехала. Ждём, пока
   * останется одна, — иначе `getByRole` спотыкается о дубли.
   */
  async function navItem(label: (typeof NAV_LABELS)[number]): Promise<HTMLElement> {
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: NAV_LABELS[0] })).toHaveLength(1),
    )
    return screen.getByRole('button', { name: label })
  }

  it('показывает пункты в шапке и помечает активный раздел', async () => {
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    for (const label of NAV_LABELS) {
      expect(await navItem(label)).toBeInTheDocument()
    }

    expect(await navItem('Поиск')).toHaveAttribute('aria-current', 'page')
    expect(await navItem('Мои')).not.toHaveAttribute('aria-current')

    // Пункты — в <nav> внутри шапки, а не прибиты к низу экрана.
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' })
    expect(nav.closest('header')).not.toBeNull()
  })

  it('клик «Мои» переводит на экран «Мои объявления» и переносит выделение', async () => {
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    fireEvent.click(await navItem('Мои'))

    await screen.findByRole('heading', { name: 'Мои объявления' })
    expect(await navItem('Мои')).toHaveAttribute('aria-current', 'page')
    expect(await navItem('Поиск')).not.toHaveAttribute('aria-current')
  })

  it('«Чаты» — не просто переход: они открывают панель уведомлений на экране чатов', async () => {
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    fireEvent.click(await navItem('Чаты'))

    await screen.findByRole('heading', { name: 'Мои чаты' })
    expect(await navItem('Чаты')).toHaveAttribute('aria-current', 'page')
  })

  it('на экране входа и на юридических страницах навигации нет — и она возвращается в ленту', async () => {
    await renderApp(null)
    await screen.findByRole('heading', { name: 'Объявления' })
    expect(await navItem('Профиль')).toBeInTheDocument()

    // Аноним жмёт «Новое» → экран входа: он без шапки, значит и без пунктов.
    fireEvent.click(screen.getByRole('button', { name: 'Новое' }))
    await screen.findByRole('heading', { name: 'Вход' })
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'Мои' })).toBeNull()

    // «Политика конфиденциальности» с экрана входа — тоже без навигации.
    fireEvent.click(screen.getByRole('button', { name: 'Политика конфиденциальности' }))
    await screen.findByRole('heading', { name: 'Политика конфиденциальности' })
    expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).toBeNull()

    // «← Назад» — возврат на вход, затем отмена входа — и лента снова с навигацией.
    fireEvent.click(screen.getByRole('button', { name: '← Назад' }))
    await screen.findByRole('heading', { name: 'Вход' })
    expect(screen.queryByRole('navigation', { name: 'Основная навигация' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '← Назад' }))
    await screen.findByRole('heading', { name: 'Объявления' })
    expect(await navItem('Профиль')).toBeInTheDocument()
  })

  it('в шапке нет бейджа «MVP»', async () => {
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    const header = document.querySelector('header')
    expect(header).not.toBeNull()
    expect(header!.textContent).not.toContain('MVP')
    expect(screen.queryByText('MVP')).toBeNull()
  })

  it('кастомный курсор не внедряет стиль и не рисует свой элемент', async () => {
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    expect(document.getElementById('custom-cursor-style')).toBeNull()
    expect(document.querySelector('[data-custom-cursor]')).toBeNull()
  })
})
