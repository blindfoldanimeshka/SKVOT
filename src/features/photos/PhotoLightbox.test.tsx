import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotoLightbox } from './PhotoLightbox'

const URLS3 = ['/mocks/1.jpg', '/mocks/2.jpg', '/mocks/3.jpg']
const URLS7 = Array.from({ length: 7 }, (_, i) => `/mocks/${i + 1}.jpg`)
const URLS9 = Array.from({ length: 9 }, (_, i) => `/mocks/${i + 1}.jpg`)

let preloaded: string[] = []

class FakeImage {
  decoding = 'async'
  private _src = ''
  set src(url: string) {
    this._src = url
    preloaded.push(url)
  }
  get src() {
    return this._src
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

interface HarnessProps {
  urls?: string[]
  initialIndex?: number
  onIndexChange?: (index: number) => void
  onClose?: () => void
}

/**
 * Родительский wiring как в ListingDetail: index/open живут в родителе,
 * лайтбокс — полностью контролируемый.
 */
function Harness({ urls = URLS3, initialIndex = 0, onIndexChange, onClose }: HarnessProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(initialIndex)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть
      </button>
      <PhotoLightbox
        urls={urls}
        index={index}
        open={open}
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
        onIndexChange={(i) => {
          setIndex(i)
          onIndexChange?.(i)
        }}
        alt="Фото: Москва"
      />
    </>
  )
}

function openLightbox(props: HarnessProps = {}) {
  const result = render(<Harness {...props} />)
  const opener = screen.getByRole('button', { name: 'Открыть' })
  // В реальном браузере клик фокусит кнопку; jsdom — нет, а лайтбокс
  // запоминает именно document.activeElement, чтобы вернуть фокус на закрытие.
  opener.focus()
  fireEvent.click(opener)
  return result
}

interface Point {
  x: number
  y: number
}

function dragOn(el: HTMLElement, from: Point, to: Point, steps = 3, pointerType = 'touch') {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType, clientX: from.x, clientY: from.y, button: 0 })
  for (let i = 1; i <= steps; i++) {
    const p = i / steps
    fireEvent.pointerMove(el, {
      pointerId: 1,
      pointerType,
      clientX: Math.round(from.x + (to.x - from.x) * p),
      clientY: Math.round(from.y + (to.y - from.y) * p),
    })
  }
  fireEvent.pointerUp(el, { pointerId: 1, pointerType, clientX: to.x, clientY: to.y })
}

function tapOn(el: HTMLElement, at: Point, pointerType = 'touch') {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType, clientX: at.x, clientY: at.y, button: 0 })
  fireEvent.pointerUp(el, { pointerId: 1, pointerType, clientX: at.x, clientY: at.y })
}

function stage(): HTMLElement {
  return screen.getByTestId('lightbox-stage')
}

