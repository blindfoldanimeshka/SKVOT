import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/types/database'
import { ListingCard } from './ListingCard'

type ListingRow = Database['public']['Tables']['listings']['Row']

const PHOTOS = ['/mocks/1.jpg', '/mocks/2.jpg', '/mocks/3.jpg']

/** Любой интерактив — его появление внутри другого интерактива и есть дефект. */
const INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, [role="button"]'

function makeListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'l1',
    author_id: 'u1',
    type: 'offer',
    city: 'Москва',
    rooms: '1',
    price: 50000,
    area: 40,
    description: 'Светлая квартира',
    status: 'active',
    address: '',
    lat: null,
    lng: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    is_mock: false,
    org_id: null,
    promoted_until: null,
    ...overrides,
  }
}

function renderCard(listingOverrides: Partial<ListingRow> = {}, photoUrls?: string[]) {
  const onOpen = vi.fn()
  const listing = makeListing(listingOverrides)
  const result = render(<ListingCard listing={listing} onOpen={onOpen} photoUrls={photoUrls} />)
  return { ...result, onOpen, listing }
}

function openButton() {
  return screen.getByRole('button', { name: 'Открыть объявление: Москва' })
}

function cardRoot(container: HTMLElement) {
  return container.firstElementChild as HTMLElement
}

/** Инвариант, из-за которого браузер ронял warning на каждом тесте с лентой. */
function expectNoNestedInteractive(root: HTMLElement) {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))
  expect(nodes.length).toBeGreaterThan(0)
  for (const node of nodes) {
    expect(node.querySelector(INTERACTIVE_SELECTOR)).toBeNull()
  }
}

