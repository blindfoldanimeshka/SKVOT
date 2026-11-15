import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Общие помощники e2e.
 *
 * Приложение в рантайме ходит в реальный Supabase. Спек-файлы только читают
 * и навигируют: никакой отправки форм, никаких операций записи.
 *
 * Отложенная авторизация: аноним видит ленту, фильтры и карточку объявления,
 * вход нужен только на действиях («Подать объявление», «Мои», чаты, профиль,
 * «Написать автору», «Пожаловаться»). Поэтому контентные спеки выполняются
 * анонимно (ANONYMOUS_STATE) и проверяют реальную выдачу, а экран входа
 * проверяется через эти самые действия-гейты — см. e2e/auth-guard.spec.ts.
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
 *
 * Больше здесь никакой категории «известные дефекты приложения» нет: карточка
 * перестала быть `<button>` внутри `<button>` (ListingCard — `<article>` +
 * кнопка-оверлей), а `trackEvent` не дёргает edge-функцию без сессии. Так что
 * guard строгий: любая console.error, не являющаяся сетевым шумом, роняет тест.
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
 * Пустое состояние хранилища: контекст гарантированно анонимный, даже если
 * прогон запускают с сохранённой сессией. Отложенная авторизация позволила
 * проверять ленту и карточку без тестового пользователя.
 */
export const ANONYMOUS_STATE = { cookies: [], origins: [] }

/**
 * Открывает / и ждёт, пока приложение отрендерит любой верхнеуровневый экран:
 * ленту («Объявления») или вход («Вход» — куда уводят действия-гейты). Это
 * проверка «каркас жив, белого экрана и цикла ре-рендеров нет».
 *
 * Который именно экран — решает тест web-first ассертом (`feedHeading()` /
 * `authScreen()`), а не снимком DOM: сразу после первой отрисовки App.tsx
 * делает reset() пока без сессии, и на одну-две кадры заголовок может быть
 * снят (AnimatePresence mode="wait"), поэтому мгновенный isVisible()
 * враньё, а ожидание — нет.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const screen = feedHeading(page).or(authScreen(page))

  await expect(
    screen,
    `Приложение за ${SCREEN_TIMEOUT / 1000}с не показало ни ленту, ни экран входа. ` +
      'Это белый экран или цикл ре-рендеров, а не опечатка в локаторе: проверь ' +
      'pageerror/console.error выше, что dev-сервер и Supabase доступны, и что ' +
      'прогрев e2e/global-setup.ts прошёл (в логе прогона строка «dev-сервер прогрет»).',
  ).toBeVisible({ timeout: SCREEN_TIMEOUT })
}

/** Заголовок ленты — экран анонима по умолчанию (отложенная авторизация). */
export function feedHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Объявления' })
}

/** Экран входа, открытый действием-гейтом: заголовок и подсказка «зачем вход». */
export function authScreen(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Вход', exact: true })
}

/**
 * Карточка объявления.
 *
 * Разметка сменилась, когда в e2e всплыла вложенность кнопок: карточка — это
 * <article>, а не <button> (внутри живёт карусель со своими кнопками, а
 * `<button>` внутри `<button>` React считает ошибкой). Текст — город (`h3`) и
 * цена — лежит ВНЕ кнопки, поэтому прежний поиск «кнопка, содержащая h3» больше
 * не находит ничего. Ищем статью по единственному интерактиву — кнопке-оверлею,
 * растянутой по всей карточке (`absolute inset-0`), с доступным именем
 * «Открыть объявление: <город>».
 */
export function listingCards(page: Page) {
  return page.getByRole('article').filter({
    has: page.getByRole('button', { name: /^Открыть объявление:/ }),
  })
}

/**
 * Кнопка-оверлей карточки: клик по любому месту карточки (кроме контролов
 * карусели) приходит именно на неё. Отдельный экспорт, чтобы тесты могли
 * проверить доступное имя, а не только факт клика.
 */
export function openListingButton(card: Locator): Locator {
  return card.getByRole('button', { name: /^Открыть объявление:/ })
}

/**
 * <select> фильтра ленты. Подпись живёт в <span> внутри <label>, поэтому
 * доступное имя поля — не «Тип», а «Тип Все Сдают Ищут» (в него попадает текст
 * опций). Точное совпадение с name не работает, берём начало имени.
 */
export function feedFilter(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return page.getByRole('combobox', { name: new RegExp(`^${escaped}(\\s|$)`) })
}

/** Кнопка возврата с экрана входа-по-требованию обратно к тому, откуда пришёл гость. */
export function authBackButton(page: Page) {
  return page.getByRole('button', { name: '← Назад' })
}
