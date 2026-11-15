import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionsTab } from '@/features/profile/components/ConnectionsTab'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useConnections as _useConnections } from '@/features/profile/useConnections'

const baseConnections = [
  { id: 'google', name: 'Google Account', connected: true },
  { id: 'apple', name: 'Apple ID', connected: false },
  { id: 'yandex', name: 'Яндекс', connected: false },
  { id: 'vk', name: 'VK', connected: false },
  { id: 'telegram', name: 'Telegram', connected: false },
]

let currentReturn: Record<string, unknown> = {}

vi.mock('@/features/profile/useConnections', () => ({
  useConnections: () => currentReturn as never,
  CONNECTION_PROVIDERS: [
    { id: 'google', name: 'Google Account', native: true },
    { id: 'apple', name: 'Apple ID', native: true },
    { id: 'yandex', name: 'Яндекс', native: true },
    { id: 'vk', name: 'VK', native: true },
    { id: 'telegram', name: 'Telegram', native: false },
  ],
}))

// Заметка про пробел в покрытии: связка `setUnlinkTarget` → ConfirmDialog → `unlink(id)`
// здесь не покрыта — провайдеры в ConnectionsTab захардкожены `disabled`, путь мёртв.
// Тест на «Отвязать → подтверждение → unlink» нужно добавить при включении OAuth-провайдеров.

describe('ConnectionsTab', () => {
  it('renders the heading and service names', () => {
    currentReturn = {
      connections: baseConnections,
      loading: false,
      connecting: null,
      error: null,
      refresh: vi.fn(),
      link: vi.fn(),
      unlink: vi.fn(),
    }
    render(<ConnectionsTab />)
    expect(screen.getByText(/подключённые сервисы/i)).toBeInTheDocument()
    expect(screen.getByText(/google account/i)).toBeInTheDocument()
    expect(screen.getByText(/apple id/i)).toBeInTheDocument()
    expect(screen.getByText(/яндекс/i)).toBeInTheDocument()
    expect(screen.getByText(/vk/i)).toBeInTheDocument()
  })

  it('shows statuses and «Скоро» badges instead of buttons while providers are not configured', () => {
    currentReturn = {
      connections: baseConnections,
      loading: false,
      connecting: null,
      error: null,
      refresh: vi.fn(),
      link: vi.fn(),
      unlink: vi.fn(),
    }
    render(<ConnectionsTab />)

    // 4 строки в основном списке: telegram исключён и рендерится отдельным блоком
    expect(screen.getAllByTestId('service-row')).toHaveLength(4)

    // статусы вместо кнопок: google подключён, остальные — нет
    expect(screen.getByText('Подключено')).toBeInTheDocument()
    expect(screen.getAllByText('Не подключено')).toHaveLength(3)

    // бейдж «Скоро»: 4 в основном списке + 1 в блоке Telegram
    expect(screen.getAllByText('Скоро')).toHaveLength(5)

    // кнопок привязки/отвязки нет
    expect(
      screen.queryByRole('button', { name: /подключить/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /отвязать/i }),
    ).not.toBeInTheDocument()
  })

  it('renders Telegram as a separate block and never opens the unlink dialog', () => {
    const unlink = vi.fn()
    currentReturn = {
      connections: baseConnections,
      loading: false,
      connecting: null,
      error: null,
      refresh: vi.fn(),
      link: vi.fn(),
      unlink,
    }
    render(<ConnectionsTab />)

    // отдельный блок Telegram: заголовок и своё имя вне основного списка
    expect(
      screen.getByRole('heading', { name: /telegram/i }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Telegram')).toHaveLength(2) // заголовок + строка блока

    const rows = screen.getAllByTestId('service-row')
    expect(rows).toHaveLength(4)
    expect(
      rows.every((row) => !row.textContent?.includes('Telegram')),
    ).toBe(true)

    // кнопок «Отвязать» нет — диалог подтверждения не открывается, unlink не вызывается
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('surfaces an error message', () => {
    currentReturn = {
      connections: baseConnections,
      loading: false,
      connecting: null,
      error: 'Что-то пошло не так',
      refresh: vi.fn(),
      link: vi.fn(),
      unlink: vi.fn(),
    }
    render(<ConnectionsTab />)
    expect(screen.getByRole('alert')).toHaveTextContent(/что-то пошло не так/i)
  })
})
