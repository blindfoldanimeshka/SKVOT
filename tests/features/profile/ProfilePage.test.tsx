import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfilePage } from '@/features/profile/components/ProfilePage'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthProvider'
import { NavigationProvider } from '@/app/navigation/NavigationProvider'
import { initialStack } from '@/app/navigation/stack'

// The tabs mount real data hooks (useProfile / useSettings / useConnections),
// so stub the supabase client: this file must not issue any HTTP requests.
vi.mock('@/lib/supabase', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const client = {
    auth: {
      // useConnections reads data.user?.identities; a null user means
      // "nothing linked" and keeps the refresh() path fully offline.
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: vi.fn(() => query),
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://test-project.supabase.co/object/public/avatars/${path}` },
        }),
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    },
  }

  return { getSupabaseClient: () => client }
})

function renderWithAuth(
  overrides: Partial<AuthContextValue> = {},
  navState: Record<string, unknown> = {},
) {
  const value: AuthContextValue = {
    session: { user: { id: 'u1' } } as never,
    user: {
      id: 'u1',
      email: 'a@b.com',
      email_confirmed_at: '2024-01-01',
      user_metadata: { name: 'Иван', city: 'Москва' },
    } as never,
    isLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    updateProfile: vi.fn().mockResolvedValue({ error: null }),
    resetPassword: vi.fn(),
    deleteAccount: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  }

  // Профиль — корневая запись стека, поэтому `state` записи = то, что
  // читает useNavEntryState('profileTab'). Так можно проверить фолбэк для
  // вкладки, которая уже скрыта (состояние переживает сокрытие).
  const stack = initialStack('profile')
  stack.entries[0] = { ...stack.entries[0], state: navState }

  render(
    <AuthContext.Provider value={value}>
      <NavigationProvider initial={stack}>
        <ProfilePage />
      </NavigationProvider>
    </AuthContext.Provider>,
  )

  return value
}

describe('ProfilePage tab navigation', () => {
  it('shows default personal tab content', () => {
    renderWithAuth()

    expect(screen.getByRole('heading', { name: /профиль/i })).toBeInTheDocument()
    expect(screen.getByText(/имя/i)).toBeInTheDocument()
  })

  it('switches to Аккаунт tab', () => {
    renderWithAuth()

    fireEvent.click(screen.getByRole('tab', { name: /Аккаунт/i }))

    expect(
      screen.getByText(/уведомления в приложении/i),
    ).toBeInTheDocument()
  })

  it('hides the Подключения tab: its connect action is not implemented yet', () => {
    renderWithAuth()

    expect(screen.queryByRole('tab', { name: /Подключения/i })).toBeNull()
    // Панель нерабочей вкладки не должна оставаться в DOM.
    expect(screen.queryByText(/подключённые сервисы/i)).toBeNull()
  })

  it('lists only working tabs, keeping the ready ones', () => {
    renderWithAuth()

    const tabNames = screen
      .getAllByRole('tab')
      .map((tab) => tab.textContent?.trim())

    expect(tabNames).toEqual([
      'Личные данные',
      'Аккаунт',
      'Организации',
      'Действия',
    ])
    // Вкладка «Организации» остаётся: создание организации работает через RPC.
    expect(screen.getByRole('tab', { name: /Организации/i })).toBeInTheDocument()
  })

  it('falls back to personal when the stored tab was hidden', () => {
    renderWithAuth({}, { profileTab: 'connections' })

    expect(screen.queryByRole('tab', { name: /Подключения/i })).toBeNull()
    expect(screen.getByRole('tab', { name: /Личные данные/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Пустого экрана нет: контент дефолтной вкладки на месте.
    expect(screen.getByText(/имя/i)).toBeInTheDocument()
  })

  it('falls back to personal when the stored tab is unknown', () => {
    renderWithAuth({}, { profileTab: 'billing' })

    expect(screen.getByRole('tab', { name: /Личные данные/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText(/имя/i)).toBeInTheDocument()
  })

  it('switches to Действия tab', () => {
    renderWithAuth()

    fireEvent.click(screen.getByRole('tab', { name: /Действия/i }))

    expect(
      screen.getByRole('button', { name: /удалить аккаунт/i }),
    ).toBeInTheDocument()
  })
})
