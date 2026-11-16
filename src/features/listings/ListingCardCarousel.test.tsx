import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListingCardCarousel } from './ListingCardCarousel'

const URLS = ['/mocks/1.jpg', '/mocks/2.jpg', '/mocks/3.jpg']

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

beforeEach(() => {
  preloaded = []
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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

function renderCarousel(urls: string[] = URLS) {
  const result = render(<ListingCardCarousel urls={urls} alt="Фото: Москва" />)
  return { ...result, images: () => Array.from(result.container.querySelectorAll('img')) }
}

function activeImageIndex(images: HTMLImageElement[]) {
  return images.findIndex((img) => img.getAttribute('alt') === 'Фото: Москва')
}

describe('ListingCardCarousel', () => {
  it('не рендерит ничего для пустого списка фото', () => {
    const { container } = renderCarousel([])

    expect(container).toBeEmptyDOMElement()
  })

  it('на одном фото нет стрелок и точек — нечего листать', () => {
    renderCarousel([URLS[0]])

    expect(screen.queryByRole('button', { name: 'Следующее фото' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Фото \d+ из 1$/ })).toBeNull()
  })

  it('стрелки листают по кругу', () => {
    const { images } = renderCarousel()

    expect(activeImageIndex(images())).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(activeImageIndex(images())).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее фото' }))
    expect(activeImageIndex(images())).toBe(0)

    // Из первого шага назад — перелистываемся в последний слайд.
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее фото' }))
    expect(activeImageIndex(images())).toBe(2)
  })

  it('точки ставят нужный слайд и отмечают активную через aria-current', () => {
    const { images } = renderCarousel()

    fireEvent.click(screen.getByRole('button', { name: 'Фото 2 из 3' }))

    expect(activeImageIndex(images())).toBe(1)
    expect(screen.getByRole('button', { name: 'Фото 2 из 3' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Фото 1 из 3' })).toHaveAttribute(
      'aria-current',
      'false',
    )
  })

  it('неактивные слайды скрыты от скринридера и не имеют alt', () => {
    const { images, container } = renderCarousel()
    const slides = Array.from(container.querySelectorAll('div[aria-hidden]'))

    expect(images()[0]).toHaveAttribute('alt', 'Фото: Москва')
    expect(images()[1]).toHaveAttribute('alt', '')
    expect(images()[2]).toHaveAttribute('alt', '')
    expect(slides).toHaveLength(3)
    expect(slides.filter((slide) => slide.getAttribute('aria-hidden') === 'true')).toHaveLength(2)
  })

  it('стрелки показываются по ховеру всей карточки, а не только контейнера карусели', () => {
    renderCarousel()

    // Кнопка-оверлей «Открыть объявление» лежит выше фото, поэтому наведение
    // мыши в области фото приходит на оверлей, а не на group/carousel. Без
    // группового ховер-класса карточки стрелки остались бы навсегда opacity-0.
    for (const name of ['Предыдущее фото', 'Следующее фото']) {
      const arrow = screen.getByRole('button', { name })
      expect(arrow).toHaveClass('opacity-0')
      expect(arrow).toHaveClass('group-hover:opacity-100')
      expect(arrow).toHaveClass('group-hover/carousel:opacity-100')
    }
  })

  it('контролы лежат выше кнопки-оверлея карточки и не перекрывают её клики', () => {
    renderCarousel()

    // z-30 против z-20 у кнопки «Открыть объявление» в ListingCard: иначе клик по
    // стрелке/точке открывал бы детальный экран вместо листания фото.
    const arrows = [
      screen.getByRole('button', { name: 'Предыдущее фото' }),
      screen.getByRole('button', { name: 'Следующее фото' }),
    ]
    for (const arrow of arrows) {
      expect(arrow).toHaveClass('z-30')
      expect(arrow).toHaveAttribute('type', 'button')
    }

    // Полоса точек тянется на всю ширину: она не ловит клики, иначе оставалась бы
    // «мёртвую» полосу над фото, по которой карточка не открывалась.
    const dotButtons = [1, 2, 3].map((n) =>
      screen.getByRole('button', { name: `Фото ${n} из 3` }),
    )
    const strip = dotButtons[0].parentElement as HTMLElement
    expect(strip).toHaveClass('z-30', 'pointer-events-none')
    for (const dot of dotButtons) {
      expect(dot).toHaveClass('pointer-events-auto')
      expect(dot).toHaveAttribute('type', 'button')
    }
  })

  it('стрелки скрыты на мобильном: там свайп', () => {
    renderCarousel()

    for (const name of ['Предыдущее фото', 'Следующее фото']) {
      const arrow = screen.getByRole('button', { name })
      expect(arrow).toHaveClass('max-sm:hidden')
    }
  })

  it('предзагрузка следующего кадра по кругу', () => {
    renderCarousel()
    expect(preloaded).toContain(URLS[1])

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(preloaded).toContain(URLS[2])

    // Последний кадр: следующий снова первый — карусель ходит кругом.
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(preloaded).toContain(URLS[0])
  })

  it('свайп >= 25% ширины переключает ближайший кадр', () => {
    const { images } = renderCarousel()
    const track = screen.getByTestId('carousel-track')

    dragOn(track, { x: 600, y: 200 }, { x: 290, y: 200 })
    expect(activeImageIndex(images())).toBe(1)

    dragOn(track, { x: 290, y: 200 }, { x: 700, y: 200 })
    expect(activeImageIndex(images())).toBe(0)
  })

  it('свайп за край списка не заворачивается: резистивность вместо wrap', () => {
    const { images } = renderCarousel()
    const track = screen.getByTestId('carousel-track')

    // Доезжаем до последнего кадра стрелками…
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))
    expect(activeImageIndex(images())).toBe(2)

    // …и тянем влево: за последним кадром листать некуда.
    dragOn(track, { x: 600, y: 200 }, { x: 100, y: 200 })
    expect(activeImageIndex(images())).toBe(2)
  })

  it('свайп назад к стартовой точке кадр не меняет', () => {
    const { images } = renderCarousel()
    const track = screen.getByTestId('carousel-track')

    fireEvent.pointerDown(track, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200, button: 0 })
    fireEvent.pointerMove(track, { pointerId: 1, pointerType: 'touch', clientX: 400, clientY: 200 })
    fireEvent.pointerMove(track, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200 })
    fireEvent.pointerUp(track, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 200 })
    expect(activeImageIndex(images())).toBe(0)
  })
})
