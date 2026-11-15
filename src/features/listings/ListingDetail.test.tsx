import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/AuthProvider'

const getListing = vi.fn()
const boostListing = vi.fn()
const openOrCreateChat = vi.fn()
const createReport = vi.fn()

vi.mock('@/features/listings/api', () => ({
  getListing: (...args: unknown[]) => getListing(...args),
  boostListing: (...args: unknown[]) => boostListing(...args),
}))

vi.mock('@/features/chat/chatApi', () => ({
  openOrCreateChat: (...args: unknown[]) => openOrCreateChat(...args),
}))

vi.mock('@/features/photos/photoApi', () => ({
  listPhotos: vi.fn().mockResolvedValue({ data: [], error: null }),
  getPublicUrl: (path: string) => path,
}))

vi.mock('@/features/reports/reportApi', () => ({
  createReport: (...args: unknown[]) => createReport(...args),
}))

// Карта тянет Яндекс-скрипт — в тестах не нужна (lat/lng null и так,
// но импорт модуля происходит всегда).
vi.mock('@/features/listings/MapView', () => ({
  MapView: () => null,
}))

import { ListingDetail } from '@/features/listings/ListingDetail'

const listing = {
  id: 'l1',
  author_id: 'author-1',
  type: 'offer',
  city: 'Москва',
  rooms: '1',
  price: 50000,
  area: null,
  description: 'Уютная квартира',
  address: '',
  lat: null,
  lng: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  is_mock: false,
  promoted_until: null,
}

function renderDetail(
  authOverrides: Partial<AuthContextValue> = {},
  props: Partial<{
    onStartChat: (chatId: string) => void
    requireAuth: (opts: { hint: string; resume?: 'chat' | null }) => void
    resumeStartChat: boolean
  }> = {},
) {
  const value: AuthContextValue = {
    session: null,
    user: null,
    isLoading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    updateProfile: vi.fn(),
    resetPassword: vi.fn(),
    deleteAccount: vi.fn(),
    ...authOverrides,
  }
  const onStartChat = props.onStartChat ?? vi.fn()
  const requireAuth = props.requireAuth ?? vi.fn()

  render(
    <AuthContext.Provider value={value}>
      <ListingDetail
        id="l1"
        onBack={() => {}}
        onStartChat={onStartChat}
        requireAuth={requireAuth}
        resumeStartChat={props.resumeStartChat}
      />
    </AuthContext.Provider>,
  )

  return { onStartChat, requireAuth }
}

const loggedInUser = (id: string) =>
  ({ id, email: `${id}@test.local`, user_metadata: {} }) as never

describe('ListingDetail deferred auth', () => {
  beforeEach(() => {
    getListing.mockReset()
    getListing.mockResolvedValue({ data: listing, error: null })
    boostListing.mockReset()
    boostListing.mockResolvedValue({ data: true, error: null })
    openOrCreateChat.mockReset()
    openOrCreateChat.mockResolvedValue({ data: 'c1', error: null })
    createReport.mockReset()
    createReport.mockResolvedValue({ data: { id: 'r1' }, error: null })
  })

  it('shows «Написать автору» to an anonymous user and asks for login instead of calling Supabase', async () => {
    const { requireAuth, onStartChat } = renderDetail()

    const button = await screen.findByRole('button', { name: /написать автору/i })
    fireEvent.click(button)

    expect(requireAuth).toHaveBeenCalledWith({
      hint: 'Войдите, чтобы написать автору',
      resume: 'chat',
    })
    // Гость не шлёт запрос в supabase.
    expect(openOrCreateChat).not.toHaveBeenCalled()
    expect(onStartChat).not.toHaveBeenCalled()
  })

  it('asks for login on «Пожаловаться» without opening the form or sending a report', async () => {
    const { requireAuth } = renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: /пожаловаться/i }))

    expect(requireAuth).toHaveBeenCalledWith({
      hint: 'Войдите, чтобы пожаловаться',
    })
    expect(screen.queryByRole('button', { name: 'Отправить' })).not.toBeInTheDocument()
    expect(createReport).not.toHaveBeenCalled()
  })

  it('logged-in non-author still opens the chat directly', async () => {
    const { requireAuth, onStartChat } = renderDetail({
      user: loggedInUser('visitor-1'),
      session: { user: loggedInUser('visitor-1') } as never,
    })

    fireEvent.click(await screen.findByRole('button', { name: /написать автору/i }))

    await waitFor(() => expect(openOrCreateChat).toHaveBeenCalledWith('l1'))
    expect(onStartChat).toHaveBeenCalledWith('c1')
    expect(requireAuth).not.toHaveBeenCalled()
  })

  it('author sees the boost panel, not the chat CTA (unchanged behavior)', async () => {
    renderDetail({ user: loggedInUser('author-1') })

    await screen.findByText('Уютная квартира')
    expect(screen.queryByRole('button', { name: /написать автору/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /поднять объявление/i })).toBeInTheDocument()
  })

  it('resumeStartChat auto-continues the action after login, once the listing is loaded', async () => {
    const { onStartChat, requireAuth } = renderDetail(
      { user: loggedInUser('visitor-1'), session: { user: loggedInUser('visitor-1') } as never },
      { resumeStartChat: true },
    )

    await waitFor(() => expect(openOrCreateChat).toHaveBeenCalledWith('l1'))
    await waitFor(() => expect(onStartChat).toHaveBeenCalledWith('c1'))
    expect(requireAuth).not.toHaveBeenCalled()
    // Действие продолжается ровно один раз.
    expect(openOrCreateChat.mock.calls.length).toBe(1)
  })
})

describe('ListingDetail hero — фото ограничено, плашка под фото', () => {
  beforeEach(() => {
    getListing.mockReset()
    // Mock-объявление: фото берутся из getMockPhotoUrls, карусель рендерится сразу.
    getListing.mockResolvedValue({ data: { ...listing, is_mock: true }, error: null })
    boostListing.mockReset()
    openOrCreateChat.mockReset()
  })

  it('карусель ограничена по высоте, плашка — flow-футер под фото, а не absolute поверх снимка', async () => {
    renderDetail()

    const carousel = await screen.findByRole('group', { name: 'Фото объявления' })
    expect(carousel).toHaveClass('max-h-[35vh]', 'sm:max-h-[35vh]')

    // Плашка — последний flow-ребенок hero-карточки (сиблинг карусели), без absolute.
    const hero = carousel.parentElement as HTMLElement
    const plate = hero.lastElementChild as HTMLElement
    expect(plate).not.toHaveClass('absolute')
    expect(plate).toContainElement(screen.getByRole('heading', { level: 1, name: 'Москва' }))
  })

  it('бейдж мока читается «Демо» (кириллица), цена лежит на плашке под фото', async () => {
    renderDetail()

    const carousel = await screen.findByRole('group', { name: 'Фото объявления' })
    const plate = carousel.parentElement!.lastElementChild as HTMLElement

    expect(plate).toHaveTextContent('Демо')
    expect(screen.queryByText('MOCK')).not.toBeInTheDocument()
    // Цена читаема на плашке (тот же формат, что и в бенто-плитке ниже).
    expect(plate).toHaveTextContent('50 000')
    expect(plate).toHaveTextContent('Москва')
  })
})
