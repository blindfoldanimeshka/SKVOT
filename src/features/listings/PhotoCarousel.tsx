import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { preloadNext, useInView, usePrefersReducedMotion } from '@/features/photos/media'
import { useCarouselDrag } from './useCarouselDrag'

interface PhotoCarouselProps {
  urls: string[]
  alt: string
  onImageClick?: (index: number) => void
  className?: string
}

export function PhotoCarousel({ urls, alt, onImageClick, className = '' }: PhotoCarouselProps) {
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const count = urls.length
  const reducedMotion = usePrefersReducedMotion()
  const inView = useInView(rootRef)
  const { x, dragging, moved, handlers } = useCarouselDrag({
    count,
    index,
    onIndexChange: setIndex,
    reducedMotion,
    containerRef: rootRef,
  })

  // Стрелки и автопрокрутка листаются по кругу — поведение исходное.
  function prev() {
    setIndex((i) => (i === 0 ? count - 1 : i - 1))
  }

  function next() {
    setIndex((i) => (i === count - 1 ? 0 : i + 1))
  }

  // Автослайд каждые 6 с: пауза при ховере и свайпе, остановка вне вьюпорта,
  // полное отключение при prefers-reduced-motion.
  useEffect(() => {
    if (count <= 1 || reducedMotion || !inView) return
    const timer = setInterval(() => {
      if (hovered || dragging.current) return
      setIndex((i) => (i === count - 1 ? 0 : i + 1))
    }, 6000)
    return () => clearInterval(timer)
  }, [count, reducedMotion, inView, hovered, dragging])

  // Предзагрузка следующего кадра: переключение без белой вспышки.
  useEffect(() => {
    preloadNext(urls, index)
  }, [urls, index])

  // Клик живёт на ДОРОЖКЕ, а не на <img>: pointerdown вызывает
  // setPointerCapture на дорожке, и реальный браузер ретаргетит последующий
  // click на захвативший элемент — на img он бы уже не пришёл (jsdom capture
  // не реализует, поэтому тесты с onClick на img проходили, а в браузере клик
  // терялся). На дорожке обработчику безразлично, кто был целью: событие всё
  // равно приземляется на неё. Клик с img (без capture-ретаргета) сюда тоже
  // доходит через всплытие.
  function handleTrackClick() {
    // Клик после свайпа — не выбор фото.
    if (moved.current) return
    if (onImageClick) {
      onImageClick(index)
    }
  }

  if (count === 0) return null

  return (
    <div
      ref={rootRef}
      className={`group/carousel relative w-full overflow-hidden ${className}`}
      role="group"
      aria-roledescription="carousel"
      aria-label="Фото объявления"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Track: motion-dx через Pointer Events, snap пружиной (useCarouselDrag).
          touch-action: pan-y — вертикаль остаётся браузеру (скролл страницы).
          onClick здесь же (см. handleTrackClick) — устойчиво к pointer capture. */}
      <motion.div
        data-testid="carousel-track"
        className={`flex h-full ${onImageClick ? 'cursor-pointer' : ''}`}
        style={{ x, touchAction: 'pan-y' }}
        {...handlers}
        onClick={handleTrackClick}
      >
        {urls.map((url, i) => (
          <div
            key={url}
            className="h-full w-full flex-shrink-0"
            aria-hidden={i !== index}
          >
            <img
              src={url}
              alt={i === index ? alt : ''}
              loading={i === index ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              className="h-full w-full select-none object-cover"
            />
          </div>
        ))}
      </motion.div>

      {/* Gradient overlay — bottom half, stronger for text readability */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />

      {/* Arrows — на десктопе по hover, на мобильном скрыты: там свайп. */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); prev() }}
            aria-label="Предыдущее фото"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 group-hover/carousel:opacity-100 max-sm:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); next() }}
            aria-label="Следующее фото"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 group-hover/carousel:opacity-100 max-sm:hidden"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Dots — only if >1 photo */}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5">
          {urls.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIndex(i) }}
              aria-label={`Фото ${i + 1} из ${count}`}
              aria-current={i === index}
              className={`h-2 rounded-full transition-all duration-200 ${
                i === index ? 'w-5 bg-white' : 'w-2 bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
