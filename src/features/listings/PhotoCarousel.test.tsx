import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoCarousel } from './PhotoCarousel'

const URLS = ['/mocks/1.jpg', '/mocks/2.jpg', '/mocks/3.jpg']
const ALT = 'Фото: Москва'

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

/** Управляемый IntersectionObserver: тест сам решает, «виден» ли компонент. */
let observers: FakeIO[] = []

class FakeIO {
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
    observers.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  emit(isIntersecting: boolean): void {
    this.cb([{ isIntersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

beforeEach(() => {
  preloaded = []
  observers = []
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('IntersectionObserver', FakeIO)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderCarousel(props: Parameters<typeof PhotoCarousel>[0]) {
  const result = render(<PhotoCarousel {...props} />)
  const images = Array.from(result.container.querySelectorAll('img'))
  const activeIndex = () => images.findIndex((img) => img.getAttribute('alt') === ALT)
  const root = result.container.firstElementChild as HTMLElement
  const track = result.getByTestId('carousel-track')
  return { ...result, images, activeIndex, root, track }
}

interface Point {
  x: number
  y: number
}

function dragOn(el: HTMLElement, from: Point, to: Point, steps = 3) {
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: from.x, clientY: from.y, button: 0 })
  for (let i = 1; i <= steps; i++) {
    const p = i / steps
    fireEvent.pointerMove(el, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: Math.round(from.x + (to.x - from.x) * p),
      clientY: Math.round(from.y + (to.y - from.y) * p),
    })
  }
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: to.x, clientY: to.y })
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('PhotoCarousel', () => {
  it('автослайд листает каждые 6 с, пока компонент во вьюпорте', async () => {
    vi.useFakeTimers()
    const { activeIndex } = renderCarousel({ urls: URLS, alt: ALT })
    expect(activeIndex()).toBe(0)

    await tick(6000)
    expect(activeIndex()).toBe(1)
  })

  it('вне вьюпорта автослайд останавливается, при возврате — продолжается', async () => {
    vi.useFakeTimers()
    const { activeIndex } = renderCarousel({ urls: URLS, alt: ALT })

    await tick(6000)
    expect(activeIndex()).toBe(1)

    act(() => observers[0].emit(false))
    await tick(18000)
    expect(activeIndex()).toBe(1)

    act(() => observers[0].emit(true))
    await tick(6000)
    expect(activeIndex()).toBe(2)
  })

  it('на ховере автослайд на паузе', async () => {
    vi.useFakeTimers()
    const { activeIndex, root } = renderCarousel({ urls: URLS, alt: ALT })

    fireEvent.mouseEnter(root)
    await tick(18000)
    expect(activeIndex()).toBe(0)

    fireEvent.mouseLeave(root)
    await tick(6000)
    expect(activeIndex()).toBe(1)
  })

  it('prefers-reduced-motion: автослайд полностью отключён, стрелки работают', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
      media: query,
      matches: query.includes('reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList))
    vi.useFakeTimers()

    const { activeIndex } = renderCarousel({ urls: URLS, alt: ALT })
    await tick(30000)
    expect(activeIndex()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(activeIndex()).toBe(1)
  })

  it('стрелки скрыты на мобильном (там свайп), показаны по hover на десктопе', () => {
    renderCarousel({ urls: URLS, alt: ALT })
    for (const name of ['Предыдущее фото', 'Следующее фото']) {
      const arrow = screen.getByRole('button', { name })
      expect(arrow).toHaveClass('max-sm:hidden')
      expect(arrow).toHaveClass('opacity-0')
      expect(arrow).toHaveClass('group-hover/carousel:opacity-100')
    }
  })

  it('предзагрузка следующего кадра по кругу', () => {
    const { images } = renderCarousel({ urls: URLS, alt: ALT })
    expect(preloaded).toContain(URLS[1])

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(preloaded).toContain(URLS[2])

    // Последний кадр — следующий снова первый (автослайд и стрелки ходят кругом).
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(images.length).toBe(3)
    expect(preloaded).toContain(URLS[0])
  })

  it('свайп >= 25% ширины переключает ближайший кадр, обратно — тоже', () => {
    const { activeIndex, track } = renderCarousel({ urls: URLS, alt: ALT })

    dragOn(track, { x: 600, y: 200 }, { x: 290, y: 200 })
    expect(activeIndex()).toBe(1)

    dragOn(track, { x: 290, y: 200 }, { x: 700, y: 200 })
    expect(activeIndex()).toBe(0)
  })

  it('за край списка свайп не заворачивается: резистивность вместо wrap', () => {
    const { activeIndex, track } = renderCarousel({ urls: URLS, alt: ALT })

    dragOn(track, { x: 200, y: 200 }, { x: 800, y: 200 })
    expect(activeIndex()).toBe(0)
  })

  it('свайп назад к стартовой точке кадр не меняет', () => {
    const { activeIndex, track } = renderCarousel({ urls: URLS, alt: ALT })

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200, button: 0 })
    fireEvent.pointerMove(track, { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 200 })
    fireEvent.pointerMove(track, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200 })
    fireEvent.pointerUp(track, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200 })
    expect(activeIndex()).toBe(0)
  })

  it('клик по дорожке открывает лайтбокс даже при pointer capture (регрессия браузерного клика)', () => {
    const onImageClick = vi.fn()
    const capture = vi.fn()
    const { track, images } = renderCarousel({ urls: URLS, alt: ALT, onImageClick })

    // В реальном браузере pointerdown вызывает setPointerCapture на дорожке,
    // и click ретаргетится на захвативший элемент — на img он бы не пришёл.
    // В jsdom capture нет, поэтому мок ставим вручную и шлём click именно
    // на дорожку, как это делает браузер.
    track.setPointerCapture = capture

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 200, button: 0 })
    expect(capture).toHaveBeenCalledWith(1)
    fireEvent.pointerUp(track, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 200 })

