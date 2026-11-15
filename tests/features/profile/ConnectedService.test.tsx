import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectedService } from '@/features/profile/components/ConnectedService'
import type { ConnectionStatus } from '@/features/profile/useConnections'

function renderService(
  service: ConnectionStatus,
  onConnect = vi.fn(),
  onUnlink = vi.fn(),
) {
  render(
    <ConnectedService
      service={service}
      onConnect={onConnect}
      onUnlink={onUnlink}
    />,
  )
  return { onConnect, onUnlink }
}

describe('ConnectedService', () => {
  it('shows a «Подключить» button that calls onConnect for a not-connected service', () => {
    const { onConnect, onUnlink } = renderService({
      id: 'google',
      name: 'Google Account',
      connected: false,
    })

    expect(screen.getByText('Google Account')).toBeInTheDocument()
    expect(screen.getByText('Не подключено')).toBeInTheDocument()
    expect(screen.queryByText('Скоро')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /подключить/i }))

    expect(onConnect).toHaveBeenCalledWith('google')
    expect(onUnlink).not.toHaveBeenCalled()
  })

  it('shows a «Отвязать» button that calls onUnlink for a connected service', () => {
    const { onConnect, onUnlink } = renderService({
      id: 'vk',
      name: 'VK',
      connected: true,
    })

    expect(screen.getByText('VK')).toBeInTheDocument()
    expect(screen.getByText('Подключено')).toBeInTheDocument()
    expect(screen.queryByText('Скоро')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /отвязать/i }))

    expect(onUnlink).toHaveBeenCalledWith('vk')
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('renders a «Скоро» badge instead of buttons when disabled', () => {
    const onConnect = vi.fn()
    const onUnlink = vi.fn()
    render(
      <ConnectedService
        service={{ id: 'yandex', name: 'Яндекс', connected: false }}
        onConnect={onConnect}
        onUnlink={onUnlink}
        disabled
      />,
    )

    expect(screen.getByText('Скоро')).toBeInTheDocument()
    expect(screen.getByText('Не подключено')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /подключить/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /отвязать/i }),
    ).not.toBeInTheDocument()
  })
})
