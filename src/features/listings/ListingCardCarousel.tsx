import { useState, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ListingCardCarouselProps {
  urls: string[]
  alt: string
}

export function ListingCardCarousel({ urls, alt }: ListingCardCarouselProps) {
  const [index, setIndex] = useState(0)
  const touchStart = useRef<number | null>(null)
  const count = urls.length

  const prev = useCallback(() => {
    setIndex((i) => (i === 0 ? count - 1 : i - 1))
  }, [count])

  const next = useCallback(() => {
    setIndex((i) => (i === count - 1 ? 0 : i + 1))
  }, [count])

  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStart.current === null) return
    const diff = touchStart.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        next()
      } else {
        prev()
      }
    }
    touchStart.current = null
  }

  if (count === 0) return null

  return (
    <div
      className="group/carousel relative aspect-[4/3] w-full overflow-hidden"
      role="group"
      aria-roledescription="carousel"
      aria-label="Фото объявления"
    >
      {/* Track */}
      <div
        className="flex h-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateX(-${index * 100}%)` }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
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
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      {/* Gradient overlay — bottom third */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />

      {/* Arrows — visible on hover (desktop) / always on touch.

          z-30: карточка (ListingCard) накрывает себя кнопкой-оверлеем «Открыть
          объявление» со z-20. Контролы карусели обязаны лежать выше, иначе клик
          по стрелке открывал бы детальный экран вместо листания фото.
          stopPropagation оставляем на всякий случай: сам оверлей — сиблинг, так
          что всплытия к нему нет, но он страхует любых кликабельных предков.

          group-hover (без слэша) — это :hover по карточке целиком: кнопка-оверлей
          лежит выше фото, поэтому на group/carousel наведение мышью в области
          фото приходило бы только тогда, когда курсор уже попал в саму стрелку,
          и стрелки никогда бы не показывались. group-hover/carousel оставляем —
          он работает, когда карусель рендерят без карточного оверлея. */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); prev() }}
            aria-label="Предыдущее фото"
            className="absolute left-2 top-1/2 z-30 -translate-y-1/2 cursor-pointer rounded-full bg-black/40 p-1.5 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 group-hover:opacity-100 group-hover/carousel:opacity-100 max-sm:opacity-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); next() }}
            aria-label="Следующее фото"
            className="absolute right-2 top-1/2 z-30 -translate-y-1/2 cursor-pointer rounded-full bg-black/40 p-1.5 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/60 group-hover:opacity-100 group-hover/carousel:opacity-100 max-sm:opacity-100"
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
