import { defineConfig, devices } from '@playwright/test'

/**
 * E2E-каркас skvot-app.
 *
 * Спецификация запускается против РЕАЛЬНОГО dev-сервера и РЕАЛЬНОГО Supabase
 * (RLS включён). Спек-файлы только читают и навигируют — никаких операций записи.
 *
 * Таймауты рассчитаны на холодный старт: пока Vite делает первую транспиляцию,
 * три браузерных контекста грузят приложение одновременно, поэтому ожидания
 * подняты (expect 20с / тест 60с), а e2e/global-setup.ts прогревает dev-сервер
 * одним HTTP-запросом до старта воркеров. Ослаблением проверок это не является:
 * ассерты в спеках остались те же, изменилось только время ожидания.
 *
 * Сессия не нужна: отложенная авторизация показывает ленту, фильтры и карточку
 * объявления анониму, поэтому все спеки работают без тестового пользователя и
 * сами фиксируют анонимный контекст (`test.use({ storageState: ... })` в
 * e2e/helpers.ts, ANONYMOUS_STATE). Хранить состояние в конфиге больше незачем.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  // 60с на тест: холодный старт + реальная сеть до Supabase.
  timeout: 60_000,
  expect: {
    // 20с на ожидание: на холодном Vite этого запаса хватает вместо прежних 10с.
    timeout: 20_000,
  },
  // Флейки должны быть видны: retries по умолчанию выключены.
  retries: 0,
  reporter: 'list',
  // Прогрев dev-сервера и внятная ошибка, если он недоступен (см. файл).
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