function stubMatchMedia(initial: Record<string, boolean>) {
  const matchMedia = vi.fn((query: string): MediaQueryList => {
    return {
      media: query,
      matches: initial[query] ?? false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList
  })
  vi.stubGlobal('matchMedia', matchMedia)
}

describe('PhotoLightbox', () => {
  it('открытая модалка — диалог с aria-modal и правильным именем', () => {
    openLightbox()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Просмотр фото объявления')
  })

  it('оверлей портальен в document.body и поднят над обвязкой: z-[100] > шапки/дока (z-40)', () => {
    const result = openLightbox()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    // z-[100] перекрывает header z-40, док z-40, тосты z-40, панели z-50.
    expect(dialog).toHaveClass('z-[100]')
    // Портал: узел рендерится НЕ в контейнере RTL-рендера, а прямо в body —
    // иначе предки с transform/backdrop-blur заперли бы его в своём
    // stacking context и шапка лежала бы поверх (баг из живого браузера).
    expect(result.container.contains(dialog)).toBe(false)
    expect(dialog.parentElement).toBe(document.body)
  })

  it('оверлей перекрывает шапку и док в DOM-порядке body (портал — последним)', () => {
    // Декоративно проверяем сам факт портал-в-body: любой контент рендера
    // (кнопка «Открыть») остаётся в контейнере, диалог — вне него.
    const result = openLightbox()
    expect(result.container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true)
  })

  it('затемнение плотное и размытое — фон не просвечивает текстом', () => {
    openLightbox()
    const backdrop = screen.getByTestId('lightbox-backdrop')
    expect(backdrop).toHaveClass('bg-black/96')
    expect(backdrop).toHaveClass('backdrop-blur-sm')
  })

  it('фокус при открытии встаёт на «Закрыть», при закрытии — возвращается на открывший элемент', () => {
    openLightbox()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Открыть' }))
  })

  it('Tab циклится внутри модалки: последняя точка → «Закрыть», Shift+Tab — обратно', () => {
    openLightbox()
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: 'Закрыть' })
    // На нулевом кадре prev отключён и из обхода выпадает: X → next → точки.
    const dots = within(dialog).getAllByRole('button', { name: /^Фото \d+ из 3$/ })
    expect(dots).toHaveLength(3)

    dots[dots.length - 1].focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(dots[dots.length - 1])
  })

  it('счётчик «3 / 7» — моно, приглушённый, в углу', () => {
    openLightbox({ urls: URLS7, initialIndex: 2 })
    const counter = within(screen.getByRole('dialog')).getByText('3 / 7')
    expect(counter).toHaveClass('font-mono')
    expect(counter).toHaveClass('absolute')
    expect(counter.className).toContain('text-white/60')
  })

  it('стрелки: на тач-устройствах скрыты, на десктопе — по hover/focus модалки', () => {
    openLightbox({ initialIndex: 1 })
    for (const name of ['Предыдущее фото', 'Следующее фото']) {
      const arrow = screen.getByRole('button', { name })
      expect(arrow).toHaveClass('pointer-coarse:hidden')
      expect(arrow).toHaveClass('opacity-0')
      expect(arrow).toHaveClass('group-hover/lightbox:opacity-100')
      expect(arrow).toHaveClass('group-focus-within/lightbox:opacity-100')
    }
  })

  it('стрелки на краях выключены: листать некуда (без цикла)', () => {
    openLightbox({ initialIndex: 0 })
    expect(screen.getByRole('button', { name: 'Предыдущее фото' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Следующее фото' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(screen.getByRole('button', { name: 'Следующее фото' })).toBeDisabled()
  })

  it('клавиатура: стрелки листают с ограничением по краям, Escape закрывает', () => {
    const onIndexChange = vi.fn()
    const onClose = vi.fn()
    openLightbox({ initialIndex: 0, onIndexChange, onClose })

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onIndexChange).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onIndexChange).toHaveBeenCalledWith(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('клик по фону закрывает, клик по картинке — нет', () => {
    const onClose = vi.fn()
    openLightbox({ onClose })

    const img = screen.getByRole('img')
    fireEvent.click(img)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('lightbox-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('свайп влево >= 25% ширины переключает кадр', () => {
    const onIndexChange = vi.fn()
    openLightbox({ initialIndex: 1, onIndexChange })

    // 1024 - fallback ширины jsdom; порог 256 px.
    dragOn(stage(), { x: 600, y: 400 }, { x: 300, y: 400 })
    expect(onIndexChange).toHaveBeenCalledWith(2)
  })

  it('свайп обратно к стартовой точке кадр не меняет', () => {
    const onIndexChange = vi.fn()
    openLightbox({ initialIndex: 1, onIndexChange })

    fireEvent.pointerDown(stage(), { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 400, button: 0 })
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 400 })
    fireEvent.pointerMove(stage(), { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 400 })
    fireEvent.pointerUp(stage(), { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 400 })
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('свайп за первый кадр упирается: резистивность, листания нет', () => {
    const onIndexChange = vi.fn()
    openLightbox({ initialIndex: 0, onIndexChange })

    // +400 px вправо гасится до 120 px (< порога) и упирается в край.
    dragOn(stage(), { x: 600, y: 400 }, { x: 1000, y: 400 })
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('свайп вниз > 120 px с инерцией закрывает', () => {
    const onClose = vi.fn()
    openLightbox({ onClose })

    dragOn(stage(), { x: 500, y: 300 }, { x: 500, y: 470 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('короткий свайп вниз — пружина назад, модалка не закрыта', () => {
    const onClose = vi.fn()
    openLightbox({ onClose })

    dragOn(stage(), { x: 500, y: 300 }, { x: 500, y: 340 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('двойной клик — зум, повторный двойной клик — сброс (курсор меняется)', () => {
    openLightbox()
    expect(stage()).toHaveClass('cursor-zoom-in')

    fireEvent.doubleClick(stage())
    expect(stage()).toHaveClass('cursor-zoom-out')

    fireEvent.doubleClick(stage())
    expect(stage()).toHaveClass('cursor-zoom-in')
  })

  it('двойной тап по тачу работает как двойной клик', () => {
    openLightbox()
    tapOn(stage(), { x: 500, y: 400 })
    expect(stage()).toHaveClass('cursor-zoom-in')
    tapOn(stage(), { x: 500, y: 400 })
    expect(stage()).toHaveClass('cursor-zoom-out')
  })

  it('в зуме горизонтальный drag панорамирует, а не листает кадр', () => {
    const onIndexChange = vi.fn()
    openLightbox({ initialIndex: 1, onIndexChange })

    fireEvent.doubleClick(stage())
    dragOn(stage(), { x: 600, y: 400 }, { x: 200, y: 400 })
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it('предзагрузка соседних кадров index±1', () => {
    preloaded = []
    vi.stubGlobal('Image', FakeImage)
    openLightbox({ initialIndex: 1 })
    expect(preloaded).toEqual(expect.arrayContaining([URLS3[0], URLS3[2]]))
  })

  it('на краях предзагрузка не выходит за список', () => {
    preloaded = []
    vi.stubGlobal('Image', FakeImage)
    openLightbox({ initialIndex: 0 })
    expect(preloaded).toEqual([URLS3[1]])
  })

  it('prefers-reduced-motion: листание работает, анимаций нет', () => {
    preloaded = []
    stubMatchMedia({ '(prefers-reduced-motion: reduce)': true })
    const onIndexChange = vi.fn()
    openLightbox({ onIndexChange })

    // Функциональность сохраняется: клавиатура и свайп листают как обычно.
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onIndexChange).toHaveBeenCalledWith(1)

    dragOn(stage(), { x: 600, y: 400 }, { x: 300, y: 400 })
    expect(onIndexChange).toHaveBeenCalledWith(2)

    // Двойной клик-зум не анимируется, но состояние переключает.
    fireEvent.doubleClick(stage())
    expect(stage()).toHaveClass('cursor-zoom-out')
  })

  it('точки-индикаторы проставляют кадр и aria-current (для ≤ 8 фото)', () => {
    const onIndexChange = vi.fn()
    openLightbox({ onIndexChange })
    fireEvent.click(screen.getByRole('button', { name: 'Фото 3 из 3' }))
    expect(onIndexChange).toHaveBeenCalledWith(2)
    expect(screen.getByRole('button', { name: 'Фото 3 из 3' })).toHaveAttribute('aria-current', 'true')
  })

  it('больше 8 фото — точек нет, только счётчик', () => {
    openLightbox({ urls: URLS9 })
    expect(screen.queryByRole('button', { name: /^Фото \d+ из 9$/ })).toBeNull()
    expect(screen.getByText('1 / 9')).toBeInTheDocument()
  })
})
