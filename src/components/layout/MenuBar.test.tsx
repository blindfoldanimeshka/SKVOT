import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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

/**
 * Мок matchMedia под motion 12. `useReducedMotion()` читает «голый» запрос
 * `(prefers-reduced-motion)` и подписывается на `change` ровно ОДИН раз на
 * время жизни модуля (значение кешируется в самом motion), поэтому мок
 * создаётся на весь файл, а не на тест: подписчик переживает перестановку
 * global, `set()` рассылает смену, а afterEach возвращает «движение разрешено».
 * Заодно `set()` возвращает число подписчиков — тест не «пройдёт молча», если
 * motion вдруг перестанет спрашивать систему.
 */
const REDUCED_MOTION_QUERY = 'prefers-reduced-motion'

function createReducedMotionMock() {
  const listeners = new Set<(event: { matches: boolean }) => void>()
  let matches = false

  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const reduced = query.includes(REDUCED_MOTION_QUERY)
    return {
      media: query,
      get matches() {
        return reduced && matches
      },
      addEventListener: (_type: string, handler: (event: { matches: boolean }) => void) => {
        if (reduced) listeners.add(handler)
      },
      removeEventListener: (_type: string, handler: (event: { matches: boolean }) => void) => {
        listeners.delete(handler)
      },
    } as unknown as MediaQueryList
  })

  return {
    matchMedia,
    set(value: boolean): number {
      matches = value
      for (const handler of [...listeners]) handler({ matches: value })
      return listeners.size
    },
  }
}

const media = createReducedMotionMock()

/**
 * Рисует MenuBar «вхолостую», чтобы motion успел подписаться на mock, и
 * отдаёт управление prefers-reduced-motion. Вызывается перед переключением.
 */
function armReducedMotion(): void {
  const { unmount } = render(<MenuBar items={ITEMS} />)
  unmount()
  // Подписчик обязан быть: иначе мок никто не слушает и проверка пуста.
  expect(media.set(true)).toBeGreaterThan(0)
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', media.matchMedia)
})