    // Ретаргетный клик на дорожке — обработчик там же, лайтбокс открывается.
    fireEvent.click(track)
    expect(onImageClick).toHaveBeenCalledWith(0)

    // И обычный клик по img тоже работает — он всплывает до дорожки.
    onImageClick.mockClear()
    fireEvent.click(images[0])
    expect(onImageClick).toHaveBeenCalledWith(0)
  })

  it('свайп >= 25% переключает кадр, а «клик» после него лайтбокс не открывает', () => {
    const onImageClick = vi.fn()
    const { activeIndex, track } = renderCarousel({ urls: URLS, alt: ALT, onImageClick })

    dragOn(track, { x: 600, y: 200 }, { x: 250, y: 200 })
    expect(activeIndex()).toBe(1)
    // Браузер после pointerup шлёт click (на дорожку из-за capture) — moved-guard обязан его съесть.
    fireEvent.click(track)
    expect(onImageClick).not.toHaveBeenCalled()

    // Тап без смечения снова «виден» как клик.
    fireEvent.pointerDown(track, { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 200, button: 0 })
    fireEvent.pointerUp(track, { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 200 })
    fireEvent.click(track)
    expect(onImageClick).toHaveBeenCalledWith(1)
  })

  it('стрелки и точки листают сами и не дёргают onImageClick', () => {
    const onImageClick = vi.fn()
    const { activeIndex } = renderCarousel({ urls: URLS, alt: ALT, onImageClick })

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    fireEvent.click(screen.getByRole('button', { name: 'Фото 3 из 3' }))
    expect(activeIndex()).toBe(2)
    expect(onImageClick).not.toHaveBeenCalled()
  })

  it('сохраняет исходные aria-контракты: alt только у активного слайда', () => {
    const { images } = renderCarousel({ urls: URLS, alt: ALT })
    expect(images[0]).toHaveAttribute('alt', ALT)
    expect(images[1]).toHaveAttribute('alt', '')
    expect(images[2]).toHaveAttribute('alt', '')
    for (const img of images) {
      expect(img).toHaveAttribute('decoding', 'async')
    }
  })
})
