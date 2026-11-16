/**
 * Mock-фото для демонстрационных объявлений.
 *
 * Файлы лежат в `public/mock/` и отдаются как статика (`/mock/...`), поэтому
 * не попадают в JS-бандл. Привязка — по хешу id объявления, а не по порядку в
 * ленте: иначе после фильтрации или сортировки картинки «переезжали» бы между
 * карточками.
 */

type ListingKind = 'offer' | 'request'

const APARTMENT_COUNT = 30
const PORTRAIT_COUNT = 20

function numberedUrl(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `/mock/${prefix}-${String(index + 1).padStart(2, '0')}.jpg`,
  )
}

const APARTMENT_PHOTOS = numberedUrl('apt', APARTMENT_COUNT)
const PORTRAIT_PHOTOS = numberedUrl('person', PORTRAIT_COUNT)

/** FNV-1a: стабильный 32-битный хеш строки, одинаковый в браузере и тестах. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Фото для мок-объявления.
 * - `offer` (сдаётся) — три интерьера подряд, чтобы работала карусель;
 * - `request` (ищут) — один портрет арендатора.
 */
export function getMockPhotoUrls(
  seed: string,
  kind: ListingKind = 'offer',
): string[] {
  const base = hashSeed(seed)

  if (kind === 'request') {
    return [PORTRAIT_PHOTOS[base % PORTRAIT_PHOTOS.length]]
  }

  const start = base % APARTMENT_PHOTOS.length
  return [0, 1, 2].map(
    (offset) => APARTMENT_PHOTOS[(start + offset) % APARTMENT_PHOTOS.length],
  )
}

/** Сколько интерьеров доступно в мок-наборе. */
export const MOCK_PHOTO_COUNT = APARTMENT_PHOTOS.length
/** Сколько портретов доступно в мок-наборе. */
export const MOCK_PORTRAIT_COUNT = PORTRAIT_PHOTOS.length
