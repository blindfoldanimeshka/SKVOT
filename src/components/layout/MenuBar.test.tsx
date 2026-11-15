import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MenuBar, type MenuBarItem } from './MenuBar'

// Иконка — заглушка: svg, размеры прокидываются как в реальных иконках проекта.
function TestIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      className={className}
      data-testid={`icon-${size ?? 'na'}`}
    />
  )
}

const ITEMS: MenuBarItem[] = [
  { key: 'home', label: 'Поиск', icon: TestIcon, active: true },
  { key: 'new', label: 'Новое', icon: TestIcon },
  { key: 'chats', label: 'Чаты', icon: TestIcon },
  { key: 'profile', label: 'Профиль', icon: TestIcon },
]

afterEach(() => cleanup())

describe('MenuBar «Рейка»', () => {
  it('рендерит все пункты с доступными именами и отмечает активный aria-current="page"', () => {
    render(<MenuBar items={ITEMS} />)

    for (const item of ITEMS) {
      const button = screen.getByRole('button', { name: item.label })
      expect(button).toBeInTheDocument()
      if (item.active) {
        expect(button).toHaveAttribute('aria-current', 'page')
      } else {
        expect(button).not.toHaveAttribute('aria-current')
      }
    }
  })

  it('клик по пункту вызывает onSelect с его ключом', () => {
    const onSelect = vi.fn()
    render(<MenuBar items={ITEMS} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Чаты' }))
    expect(onSelect).toHaveBeenCalledWith('chats')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('показывает бейдж с числом и сворачивает в 99+ при превышении', () => {
    const { rerender } = render(
      <MenuBar items={ITEMS.map((i) => (i.key === 'chats' ? { ...i, badge: 5 } : i))} />,
    )
    expect(screen.getByText('5')).toBeInTheDocument()

    rerender(
      <MenuBar items={ITEMS.map((i) => (i.key === 'chats' ? { ...i, badge: 137 } : i))} />,
    )
    expect(screen.getByText('99+')).toBeInTheDocument()
    expect(screen.queryByText('137')).not.toBeInTheDocument()
  })

  it('в compact подписи не рендерятся, иконки и кнопки остаются', () => {
    const { container } = render(<MenuBar items={ITEMS} compact />)

    for (const item of ITEMS) {
      expect(screen.queryByText(item.label)).not.toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: /Поиск|Новое|Чаты|Профиль/ })).toHaveLength(4)
    expect(container.querySelectorAll('[data-dock-icon]')).toHaveLength(ITEMS.length)
  })

  it('полоса красится токеном --dock-bg (почти непрозрачная) и имеет «подъём» над собой', () => {
    const { container } = render(<MenuBar items={ITEMS} />)

    const bar = container.querySelector('.dock-bar')
    expect(bar).not.toBeNull()
    // Прежняя полупрозрачная подложка — причина просвечивания, её быть не должно.
    expect(bar?.className).not.toContain('bg-surface/85')
    expect(bar?.className).toContain('backdrop-blur-xl')

    // «Подъём» (24px градиент) — сосед над полосой: контент не обрывается кромкой.
    const lift = container.querySelector('.dock-lift')
    expect(lift).not.toBeNull()
    expect(lift?.nextElementSibling).toBe(bar)
  })
})
