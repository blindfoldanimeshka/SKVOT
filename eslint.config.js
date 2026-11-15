import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src/types/database.ts', '.remember/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright: конфиг и e2e-спеки живут в node-окружении (браузер — через page-объекты)
    files: ['playwright.config.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
)