afterEach(() => {
  media.set(false)
  cleanup()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

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

describe('MenuBar: микроанимации', () => {
  it('pointerdown сжимает иконку до 0.88 с проседанием, pointerup снимает сжатие', async () => {
    render(<MenuBar items={ITEMS} />)
    const button = screen.getByRole('button', { name: 'Новое' })
    const icon = button.querySelector('[data-dock-icon]') as HTMLElement
    const press = button.querySelector('[data-dock-press]') as HTMLElement
    expect(icon).toBeTruthy()
    expect(press).toBeTruthy()
    expect(icon).not.toHaveAttribute('data-pressed')

    fireEvent.pointerDown(button, { pointerType: 'mouse', button: 0 })
    expect(icon).toHaveAttribute('data-pressed', 'true')

    // Цель пружины — scale 0.88 + translateY(-1px). motion дописывает
    // inline-transform на кадрах rAF, поэтому ждём оба факта в одном проверочном
    // прогоне (иначе можно снять кадр, где scale уже, а y ещё в пути).
    await waitFor(() => {
      expect(press.style.transform).toMatch(/scale\(0\.8\d*\)/)
      expect(press.style.transform).toMatch(/translateY\(-1px\)/)
    })

    fireEvent.pointerUp(button)
    expect(icon).not.toHaveAttribute('data-pressed')
    // Отпускание — не «отлипание» по таймеру: та же пружина (stiffness 500,
    // damping 22) проходит через overshoot и оседает на scale 1, то есть
    // motion оставляет transform в состоянии «none».
    await waitFor(() => {
      expect(press.style.transform || 'none').toBe('none')
    })
  })

  it('pointerdown не сжимает иконку правой кнопкой мыши', () => {
    render(<MenuBar items={ITEMS} />)
    const button = screen.getByRole('button', { name: 'Новое' })
    const icon = button.querySelector('[data-dock-icon]') as HTMLElement

    fireEvent.pointerDown(button, { pointerType: 'mouse', button: 2 })
    expect(icon).not.toHaveAttribute('data-pressed')
  })

  it('тап не ломает выбор: pointerdown → pointerup → click даёт один onSelect', () => {
    const onSelect = vi.fn()
    render(<MenuBar items={ITEMS} onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: 'Профиль' })

    fireEvent.pointerDown(button, { pointerType: 'touch' })
    fireEvent.pointerUp(button, { pointerType: 'touch' })
    fireEvent.click(button)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('profile')
  })

  it('смена активного пункта сохраняет aria-current и точку-индикатор ровно одну', async () => {
    const { container, rerender } = render(<MenuBar items={ITEMS} />)
    const next = ITEMS.map((item) => ({ ...item, active: item.key === 'chats' }))

    expect(screen.getByRole('button', { name: 'Поиск' })).toHaveAttribute('aria-current', 'page')

    rerender(<MenuBar items={next} />)

    expect(screen.getByRole('button', { name: 'Чаты' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Поиск' })).not.toHaveAttribute('aria-current')
    for (const item of ITEMS) {
      expect(screen.getByRole('button', { name: item.label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Чаты' })).toHaveAccessibleName('Чаты')

    // Точка-индикатор: старая доезжает exit (scale → 0), поэтому сразу после
    // смены их две, а после завершения — ровно одна и у активного пункта.
    await waitFor(() => {
      expect(container.querySelectorAll('[data-dock-dot]')).toHaveLength(1)
    })
    const dot = container.querySelector('[data-dock-dot]') as HTMLElement
    expect(dot.closest('button')).toBe(screen.getByRole('button', { name: 'Чаты' }))
    // Скоба не теряет геометрию и остаётся скрытой от AT.
    const bracket = container.querySelector('[data-dock-bracket]')
    expect(bracket).not.toBeNull()
    expect(bracket).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('[data-dock-bracket]')).toHaveLength(1)
  })

  it('дёргивает navigator.vibrate(8) при активации, если API есть', () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
      writable: true,
    })

    try {
      const onSelect = vi.fn()
      render(<MenuBar items={ITEMS} onSelect={onSelect} />)
      fireEvent.click(screen.getByRole('button', { name: 'Чаты' }))

      expect(vibrate).toHaveBeenCalledWith(8)
      expect(onSelect).toHaveBeenCalledWith('chats')
    } finally {
      delete (navigator as unknown as { vibrate?: unknown }).vibrate
    }
  })
})

describe('MenuBar: prefers-reduced-motion', () => {
  it('не сжимает иконку и не оставляет анимационных стилей на декоративных слоях', async () => {
    armReducedMotion()
    const { container } = render(
      <MenuBar items={ITEMS.map((i) => (i.key === 'chats' ? { ...i, badge: 3 } : i))} />,
    )

    const button = screen.getByRole('button', { name: 'Новое' })
    const icon = button.querySelector('[data-dock-icon]') as HTMLElement
    const press = button.querySelector('[data-dock-press]') as HTMLElement

    fireEvent.pointerDown(button, { pointerType: 'touch' })
    expect(icon).not.toHaveAttribute('data-pressed')

    // Парой кадров rAF даём пружине «проявиться»: в обычном режиме на этом
    // месте transform уже был бы scale(0.8x) — здесь слой остаётся без него.
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
    })
    expect(press.style.transform || 'none').toBe('none')

    // Слои, чей transform — только украшение (скоба в списке отсутствует:
    // она через x/width ЕДЕТ, это позиционирование, а не анимация).
    const fx = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-dock-press],[data-dock-pop],[data-dock-label],[data-dock-badge],' +
          '[data-dock-dot],[data-dock-bracket-frame],[data-dock-lip]',
      ),
    ]
    expect(fx.length).toBeGreaterThan(0)
    for (const el of fx) {
      expect(el.className).not.toMatch(/transition-/)
      expect(el.style.transform || 'none').toBe('none')
    }

    // Состояние при этом живое: активный пункт помечен, точка на месте.
    expect(screen.getByRole('button', { name: 'Поиск' })).toHaveAttribute('aria-current', 'page')
    expect(container.querySelectorAll('[data-dock-dot]')).toHaveLength(1)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('переключение активного пункта остаётся мгновенным: без pop и без «уходящей» точки', () => {
    armReducedMotion()
    const { container, rerender } = render(<MenuBar items={ITEMS} />)

    rerender(<MenuBar items={ITEMS.map((item) => ({ ...item, active: item.key === 'new' }))} />)

    expect(screen.getByRole('button', { name: 'Новое' })).toHaveAttribute('aria-current', 'page')
    // Exit-анимации нет: Presence не монтирует AnimatePresence, поэтому старая
    // точка исчезает в том же кадре — без waitFor и без «двух точек».
    expect(container.querySelectorAll('[data-dock-dot]')).toHaveLength(1)
    const layers = [
      ...container.querySelectorAll<HTMLElement>('[data-dock-pop],[data-dock-press]'),
    ]
    expect(layers.length).toBeGreaterThan(0)
    for (const el of layers) {
      expect(el.style.transform || 'none').toBe('none')
    }
  })
})
