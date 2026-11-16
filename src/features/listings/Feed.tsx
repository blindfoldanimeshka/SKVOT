import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Database } from '@/types/database'
import type { ListingFilters } from './types'
import { listListings, recordListingView } from './api'
import { listPhotosMap } from '@/features/photos/photoApi'
import { useMediaQuery } from '@/features/photos/media'
import { getMockPhotoUrls } from './mockPhotos'
import { ListingCard } from './ListingCard'
import { Pagination } from '@/components/Pagination'
import { trackEvent } from '@/features/analytics/trackEvent'

type ListingRow = Database['public']['Tables']['listings']['Row']

const ROOMS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Любые' },
  { value: 'studio', label: 'Студия' },
  { value: '1', label: '1 комната' },
  { value: '2', label: '2 комнаты' },
  { value: '3', label: '3 комнаты' },
  { value: '4+', label: '4+ комнат' },
]

const PAGE_SIZE = 10

/** Задержка коммита текста города в фильтры: поле остаётся мгновенным,
 *  а запрос в Supabase уходит, когда пользователь остановился печатать. */
const CITY_DEBOUNCE_MS = 300

/**
 * Плейсхолдер города. «Например, Москва» в 16px требует ~140px, а в сетке
 * фильтра на 390px полю достаётся ~99px и на 640px ~121px — подпись обрезалась.
 * Шрифт у поля тут не уменьшить: `button, input, textarea, select { font: inherit }`
 * в src/styles/index.css лежит вне слоёв и перебивает tailwind-овские `text-*`
 * (то есть `text-sm` в inputClass сейчас вообще не действует). Поэтому на
 * узких экранах подсказка просто короче, а с 768px — снова полная.
 */
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)'

const flushNoop = () => undefined

interface FeedProps {
  onOpen: (listing: ListingRow) => void
  onCreate?: () => void
  filters?: ListingFilters
  onFiltersChange?: (filters: ListingFilters) => void
  page?: number
  onPageChange?: (page: number) => void
}

