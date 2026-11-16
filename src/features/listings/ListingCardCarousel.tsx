import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { preloadNext, usePrefersReducedMotion } from '@/features/photos/media'
import { useCarouselDrag } from './useCarouselDrag'

interface ListingCardCarouselProps {
  urls: string[]
  alt: string
}

export function ListingCardCarousel({ urls, alt }: ListingCardCarouselProps) {
  const [index, setIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const count = urls.length
  // Карусель в ленте без автослайда, но snap-пружинку свайпа тоже глушим при
  // prefers-reduced-motion — это делает хук по флагу ниже.
  const reducedMotion = usePrefersReducedMotion()
  const { x, handlers } = useCarouselDrag({
    count,
    index,
    onIndexChange: setIndex,
    reducedMotion,
    containerRef: rootRef,
  })

  const prev = () => setIndex((i) => (i === 0 ? count - 1 : i - 1))
  const next = () => setIndex((i) => (i === count - 1 ? 0 : i + 1))

  // Предзагрузка следующего кадра: в ленте карточек много, следующий кадр
  // догружаем заранее — переключение по свайпу будет без вспышки.
  useEffect(() => {
    preloadNext(urls, index)
  }, [urls, index])

  if (count === 0) return null

  return (
    <div
      ref={rootRef}
      className="group/carousel relative aspect-[4/3] w-full overflow-hidden"
      role="group"
      aria-roledescription="carousel"
      aria-label="Фото объявления"
    >
      {/* Track: инерционный свайп через Pointer Events + snap пружиной. */}
      <motion.div
        data-testid="carousel-track"
        className="flex h-full"
        style={{ x, touchAction: 'pan-y' }}
        {...handlers}
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

      {/* Gradient overlay — bottom third */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />

      {/* Arrows — на десктопе по hover, на мобильном скрыты: там свайп.

          z-30: карточка (ListingCard) накрывает себя кнопкой-оверлеем «Открыть
          объявление» со z-20. Контролы карусели обязаны лежать выше, иначе клик
          по стрелке открывал бы детальный экран вместо листания фото.
          stopPropagation оставляем на всякий случай: сам оверлей — сиблинг, так
          что всплытия к нему нет, но он страхует любых кликабельных предков.

          group-hover (без слэша) — это :hover по карточке целиком: кнопка-оверлей
          лежит выше фото, поэтому наведение мышью в области фото приходило бы
          только тогда, когда курсор уже попал в саму стрелку, и стрелки никогда
          бы не показывались. group-hover/carousel оставляем — он работает, когда
          карусель рендерят без карточного оверлея. */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); prev() }}
            aria-label="Предыдущее фото"
            className="absolute left-2 top-1/2 z-30 -translate-y-1/2 cursor-pointer rounded-full bg-black/40 p-1.5 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 group-hover:opacity-100 group-hover/carousel:opacity-100 max-sm:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); next() }}
            aria-label="Следующее фото"
            className="absolute right-2 top-1/2 z-30 -translate-y-1/2 cursor-pointer rounded-full bg-black/40 p-1.5 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 group-hover:opacity-100 group-hover/carousel:opacity-100 max-sm:hidden"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Dots — only if >1 photo. Оболочка тянется на всю ширину (inset-x-0),
          поэтому сама она не ловит клики (pointer-events-none): иначе полоса под
          точками перекрывала бы кнопку открытия карточки. Кликабельны только
          точки (pointer-events-auto), и они выше оверлея карточки по z-index. */}
      {count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center gap-1.5">
          {urls.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIndex(i) }}
              aria-label={`Фото ${i + 1} из ${count}`}
              aria-current={i === index}
              className={`pointer-events-auto h-1.5 cursor-pointer rounded-full transition-all duration-200 ${
                i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