describe('ListingCard доступность разметки', () => {
  it('корень карточки — article, и ни один интерактив не вложен в другой', () => {
    const { container } = renderCard({}, PHOTOS)
    const root = cardRoot(container)

    expect(root.tagName).toBe('ARTICLE')
    // Сам корень больше не интерактивный контейнер.
    expect(root.matches(INTERACTIVE_SELECTOR)).toBe(false)
    expectNoNestedInteractive(root)
  })

  it('карточка без фото тоже article с единственной кнопкой открытия', () => {
    const { container } = renderCard()
    const root = cardRoot(container)

    expect(root.tagName).toBe('ARTICLE')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expectNoNestedInteractive(root)
  })

  it('открытие карточки — одна кнопка с понятным доступным именем из города', () => {
    renderCard()
    renderCard({ city: 'Казань' })

    expect(screen.getAllByRole('button', { name: /^Открыть объявление:/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Открыть объявление: Москва' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть объявление: Казань' })).toBeInTheDocument()
  })

  it('текст карточки лежит вне кнопки и остаётся читаемым содержимым', () => {
    const { container } = renderCard({}, PHOTOS)

    // Скринридер видит город/цену/описание как текст, а не как подпись кнопки:
    // ни один узел с этими строками не внутри <button>. Браузерный warning
    // «button cannot contain a nested button» появлялся именно потому, что
    // раньше весь этот текст был содержимым кнопки.
    const matchers: Array<string | RegExp> = [
      'Москва',
      '1 комната, 40 м²',
      '50 000 ₽',
      'Светлая квартира',
      'Сдаётся',
    ]
    for (const matcher of matchers) {
      const nodes = screen.getAllByText(matcher)
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node.closest('button')).toBeNull()
      }
    }

    expect(cardRoot(container).querySelector('h3')).toBeTruthy()
    // А кнопка открытия — сиблинг содержимого, а не его родитель.
    expect(openButton().parentElement).toBe(cardRoot(container))
  })

  it('клик по кнопке открытия вызывает onOpen с объявлением', () => {
    const { onOpen, listing } = renderCard({}, PHOTOS)

    fireEvent.click(openButton())

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(listing)
  })

  it('открытие доступно с клавиатуры: нативная кнопка в дефолдном порядке Tab', () => {
    const { container, onOpen } = renderCard({}, PHOTOS)
    const btn = openButton()

    // Нативный <button type="button"> сам превращает Enter/Space в клик, поэтому
    // у карточки нет ни onClick на <article>, ни tabIndex/onKeyDown — ровно то,
    // что запрещено задачей как «полу-интерактивный» элемент.
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).not.toHaveAttribute('tabindex')
    expect(btn).not.toBeDisabled()

    btn.focus()
    expect(document.activeElement).toBe(btn)
    fireEvent.click(btn) // активация, которую браузер делает по Enter
    expect(onOpen).toHaveBeenCalledTimes(1)

    // Порядок обхода: сначала контролы фото, потом открытие карточки.
    const order = Array.from(container.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(order).toEqual([
      'Предыдущее фото',
      'Следующее фото',
      'Фото 1 из 3',
      'Фото 2 из 3',
      'Фото 3 из 3',
      'Открыть объявление: Москва',
    ])
  })

  it('клик по стрелке листает фото и НЕ открывает карточку', () => {
    const { container, onOpen } = renderCard({}, PHOTOS)
    const images = () => Array.from(container.querySelectorAll('img'))

    expect(images()[0]).toHaveAttribute('alt', 'Фото: Москва')

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }))

    expect(onOpen).not.toHaveBeenCalled()
    expect(images()[1]).toHaveAttribute('alt', 'Фото: Москва')
    expect(images()[0]).toHaveAttribute('alt', '')

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее фото' }))

    expect(onOpen).not.toHaveBeenCalled()
    expect(images()[0]).toHaveAttribute('alt', 'Фото: Москва')
  })

  it('клик по точке переключает фото и НЕ открывает карточку', () => {
    const { container, onOpen } = renderCard({}, PHOTOS)

    fireEvent.click(screen.getByRole('button', { name: 'Фото 3 из 3' }))

    expect(onOpen).not.toHaveBeenCalled()
    expect(Array.from(container.querySelectorAll('img'))[2]).toHaveAttribute('alt', 'Фото: Москва')
  })

  it('кнопка открытия не является предком контролов карусели', () => {
    const { container } = renderCard({}, PHOTOS)
    const overlay = openButton()

    for (const control of Array.from(container.querySelectorAll('button')).filter(
      (b) => b !== overlay,
    )) {
      expect(overlay.contains(control)).toBe(false)
      expect(control.contains(overlay)).toBe(false)
    }
  })

  it('оверлей растянут по карточке и лежит над текстом, но под контролами карусели', () => {
    const { container } = renderCard({}, PHOTOS)
    const root = cardRoot(container)
    const overlay = openButton()

    // Без `relative` на корне inset-0 отсчитывался бы от ближайшего
    // позиционированного предка (грид ленты) и оверлей перекрывал бы соседние
    // карточки.
    expect(root).toHaveClass('relative')
    expect(overlay).toHaveClass('absolute', 'inset-0', 'z-20')

    // Контролы фото (z-30) обязаны быть выше оверлея (z-20), иначе клик по ним
    // попадал бы в кнопку открытия.
    expect(screen.getByRole('button', { name: 'Следующее фото' })).toHaveClass('z-30')
    expect(screen.getByRole('button', { name: 'Предыдущее фото' })).toHaveClass('z-30')
    const dotsStrip = screen.getByRole('button', { name: 'Фото 1 из 3' })
      .parentElement as HTMLElement
    expect(dotsStrip).toHaveClass('z-30')
    expect(dotsStrip).toHaveClass('pointer-events-none')
  })

  it('бейдж MOCK и тип «Ищут» по-прежнему на месте', () => {
    renderCard({ is_mock: true, type: 'request' })

    expect(screen.getByText('MOCK')).toBeInTheDocument()
    expect(screen.getByText('Ищут')).toBeInTheDocument()
  })
})
