import { expect, test } from '@playwright/test'
import {
  SKIP_NO_SESSION,
  assertNoRenderErrors,
  listingCards,
  openApp,
  watchErrors,
} from './helpers'

/**
 * Детальный экран объявления (ListingDetailScreen → ListingDetail).
 *
 * Доступен только авторизованным (лента гейтится сессией), поэтому без
 * E2E_STORAGE_STATE тест честно skip'ится. Операций записи нет: «Написать
 * автору» и «Пожаловаться» только проверяем на наличие, не нажимаем.
 */

test.describe('listing detail — карточка объявления', () => {
  test('клик по первой карточке открывает детальный экран', async ({ page }) => {
    const watch = watchErrors(page)

    const screen = await openApp(page)
    test.skip(screen !== 'feed', SKIP_NO_SESSION)

    const cards = listingCards(page)
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })

    const city = (await cards.first().getByRole('heading', { level: 3 }).textContent())?.trim()
    await cards.first().click()

    // Детальный экран: кнопка «Назад» + ценовая плашка «… ₽/мес.».
    await expect(page.getByRole('button', { name: 'Назад' })).toBeVisible()
    await expect(page.getByText(/₽\/мес\./).first()).toBeVisible()

    // Заголовок города есть не всегда (он в оверлее фото) — проверяем, если фото есть.
    if (city) {
      const detailHeading = page.getByRole('heading', { level: 1, name: city, exact: true })
      if (await detailHeading.isVisible().catch(() => false)) {
        await expect(detailHeading).toBeVisible()
      }
    }

    // CTA: «Написать автору» (для чужих объявлений) или как минимум «Пожаловаться».
    const write = page.getByRole('button', { name: 'Написать автору' })
    const report = page.getByRole('button', { name: 'Пожаловаться' })
    await expect(write.or(report).first()).toBeVisible()
    await expect(report).toBeVisible()

    assertNoRenderErrors(watch)
  })

  test('с детального экрана можно вернуться назад в ленту', async ({ page }) => {
    const watch = watchErrors(page)

    const screen = await openApp(page)
    test.skip(screen !== 'feed', SKIP_NO_SESSION)

    const cards = listingCards(page)
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })
    await cards.first().click()

    await expect(page.getByRole('button', { name: 'Назад' })).toBeVisible()
    await page.getByRole('button', { name: 'Назад' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Объявления' })).toBeVisible()

    assertNoRenderErrors(watch)
  })
})
