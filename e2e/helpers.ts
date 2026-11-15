import { expect, test, type Page } from '@playwright/test'

/**
 * Общие помощники e2e.
 *
 * Приложение в рантайме ходит в реальный Supabase. Спек-файлы только читают
 * и навигируют: никакой отправки форм, никаких операций записи.
 */

export interface ConsoleWatch {
  /** Все пойманные console.error (включая сетевой шум «Failed to load resource»). */
  consoleErrors: string[]
  /** Непойманные исключения страницы: именно здесь был бы сегодняшний цикл ре-рендеров. */
  pageErrors: string[]
}

export function watchErrors(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { consoleErrors: [], pageErrors: [] }

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      watch.consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err) => {
    watch.pageErrors.push(err.stack ?? err.message)
  })

  return watch
}

/**
 * Сетевой шум dev-окружения: несуществующий favicon, битые фото из реальных
 * данных и т.п. Не признаки падения рендера, но выводятся в аннотациях теста.
 */
const RESOURCE_NOISE = /Failed to load resource|net::ERR_/i

/**
 * Пишет всё пойманное в аннотации теста (видны в отчёте) и в stdout,
 * затем жёстко ассертит значимые ошибки: исключения страницы и console.error
 * без сетевого шума.
 */
export function assertNoRenderErrors(watch: ConsoleWatch): void {
  const all = [...watch.pageErrors, ...watch.consoleErrors]
  if (all.length > 0) {
    console.log(`\n=== Поймано ${all.length} сообщений консоли/страницы ===`)
    for (const message of all) {
      console.log(`- ${message.split('\n')[0]}`)
      test.info().annotations.push({ type: 'browser-error', description: message })
    }
  }

  const actionableConsole = watch.consoleErrors.filter((text) => !RESOURCE_NOISE.test(text))
  expect(
    actionableConsole,
    `console.error без сетевого шума:\n${actionableConsole.join('\n---\n')}`,
  ).toEqual([])
  expect(
    watch.pageErrors,
    `страница бросала исключения:\n${watch.pageErrors.join('\n---\n')}`,
  ).toEqual([])
}

/**
 * Верхнеуровневый экран (лента или вход) ждём столько же, сколько глобальный
 * `expect.timeout` в playwright.config.ts: на холодном старте Vite первые
 * секунды уходят на транспиляцию. Держим одну константу, чтобы «магическое»
 * число не разъезжалось с конфигом.
 */
export const SCREEN_TIMEOUT = 20_000

/**
 * Открывает / и ждёт, пока приложение отрендерит один из верхнеуровневых
 * экранов: ленту («Объявления», есть сессия) или вход («Вход», сессии нет).
 * Возвращает, какой экран показали.
 */
export async function openApp(page: Page): Promise<'feed' | 'auth'> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const screen = page
    .getByRole('heading', { level: 1, name: 'Объявления' })
    .or(page.getByRole('heading', { level: 1, name: 'Вход', exact: true }))

  await expect(
    screen,
    `Приложение за ${SCREEN_TIMEOUT / 1000}с не показало ни ленту, ни экран входа. ` +
      'Это белый экран или цикл ре-рендеров, а не опечатка в локаторе: проверь ' +
      'pageerror/console.error выше, что dev-сервер и Supabase доступны, и что ' +
      'прогрев e2e/global-setup.ts прошёл (в логе прогона строка «dev-сервер прогрет»).',
  ).toBeVisible({ timeout: SCREEN_TIMEOUT })

  return (await page.getByRole('heading', { level: 1, name: 'Объявления' }).isVisible())
    ? 'feed'
    : 'auth'
}

/** Карточка объявления: кнопка, внутри которой заголовок города (h3). Без CSS-классов. */
export function listingCards(page: Page) {
  return page.getByRole('button').filter({ has: page.getByRole('heading', { level: 3 }) })
}

export const SKIP_NO_SESSION =
  'Лента доступна только авторизованным: в App.tsx при !session рендерится AuthScreen. ' +
  'Нужна сессия подтверждённого тестового пользователя: подготовьте Playwright storageState ' +
  'и запустите с E2E_STORAGE_STATE=<путь> (см. e2e/README.md).'
