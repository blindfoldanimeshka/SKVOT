import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomCursor } from './CustomCursor'

const POINTER_QUERY = '(hover: hover) and (pointer: fine)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const STYLE_ID = 'custom-cursor-style'

type ChangeHandler = (event: { matches: boolean }) => void

/**
 * Управляемый мок `window.matchMedia`: хранит `matches` по каждому query и
 * подписчиков `change`, поэтому условия можно переключать прямо в рантайме,
 * без перемонтирования компонента.
 */
function createMediaMock(initial: Record<string, boolean> = {}) {
  const values = new Map<string, boolean>(Object.entries(initial))
  const handlers = new Map<string, Set<ChangeHandler>>()

  const matchMedia = vi.fn((query: string): MediaQueryList => {
    if (!values.has(query)) values.set(query, false)
    if (!handlers.has(query)) handlers.set(query, new Set())
    const listeners = handlers.get(query)!

    return {
      media: query,
      get matches() {
        return values.get(query) ?? false
      },
      addEventListener: (_type: string, handler: ChangeHandler) => listeners.add(handler),
      removeEventListener: (_type: string, handler: ChangeHandler) => listeners.delete(handler),
    } as unknown as MediaQueryList
  })

  return {
    matchMedia,
    /**
     * Меняет значение запроса и рассылает `change`.
     * Возвращает число уведомлённых подписчиков — так тест не «пройдёт молча»,
     * если компонент ничего не слушает.
     */
    set(query: string, matches: boolean): number {
      values.set(query, matches)
      const listeners = handlers.get(query) ?? new Set<ChangeHandler>()
      for (const handler of [...listeners]) handler({ matches })
      return listeners.size
    },
    listeners: (query: string) => handlers.get(query)?.size ?? 0,
  }
}

function cursorStyle(): HTMLElement | null {
  return document.getElementById(STYLE_ID)
}

function cursorElement(container: HTMLElement): Element | null {
  return container.querySelector('[aria-hidden="true"]')
}

let media: ReturnType<typeof createMediaMock>

function installMedia(initial: Record<string, boolean>) {
  media = createMediaMock(initial)
  vi.stubGlobal('matchMedia', media.matchMedia)
}

describe('CustomCursor', () => {
  beforeEach(() => {
    cursorStyle()?.remove()
    installMedia({})
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    cursorStyle()?.remove()
  })

  it('ничего не рисует на тач-устройстве (hover: none, pointer: coarse)', () => {
    // Запрос `(hover: hover) and (pointer: fine)` не матчится: values пусты => matches === false.
    installMedia({ [POINTER_QUERY]: false })

    const { container } = render(<CustomCursor />)

    expect(container.firstChild).toBeNull()
    expect(cursorElement(container)).toBeNull()
    expect(cursorStyle()).toBeNull()
  })

  it('ничего не рисует при prefers-reduced-motion, даже с точным указателем', () => {
    installMedia({ [POINTER_QUERY]: true, [REDUCED_MOTION_QUERY]: true })

    const { container } = render(<CustomCursor />)

    expect(container.firstChild).toBeNull()
    expect(cursorStyle()).toBeNull()
  })

  it('рисует курсор и инжектит стиль при точном указателе без reduce-motion', () => {
    installMedia({ [POINTER_QUERY]: true, [REDUCED_MOTION_QUERY]: false })

    expect(cursorStyle()).toBeNull()
    const { container } = render(<CustomCursor />)

    const style = cursorStyle()
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain('cursor: none')

    // Декоративный элемент выведен из дерева доступности.
    const cursor = cursorElement(container)
    expect(cursor).toBeInTheDocument()
    expect(cursor).toHaveAttribute('aria-hidden', 'true')
  })

  it('переключается на смену media-запросов без перемонтирования', () => {
    installMedia({ [POINTER_QUERY]: false, [REDUCED_MOTION_QUERY]: false })

    const { container } = render(<CustomCursor />)
    expect(container.firstChild).toBeNull()
    expect(cursorStyle()).toBeNull()

    // Подключили мышь: компонент сам становится активным.
    act(() => {
      expect(media.set(POINTER_QUERY, true)).toBeGreaterThan(0)
    })
    expect(cursorStyle()).not.toBeNull()
    expect(cursorElement(container)).toBeInTheDocument()

    // Включили reduce-motion: стиль убирается, native cursor возвращается.
    act(() => {
      expect(media.set(REDUCED_MOTION_QUERY, true)).toBeGreaterThan(0)
    })
    expect(cursorStyle()).toBeNull()
    expect(cursorElement(container)).toBeNull()
    expect(container.firstChild).toBeNull()

    // И снова выключили — курсор возвращается на том же экземпляре.
    act(() => {
      expect(media.set(REDUCED_MOTION_QUERY, false)).toBeGreaterThan(0)
    })
    expect(cursorStyle()).not.toBeNull()
    expect(cursorElement(container)).toBeInTheDocument()
  })

  it('снимает подписку на change при размонтировании', () => {
    installMedia({ [POINTER_QUERY]: true })

    const { unmount } = render(<CustomCursor />)
    expect(media.listeners(POINTER_QUERY)).toBe(1)
    expect(media.listeners(REDUCED_MOTION_QUERY)).toBe(1)

    unmount()
    expect(media.listeners(POINTER_QUERY)).toBe(0)
    expect(media.listeners(REDUCED_MOTION_QUERY)).toBe(0)
    expect(cursorStyle()).toBeNull()
  })
})
