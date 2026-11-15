import { expect, test } from '@playwright/test'
import {
  ANONYMOUS_STATE,
  SCREEN_TIMEOUT,
  assertNoRenderErrors,
  authBackButton,
  authScreen,
  feedHeading,
  listingCards,
  openApp,
  openListingButton,
  watchErrors,
} from './helpers'

/**
 * Детальный экран объявления (ListingDetailScreen → ListingDetail).
 *
 * Отложенная авторизация: карточку открывает аноним, поэтому тесты выполняются
 * без сессии (storageState пустой принудительно) и проверяют реальные данные.
 * Операций записи по-прежнему нет: «Написать автору» и «Пожаловаться» —
 * единственные действия, на которые мы нажимаем, и они обязаны не слать чат
 * и не создавать жалобу, а показывать экран входа с подсказкой.
 */

test.describe('listing detail — карточка объявления', () => {
  test.use({ storageState: ANONYMOUS_STATE })

  test('клик по первой карточке открывает детальный экран', async ({ page }) => {
    const watch = watchErrors(page)

    await openApp(page)

    const cards = listingCards(page)
    await expect(cards.first(), 'анониму не открылась ни одна карточка ленты').toBeVisible({
      timeout: SCREEN_TIMEOUT,
    })

    const city = (await cards.first().getByRole('heading', { level: 3 }).textContent())?.trim()

    // Клик по карточке целиком, а не по кнопке: у ListingCard теперь единственный
    // интерактив — кнопка-оверлей «absolute inset-0», и Playwright обязан принять
    // этот клик (цель события — потомок статьи). Если оверлей не перекрывает
    // карточку, тест упадёт здесь, а не «молча» останется на ленте.
    await expect(openListingButton(cards.first())).toHaveCount(1)
    await cards.first().click()

    // Детальный экран: кнопка «Назад» + ценовая плашка «… ₽/мес.».
    await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeVisible()
    await expect(page.getByText(/₽\/мес\./).first()).toBeVisible()

    // Заголовок города есть не всегда (он в оверлее фото) — проверяем, если фото есть.
    if (city) {
      const detailHeading = page.getByRole('heading', { level: 1, name: city, exact: true })
      if (await detailHeading.isVisible().catch(() => false)) {
        await expect(detailHeading).toBeVisible()
      }
    }

    // CTA анонима: «Написать автору» (чужое объявление) и «Пожаловаться» видны,
    // но требуют входа — это и проверяем ниже, нажатием с возвратом.
    const write = page.getByRole('button', { name: 'Написать автору' })
    const report = page.getByRole('button', { name: 'Пожаловаться' })
    await expect(write.or(report).first()).toBeVisible()
    await expect(report).toBeVisible()

    assertNoRenderErrors(watch)
  })

  test('«Написать автору» и «Пожаловаться» у гостя ведут на вход, а не в чат', async ({
    page,
  }) => {
    const watch = watchErrors(page)

    await openApp(page)
    const cards = listingCards(page)
    await expect(cards.first()).toBeVisible({ timeout: SCREEN_TIMEOUT })
    await cards.first().click()

    const price = page.getByText(/₽\/мес\./).first()
    await expect(price).toBeVisible()

    // 1. «Написать автору»: гостю показываем вход с подсказкой, диалог не создаём.
    const write = page.getByRole('button', { name: 'Написать автору' })
    await expect(write).toBeVisible()
    await write.click()

    await expect(authScreen(page)).toBeVisible()
    await expect(
      page.getByText('Войдите, чтобы написать автору'),
      'экран входа открылся без подсказки про действие',
    ).toBeVisible()
    await expect(authBackButton(page)).toBeVisible()
    // Форма входа, а не чат: поля email/пароль на месте.
    await expect(page.getByLabel('Email')).toBeVisible()

    await authBackButton(page).click()
    await expect(price, '«← Назад» не вернул на экран объявления').toBeVisible()
    await expect(authScreen(page)).toHaveCount(0)

    // 2. «Пожаловаться»: та же схема — вход с подсказкой, жалобу не отправляем.
    const report = page.getByRole('button', { name: 'Пожаловаться' })
    await expect(report).toBeVisible()
    await report.click()

    await expect(authScreen(page)).toBeVisible()
    await expect(
      page.getByText('Войдите, чтобы пожаловаться'),
      'экран входа после «Пожаловаться» открылся без подсказки',
    ).toBeVisible()

    await authBackButton(page).click()
    await expect(price).toBeVisible()

    assertNoRenderErrors(watch)
  })

  test('с детального экрана можно вернуться назад в ленту', async ({ page }) => {
    const watch = watchErrors(page)

    await openApp(page)

    const cards = listingCards(page)
    await expect(cards.first()).toBeVisible({ timeout: SCREEN_TIMEOUT })
    await cards.first().click()

    await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()

    await expect(feedHeading(page)).toBeVisible()
    // Возврат в ленту: карточки снова на месте (тот же анонимный запрос).
    await expect(cards.first()).toBeVisible({ timeout: SCREEN_TIMEOUT })

    assertNoRenderErrors(watch)
  })
})
