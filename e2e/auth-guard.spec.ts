import { expect, test } from '@playwright/test'
import {
  ANONYMOUS_STATE,
  SCREEN_TIMEOUT,
  assertNoRenderErrors,
  authBackButton,
  authScreen,
  feedHeading,
  openApp,
  watchErrors,
} from './helpers'

/**
 * Отложенная авторизация в приватном контексте: аноним читает проект (лента,
 * фильтры, карточка), а экран входа (features/auth/AuthScreen.tsx) открывается
 * только по требующему сессию действию — и обязан отпускать обратно.
 *
 * storageState принудительно пустой: тесты остаются «анонимными», даже если
 * прогон запускают с сохранённой сессией.
 */

test.describe('auth guard — приватный контекст', () => {
  test.use({ storageState: ANONYMOUS_STATE })

  test('без сессии показывается лента, а не экран входа', async ({ page }) => {
    const watch = watchErrors(page)

    await openApp(page)
    // Чтение больше не требует входа, поэтому проверяем экран ожиданиями,
    // а не снимком DOM (снимок ловит кадр между первой отрисовкой и reset()).
    await expect(feedHeading(page), 'аноним обязан стартовать в ленте').toBeVisible()
    // Экран входа — не самоцель на главной: формы и кнопки возврата нет.
    await expect(authScreen(page)).toHaveCount(0)
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(authBackButton(page)).toHaveCount(0)

    assertNoRenderErrors(watch)
  })

  test('форма входа содержит поля email/пароль и кнопку входа', async ({ page }) => {
    const watch = watchErrors(page)

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // До отложенной авторизации форма была единственным экраном анонима; теперь
    // в неё заходим действием-гейтом — «Профиль» из дока.
    await expect(feedHeading(page), 'аноним не попал в ленту перед действием-гейтом').toBeVisible({
      timeout: SCREEN_TIMEOUT,
    })
    await page.getByRole('button', { name: 'Профиль', exact: true }).click()

    await expect(authScreen(page)).toBeVisible({ timeout: SCREEN_TIMEOUT })
    await expect(
      page.getByText('Войдите, чтобы открыть профиль'),
      'действие-гейт открыло вход без подсказки',
    ).toBeVisible()

    await expect(page.getByLabel('Email')).toBeVisible()
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

  test('аноним видит ленту, а «Создать» и «Мои» уводят во вход с возвратом', async ({ page }) => {
    const watch = watchErrors(page)

    const feed = feedHeading(page)
    await openApp(page)
    await expect(feed, 'аноним обязан стартовать в ленте').toBeVisible()

    // 1. «Создать» (CTA ленты «Подать объявление») — требующее входа действие.
    const create = page.getByRole('button', { name: 'Подать объявление' })
    await expect(create).toBeVisible({ timeout: SCREEN_TIMEOUT })
    await create.click()

    await expect(authScreen(page)).toBeVisible()
    await expect(
      page.getByText('Войдите, чтобы подать объявление'),
      '«Подать объявление» открыло вход без подсказки',
    ).toBeVisible()
    await expect(authBackButton(page)).toBeVisible()
    await expect(feed).toHaveCount(0)

    await authBackButton(page).click()
    await expect(feed, '«← Назад» не вернул в ленту').toBeVisible()
    await expect(authScreen(page)).toHaveCount(0)

    // 2. «Мои» из дока — тот же гейт, другая подсказка.
    await page.getByRole('button', { name: 'Мои', exact: true }).click()
    await expect(authScreen(page)).toBeVisible()
    await expect(
      page.getByText('Войдите, чтобы посмотреть свои объявления'),
      '«Мои» открыло вход без подсказки',
    ).toBeVisible()
    await expect(authBackButton(page)).toBeVisible()

    await authBackButton(page).click()
    await expect(feed, 'после «Мои» возврат не привёл в ленту').toBeVisible()
    await expect(authScreen(page)).toHaveCount(0)

    assertNoRenderErrors(watch)
  })
})
