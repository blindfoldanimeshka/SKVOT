import { useEffect, useState, type RefObject } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function supportsMatchMedia(): boolean {
  // jsdom (тесты) и старые окружения matchMedia не имеют — хук должен деградировать в false.
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

/** Живая подписка на media query: значение обновляется без перемонтирования. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    supportsMatchMedia() ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    if (!supportsMatchMedia()) return
    const list = window.matchMedia(query)
    // Перечитать: значение могло измениться между рендером и эффектом.
    setMatches(list.matches)
    if (typeof list.addEventListener !== 'function') return
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}

/**
 * Видим ли элемент во вьюпорте (порог `threshold`). Начальное значение — true:
 * автопрокрутка стартует сразу, IntersectionObserver поправит его на первом же
 * наблюдении. Без IO (SSR, jsdom-stub) остаётся true.
 */
export function useInView(ref: RefObject<HTMLElement | null>, threshold = 0.1): boolean {
  const [inView, setInView] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold])

  return inView
}

/**
 * Предзагрузка кадра через отдельный Image(): картинка попадает в HTTP-кэш ещё
 * до того, как станет активной, и переключение идёт без белой вспышки.
 */
export function preloadImage(url: string | undefined): void {
  if (!url) return
  const img = new Image()
  img.decoding = 'async'
  img.src = url
}

/** Оба соседа (index-1, index±1 в пределах списка) — для лайтбокса без цикла. */
export function preloadNeighbours(urls: string[], index: number): void {
  preloadImage(urls[index - 1])
  preloadImage(urls[index + 1])
}

/** Следующий кадр по кругу — карусели листаются с wrap. */
export function preloadNext(urls: string[], index: number): void {
  if (urls.length === 0) return
  preloadImage(urls[(index + 1) % urls.length])
}
