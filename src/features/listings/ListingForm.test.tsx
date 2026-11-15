import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createListing = vi.fn()
const listMyOrganizations = vi.fn()

function mockDeps() {
  createListing.mockReset()
  createListing.mockResolvedValue({ data: { id: 'l1' }, error: null })

  listMyOrganizations.mockReset()
  listMyOrganizations.mockResolvedValue({ data: [], error: null })

  vi.doMock('@/features/auth/useAuth', () => ({
    useAuth: () => ({
      user: {
        id: 'u1',
        email: 'a@b.c',
        email_confirmed_at: '2026-01-01T00:00:00Z',
      },
      session: null,
    }),
  }))

  vi.doMock('@/features/listings/api', () => ({
    createListing,
    updateListing: vi.fn(),
    archiveListing: vi.fn(),
  }))

  vi.doMock('@/features/organizations/orgApi', () => ({
    listMyOrganizations,
  }))

  vi.doMock('@/features/photos/PhotoUploader', () => ({
    PhotoUploader: () => null,
  }))
}

async function renderForm() {
  const { ListingForm } = await import('./ListingForm')
  return render(<ListingForm onSaved={() => {}} />)
}

async function fillAndSubmit() {
  const { container } = await renderForm()
  const inputs = container.querySelectorAll('input')

  // inputs[0] — город, inputs[1] — цена.
  fireEvent.change(inputs[0], { target: { value: 'Казань' } })
  fireEvent.change(inputs[1], { target: { value: '40000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Отправить на модерацию' }))

  await waitFor(() => expect(createListing).toHaveBeenCalledTimes(1))
}

describe('ListingForm премодерация', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('кнопка создания называется «Отправить на модерацию», а не «Опубликовать»', async () => {
    mockDeps()
    await renderForm()

    expect(
      screen.getByRole('button', { name: 'Отправить на модерацию' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull()
  })

  it('после создания показывает, что объявление отправлено на модерацию', async () => {
    mockDeps()
    await fillAndSubmit()

    expect(
      createListing.mock.calls[0][0],
    ).toEqual(
      expect.objectContaining({ city: 'Казань', price: 40000 }),
    )

    const notice = await screen.findByRole('status')
    expect(notice.textContent).toContain('отправлено на модерацию')
    expect(notice.textContent).toContain('общей ленте')
  })
})
