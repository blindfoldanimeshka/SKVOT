import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

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

/**
 * Док поднят над стеком экранов (`MenuNav` — сиблинг `PageStack`), иначе
 * навигация перемонтировала полосу и «переезд» скобы, pop и bounce не могли
 * сыграть: новому экземпляру не откуда ехать.
 */
describe('App: док над стеком экранов', () => {
  // Как и в describe выше: каждый тест получает приложение с новым моком
  // supabase, иначе `await import('@/app/App')` вернёт модуль с чужой сессией.
  beforeEach(() => {
    vi.resetModules()
    authStateCb = null
  })

  const dockBar = () => document.querySelector('.dock-bar') as HTMLElement
  const bracket = () => document.querySelector('[data-dock-bracket]') as HTMLElement | null

  /**
   * jsdom не раскладывает boxes: `offsetLeft`/`offsetWidth` всегда 0, а по ним
   * MenuBar измеряет скобу. Подсовываем геометрию ряда, чтобы переезд стало
   * чем измерять.
   */
  function stubDockGeometry(): void {
    const buttons = [...document.querySelectorAll<HTMLElement>('.dock-bar button')]
    expect(buttons).toHaveLength(5)
    buttons.forEach((el, i) => {
      Object.defineProperty(el, 'offsetLeft', { value: i * 70, configurable: true })
      Object.defineProperty(el, 'offsetWidth', { value: 64, configurable: true })
    })
  }

  function setScrollY(y: number): void {
    Object.defineProperty(window, 'scrollY', {
      value: y,
      writable: true,
      configurable: true,
    })
  }

  afterEach(() => {
    setScrollY(0)
  })

  it('не перемонтируется при смене раздела и скоба реально едет (тот же узел)', async () => {
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    const node = bracket()
    expect(node).not.toBeNull()
    // Один инстанс дока на приложение.
    expect(document.querySelectorAll('[data-dock-bracket]')).toHaveLength(1)

    stubDockGeometry()
    // Resize — единственный способ заставить док перечитать подставленную
    // геометрию без перерисовки: measure() висит на window「resize」.
    act(() => window.dispatchEvent(new Event('resize')))
    await waitFor(() => expect(node!.style.width).toBe('64px'))

    fireEvent.click(screen.getByRole('button', { name: 'Мои' }))
    await screen.findByRole('heading', { name: 'Мои объявления' })

    // Экран сменился (mode="wait" доиграл exit → enter), а док — тот же узел.
    expect(bracket()).toBe(node)
    expect(document.querySelectorAll('[data-dock-bracket]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Мои' })).toHaveAttribute('aria-current', 'page')

    // Слой: док — ПОСЛЕДНИЙ сиблинг после стека экранов и positioned z-40,
    // тогда как обёртки страниц не позиционированы (их transform при
    // переходе рисует layer с z-index auto) — значит док поверх экрана.
    const wrapper = node!.closest('.fixed') as HTMLElement
    expect(wrapper.className).toContain('z-40')
    expect(wrapper.parentElement?.lastElementChild).toBe(wrapper)

    // «Мои» — третий пункт: 2 × 70 = 140px. Пружина доезжает до цели.
    await waitFor(() => expect(node!.style.transform).toBe('translateX(140px)'))
  })

  it('compact дока не переезжает вместе с новым экраном', async () => {
    setScrollY(0)
    await renderApp(mockSession)
    await screen.findByRole('heading', { name: 'Объявления' })

    // Прокрутили ленту вниз — полоса сжалась.
    act(() => setScrollY(400))
    act(() => window.dispatchEvent(new Event('scroll')))
    await waitFor(() => expect(dockBar().className).toContain('dock-h-compact'))

    // Новый экран: док разжат, иначе он приезжал бы сжатой полосой.
    act(() => setScrollY(0))
    fireEvent.click(screen.getByRole('button', { name: 'Мои' }))
    await screen.findByRole('heading', { name: 'Мои объявления' })
    expect(dockBar().className).not.toContain('compact')
    expect(dockBar().className).toContain('h-[var(--dock-h)]')
  })

  it('дока нет на экране входа и на юридических страницах — и он возвращается в ленту', async () => {
    await renderApp(null)
    await screen.findByRole('heading', { name: 'Объявления' })
    expect(bracket()).not.toBeNull()

    // Аноним жмёт «Новое» → экран входа: дока нет.
    fireEvent.click(screen.getByRole('button', { name: 'Новое' }))
    await screen.findByRole('heading', { name: 'Вход' })
    expect(bracket()).toBeNull()

    // «Политика конфиденциальности» с экрана входа → legal-страница: тоже нет.
    fireEvent.click(screen.getByRole('button', { name: 'Политика конфиденциальности' }))
    await screen.findByRole('heading', { name: 'Политика конфиденциальности' })
    expect(bracket()).toBeNull()

    // «← Назад» с legal-страницы — возврат на экран входа, а не в ленту.
    fireEvent.click(screen.getByRole('button', { name: '← Назад' }))
    await screen.findByRole('heading', { name: 'Вход' })
    expect(bracket()).toBeNull()

    // Отмена входа → лента → док на месте.
    fireEvent.click(screen.getByRole('button', { name: '← Назад' }))
    await screen.findByRole('heading', { name: 'Объявления' })
    expect(bracket()).not.toBeNull()
  })

  it('дока нет на «Условиях»', async () => {
    await renderApp(null)
    await screen.findByRole('heading', { name: 'Объявления' })

    fireEvent.click(screen.getByRole('button', { name: 'Новое' }))
    await screen.findByRole('heading', { name: 'Вход' })
    fireEvent.click(screen.getByRole('button', { name: 'Условия' }))
    await screen.findByRole('heading', { name: 'Условия использования' })

    expect(bracket()).toBeNull()
  })
})
