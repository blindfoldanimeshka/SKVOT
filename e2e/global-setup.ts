import type { FullConfig } from '@playwright/test'

/**
 * Прогрев dev-сервера до старта воркеров.
 *
 * Почему это нужно. Vite транспилирует приложение лениво, и на холодном старте
 * три браузерных контекста одновременно просят каркас страницы и модули. Пока
 * dev-сервер догоняет, первые ассерты не успевают: ровно так флейкал
 * e2e/auth-guard.spec.ts (переключение формы входа в регистрацию) при трёх
 * воркерах и проходил за <1с при одном.
 *
 * Здесь делается один HTTP-запрос к baseURL приложения: он даёт Vite начать
 * трансформацию и прогреть кэш модулей, а параллельные воркеры стартуют уже с
 * тёплым сервером.
 *
 * Вторая задача — диагностика: если сервер недоступен, падаем здесь с внятным
 * сообщением (что проверять), а не получаем в каждом тесте «белый экран» и
 * таймаут на локаторе.
 *
 * Проверки в спеках это не ослабляет: таймауты ожидания только подняты.
 */

/** По сколько миллисекунд ждём один ответ сервера. */
const REQUEST_TIMEOUT = 10_000
/** Сколько всего даём dev-серверу начать отвечать (webServer уже поднят к этому моменту). */
const WARMUP_DEADLINE = 60_000
/** Пауза между попытками. */
const POLL_INTERVAL = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Где взять адрес приложения.
 *
 * Playwright разрешает корневой `use` в проекты: у объекта `config` в
 * globalSetup свойства `use` нет вообще, живое значение лежит в
 * `projects[].use.baseURL`. Сначала берём его (все наши проекты наследуют
 * корневой baseURL), затем — переменную окружения как в playwright.config.ts.
 */
function resolveBaseURL(config: FullConfig): string | undefined {
  const fromProjects = config.projects
    .map((project) => project.use?.baseURL)
    .find((value): value is string => Boolean(value))
  return fromProjects ?? process.env.E2E_BASE_URL
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = resolveBaseURL(config)
  if (!baseURL) {
    throw new Error(
      'e2e/global-setup.ts: не удалось определить baseURL — в playwright.config.ts ' +
        'не задан use.baseURL и не задан E2E_BASE_URL: некуда слать прогревающий запрос.',
    )
  }

  const url = new URL('/', baseURL).toString()
  const startedAt = Date.now()
  let lastFailure = 'ни одного ответа'

  while (Date.now() - startedAt < WARMUP_DEADLINE) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/html' },
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      })
      const body = await response.text()

      if (response.status !== 200) {
        lastFailure = `HTTP ${response.status} ${response.statusText}`
      } else if (!body.includes('id="root"')) {
        // Порт занят чем-то другим: это не каркас приложения, тесты на нём не поедут.
        lastFailure = `HTTP 200, но в ответе нет монтируемого узла id="root" — ${url} отдаёт не приложение skvot-app (${body.length} байт)`
      } else {
        const ms = Date.now() - startedAt
        console.log(`[e2e] dev-сервер прогрет: ${url} → HTTP 200 за ${ms} мс`)
        return
      }
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      lastFailure = message
    }

    await sleep(POLL_INTERVAL)
  }

  throw new Error(
    `e2e/global-setup.ts: dev-сервер не отвечает как приложение за ${WARMUP_DEADLINE} мс.\n` +
      `  Запрос: GET ${url} (последняя ошибка: ${lastFailure})\n` +
      `  Проверь: 1) ${baseURL} поднимается — webServer в playwright.config.ts запускает \`npm run dev\`; ` +
      `2) E2E_BASE_URL не переопределён на несуществующий адрес; ` +
      `3) \`npm run dev\` стартует без ошибок (недогретый .env.local тоже сюда).`,
  )
}
