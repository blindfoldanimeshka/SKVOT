import { expect, test } from '@playwright/test'
import { SCREEN_TIMEOUT, assertNoRenderErrors, openApp, watchErrors } from './helpers'

/**
 * Auth guard: в приватном контексте без сессии приложение обязано показать
 * экран входа (features/auth/AuthScreen.tsx), а не ленту.
 *
 * storageState принудительно пустой: тест остаётся «анонимным», даже если
 * прогон запускают с E2E_STORAGE_STATE.
 */

test.describe('auth guard — приватный контекст', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('без сессии показывается экран входа, а не лента', async ({ page }) => {
    const watch = watchErrors(page)

    const screen = await openApp(page)
    expect(screen, 'анонимный пользователь должен попасть на экран входа').toBe('auth')

    await expect(page.getByRole('heading', { level: 1, name: 'Вход', exact: true })).toBeVisible()
    // Лента недоступна без сессии.
    await expect(page.getByRole('heading', { level: 1, name: 'Объявления' })).toHaveCount(0)

    assertNoRenderErrors(watch)
  })

  test('форма входа содержит поля email/пароль и кнопку входа', async ({ page }) => {
    const watch = watchErrors(page)

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: SCREEN_TIMEOUT })

    await expect(page.getByLabel('Email')).toBeEditable()
    await expect(page.getByLabel('Пароль')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled()

    // Переключение в режим регистрации проверяем без отправки формы (записи нет).
    await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрироваться' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Регистрация' })).toBeVisible()
    await expect(
      page.getByLabel('Имя'),
      'после переключения в регистрацию не появилось поле «Имя» — форма не перерисовалась',
    ).toBeVisible({ timeout: SCREEN_TIMEOUT })
    await expect(page.getByRole('checkbox')).toBeVisible()

    assertNoRenderErrors(watch)
  })
})