export function Feed({
  onOpen,
  onCreate,
  filters: propsFilters,
  onFiltersChange: propsOnFiltersChange,
  page: propsPage,
  onPageChange: propsOnPageChange,
}: FeedProps) {
  const [internalFilters, setInternalFilters] = useState<ListingFilters>({})
  const [internalPage, setInternalPage] = useState(0)
  const filters = propsFilters ?? internalFilters
  const page = propsPage ?? internalPage
  const setPage = propsOnPageChange ?? setInternalPage
  const setFilters = (value: SetStateAction<ListingFilters>) => {
    const next = typeof value === 'function' ? value(filters) : value
    ;(propsOnFiltersChange ?? setInternalFilters)(next)
  }

  // Локальный текст поля «Город»: ввод мгновенный, в filters коммитим по debounce.
  const [cityInput, setCityInput] = useState(filters.city ?? '')
  // Последнее значение города, которое мы сами закоммитили в filters —
  // позволяет отличить наше обновление от внешнего (сброс, история навигации).
  const committedCityRef = useRef<string | undefined>(filters.city)
  // Ожидающий коммит города: вызывает его таймер, и cleanup эффекта при unmount.
  const pendingCityFlushRef = useRef<() => void>(flushNoop)

  // Если компонент размонтируется раньше таймера (набран город и сразу открыт
  // карточка) — коммитим город, чтобы filters пережил возврат назад.
  useEffect(() => () => pendingCityFlushRef.current(), [])

  // Внешнее изменение filters (кнопка сброса, навигация) — подтягиваем в локальное поле.
  useEffect(() => {
    if (filters.city !== committedCityRef.current) {
      committedCityRef.current = filters.city
      setCityInput(filters.city ?? '')
    }
  }, [filters.city])

  // Debounce города. В deps — весь `filters`: если за время ожидания
  // изменились другие фильтры, таймер перезапускается со свежим замыканием
  // и коммит не откатит их на старом значении.
  useEffect(() => {
    const city = cityInput || undefined
    if (city === filters.city) {
      committedCityRef.current = city
      pendingCityFlushRef.current = flushNoop
      return
    }
    const timer = setTimeout(flushCity, CITY_DEBOUNCE_MS)
    function flushCity() {
      clearTimeout(timer)
      pendingCityFlushRef.current = flushNoop
      committedCityRef.current = city
      updateFilter({ city })
    }
    pendingCityFlushRef.current = flushCity
    return () => clearTimeout(timer)
  }, [cityInput, filters])

  const [listings, setListings] = useState<ListingRow[]>([])
  const [photoMap, setPhotoMap] = useState<Record<string, string[]>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reducedMotion = useReducedMotion()
  // Только подсказка: на узких экранах она короче, чтобы влезать в поле.
  const isNarrowViewport = useMediaQuery(NARROW_VIEWPORT_QUERY)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    listListings(filters, page, PAGE_SIZE).then((result) => {
      if (!active) return
      if (result.error) {
        setError(result.error)
        setListings([])
      } else {
        setListings((result.data as ListingRow[]) ?? [])
        setTotal(result.count ?? 0)
      }
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [filters, page])

  useEffect(() => {
    if (listings.length === 0) {
      setPhotoMap({})
      return
    }

    let active = true
    const map: Record<string, string[]> = {}
    const realIds: string[] = []

    listings.forEach((listing) => {
      if (listing.is_mock) {
        map[listing.id] = getMockPhotoUrls(listing.id, listing.type)
      } else {
        realIds.push(listing.id)
      }
    })

    if (realIds.length === 0) {
      setPhotoMap(map)
      return
    }

    listPhotosMap(realIds).then((result) => {
      if (!active) return
      if (result.data) {
        Object.assign(map, result.data)
      }
      setPhotoMap(map)
    })

    return () => {
      active = false
    }
  }, [listings])

  function updateFilter(patch: Partial<ListingFilters>) {
    setPage(0)
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  function handleOpen(listing: ListingRow) {
    void trackEvent('view_listing', { listing_id: listing.id })
    void recordListingView(listing.id)
    onOpen(listing)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const inputClass =
    'rounded-[8px] border border-border-muted bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-secondary/40 transition-all duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]'

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
          Объявления
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Аренда жилья СКВОТ, без посредников.
        </p>
      </div>

      <div className="surface-elevated grid grid-cols-2 gap-3 rounded-[8px] p-5 shadow-[var(--shadow-surface)] sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-end lg:gap-3">
        <label className="block lg:w-auto">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Тип</span>
          <select
            value={filters.type ?? ''}
            onChange={(event) =>
              updateFilter({
                type: (event.target.value || undefined) as
                  | 'offer'
                  | 'request'
                  | undefined,
              })
            }
            className={`${inputClass} mt-1 w-full`}
          >
            <option value="">Все</option>
            <option value="offer">Сдают</option>
            <option value="request">Ищут</option>
          </select>
        </label>

        <label className="block lg:w-auto">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Город</span>
          <input
            type="text"
            value={cityInput}
            onChange={(event) => setCityInput(event.target.value)}
            placeholder={isNarrowViewport ? 'Москва' : 'Например, Москва'}
            className={`${inputClass} mt-1 w-full`}
          />
        </label>

        <label className="block lg:w-auto">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Комнаты</span>
          <select
            value={filters.rooms ?? ''}
            onChange={(event) =>
              updateFilter({ rooms: event.target.value || undefined })
            }
            className={`${inputClass} mt-1 w-full`}
          >
            {ROOMS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block lg:w-auto">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Цена до, ₽
          </span>
          <input
            type="number"
            value={filters.maxPrice ?? ''}
            onChange={(event) =>
              updateFilter({
                maxPrice: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
            placeholder="Любая"
            className={`${inputClass} mt-1 w-full`}
          />
        </label>

        <label className="block lg:w-auto">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Сортировка</span>
          <select
            value={filters.sort ?? 'newest'}
            onChange={(event) =>
              updateFilter({
                sort: (event.target.value || 'newest') as 'newest' | 'popular',
              })
            }
            className={`${inputClass} mt-1 w-full`}
          >
            <option value="newest">Сначала новые</option>
            <option value="popular">Популярные</option>
          </select>
        </label>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-950">
          {error}
        </p>
      )}

      {!loading && !error && listings.length === 0 && (
        <div className="surface-elevated rounded-2xl p-10 text-center shadow-[var(--shadow-surface)]">
          <p className="text-sm text-muted-foreground">
            Объявлений не найдено. Попробуйте изменить фильтры.
          </p>
        </div>
      )}

      {!loading && !error && listings.length > 0 && (
        <>
          {/* Plain grid: it never animated anything, but as a motion component it
              mounted its own visual element and subscribed to the motion/presence
              context on every feed render. */}
          <div className="grid grid-cols-1 gap-6 rounded-2xl bg-card p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3 lg:gap-8 lg:p-8">
            {listings.map((listing, i) =>
              reducedMotion ? (
                /* Keys stay `listing.id` on both branches, so a card that survives a
                   filter/page change keeps its DOM node instead of remounting. */
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  photoUrls={photoMap[listing.id]}
                  onOpen={handleOpen}
                />
              ) : (
                /* opacity + transform only — no layout properties, so the browser
                   never re-lays out the grid while the cards animate in. */
                <motion.div
                  key={listing.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 30,
                    delay: Math.min(i * 0.04, 0.3),
                  }}
                >
                  <ListingCard
                    listing={listing}
                    photoUrls={photoMap[listing.id]}
                    onOpen={handleOpen}
                  />
                </motion.div>
              ),
            )}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />

          <div className="mt-8 flex h-[86px] items-center justify-center gap-4 rounded-[8px] bg-surface shadow-[var(--shadow-surface)]">
            <button
              type="button"
              onClick={() => setFilters({})}
              className="rounded-[8px] bg-muted/40 px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/50 hover:bg-muted/60"
            >
              Сбросить фильтры
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition hover:opacity-90"
            >
              Подать объявление
            </button>
          </div>
        </>
      )}
    </section>
  )
}
