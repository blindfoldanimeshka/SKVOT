import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MyListingsScreen } from './MyListingsScreen'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      name: 'Тест',
      email_confirmed_at: '2026-01-01T00:00:00Z',
    },
    session: null,
  }),
}))

vi.mock('@/features/listings/api', () => ({
  archiveListing: vi.fn().mockResolvedValue({ data: null, error: null }),
  createListing: vi.fn(),
  updateListing: vi.fn(),
}))

// «Мои объявления» не фильтрует по статусу: автор видит и pending, и rejected.
vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: 'l-pending',
                  author_id: 'u1',
                  type: 'offer',
                  city: 'Казань',
                  rooms: '1',
                  price: 40000,
                  area: 38,
                  description: 'Ждёт модератора',
                  status: 'pending',
                  created_at: '2026-01-01T00:00:00Z',
                  updated_at: '2026-01-01T00:00:00Z',
                  deleted_at: null,
                },
                {
                  id: 'l-active',
                  author_id: 'u1',
                  type: 'offer',
                  city: 'Москва',
                  rooms: '2',
                  price: 90000,
                  area: 55,
                  description: 'Одобрено',
                  status: 'active',
                  created_at: '2026-01-02T00:00:00Z',
                  updated_at: '2026-01-02T00:00:00Z',
                  deleted_at: null,
                },
                {
                  id: 'l-rejected',
                  author_id: 'u1',
                  type: 'request',
                  city: 'Тверь',
                  rooms: 'studio',
                  price: 20000,
                  area: null,
                  description: 'Отклонено',
                  status: 'rejected',
                  created_at: '2026-01-03T00:00:00Z',
                  updated_at: '2026-01-03T00:00:00Z',
                  deleted_at: null,
                },
                {
                  id: 'l-archived',
                  author_id: 'u1',
                  type: 'offer',
                  city: 'Сочи',
                  rooms: '3',
                  price: 120000,
                  area: 70,
                  description: 'Снято с публикации',
                  status: 'archived',
                  created_at: '2026-01-04T00:00:00Z',
                  updated_at: '2026-01-04T00:00:00Z',
                  deleted_at: null,
                },
              ],
              error: null,
            }),
        }),
      }),
    }),
  }),
}))

describe('MyListingsScreen статусы', () => {
  it('показывает бейдж «На модерации» для pending-объявления', async () => {
    render(<MyListingsScreen onBack={() => {}} />)

    expect(await screen.findByText('На модерации')).toBeTruthy()
    expect(screen.getByText('Казань')).toBeTruthy()
  })

  it('показывает «Опубликовано», «Отклонено» и «В архиве» для остальных статусов', async () => {
    render(<MyListingsScreen onBack={() => {}} />)

    expect(await screen.findByText('На модерации')).toBeTruthy()
    expect(screen.getByText('Опубликовано')).toBeTruthy()
    expect(screen.getByText('Отклонено')).toBeTruthy()
    expect(screen.getByText('В архиве')).toBeTruthy()
  })
})
