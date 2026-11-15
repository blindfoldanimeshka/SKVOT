import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listing = {
  id: 'l1',
  author_id: 'u1',
  type: 'offer',
  city: 'Москва',
  rooms: '1',
  price: 50000,
  area: 40,
  description: 'Светлая квартира',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
}

const listListings = vi.fn()
const recordListingView = vi.fn()

vi.mock('@/features/listings/api', () => ({
  listListings: (...args: unknown[]) => listListings(...args),
  recordListingView: (...args: unknown[]) => recordListingView(...args),
}))

// Аналитика не нужна в структурном тесте ленты, а без токена она ещё и шумит в warn.
vi.mock('@/features/analytics/trackEvent', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('Feed', () => {
  beforeEach(() => {
    listListings.mockReset()
    recordListingView.mockReset()
  })

  it('renders cards after loading when data is returned', async () => {
    listListings.mockResolvedValue({ data: [listing], error: null, count: 1 })

    const { Feed } = await import('./Feed')
    render(<Feed onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByText('Москва')).toBeInTheDocument())
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
  })

  it('shows empty state when data is empty', async () => {
    listListings.mockResolvedValue({ data: [], error: null, count: 0 })

    const { Feed } = await import('./Feed')
    render(<Feed onOpen={() => {}} />)

    await waitFor(() =>
      expect(
        screen.getByText('Объявлений не найдено. Попробуйте изменить фильтры.'),
      ).toBeInTheDocument(),
    )
  })

  it('shows error state when error is returned', async () => {
    listListings.mockResolvedValue({ data: null, error: 'Упс, ошибка', count: null })

    const { Feed } = await import('./Feed')
    render(<Feed onOpen={() => {}} />)

    await waitFor(() => expect(screen.getByText('Упс, ошибка')).toBeInTheDocument())
  })

  it('debounces the city filter and keeps the input instant', async () => {
    listListings.mockResolvedValue({ data: [], error: null, count: 0 })
    const { Feed } = await import('./Feed')

    vi.useFakeTimers()
    try {
      render(<Feed onOpen={() => {}} />)
      await act(async () => {}) // добиваем начальный запрос

      const input = screen.getByPlaceholderText('Например, Москва') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'Пит' } })
      fireEvent.change(input, { target: { value: 'Питер' } })

      // Поле мгновенное — текст уже в инпуте…
      expect(input.value).toBe('Питер')
      // …но кроме начального ни одного запроса не ушло.
      expect(listListings).toHaveBeenCalledTimes(1)

      act(() => {
        vi.advanceTimersByTime(299)
      })
      expect(listListings).toHaveBeenCalledTimes(1)

      act(() => {
        vi.advanceTimersByTime(1)
      })
      await act(async () => {})

      expect(listListings).toHaveBeenCalledTimes(2)
      expect(listListings).toHaveBeenLastCalledWith({ city: 'Питер' }, 0, 10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('в ленте нет вложенных интерактивов, а карусель не открывает объявление', async () => {
    // mock-объявление: лента сама отдаёт ему три фото, то есть карусель с кнопками.
    const mockListing = { ...listing, is_mock: true }
    listListings.mockResolvedValue({ data: [mockListing], error: null, count: 1 })

    const { Feed } = await import('./Feed')
    const onOpen = vi.fn()
    const { container } = render(<Feed onOpen={onOpen} />)

    const openCard = await screen.findByRole('button', { name: 'Открыть объявление: Москва' })
    // Фото для mock-объявления приходят вторым рендером (лента отдаёт их из
    // getMockPhotoUrls), поэтому карусель ждём, а не предполагаем.
    const arrow = await screen.findByRole('button', { name: 'Следующее фото' })
    expect(arrow).toBeInTheDocument()

    // Главный инвариант: ни один button/a не содержит внутри себя интерактив.
    // Раньше стрелки карусели лежали внутри кнопки карточки, и из-за этого браузер
    // ронял «<button> cannot be a descendant of <button>» на каждом тесте с лентой.
    const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"]'
    const interactive = Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE))
    expect(interactive.length).toBeGreaterThan(0)
    for (const node of interactive) {
      expect(node.querySelector(INTERACTIVE)).toBeNull()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Фото 2 из 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(openCard)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }))
  })
})
