import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

/**
 * Flat config. `npm run lint` previously existed in package.json with no config
 * file to back it, so it failed as "no eslint config found" rather than
 * reporting anything. These are the recommended rule sets and nothing else: no
 * rule is downgraded to make the run green.
 *
 * Type-aware linting (tseslint.configs.recommendedTypeChecked) is deliberately
 * not enabled. It needs a slower parserOptions.project setup and this config is
 * meant to be fast enough to run on every save.
 */
export default tseslint.config(
  globalIgnores(['dist', 'coverage', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // A leading underscore means "this parameter exists to complete the
      // signature". Used by fetch/vi.fn stubs whose init is read back from
      // mock.calls rather than from the closure.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Config files and test helpers run in Node, not the browser.
    files: ['*.config.{ts,js}', 'vite.config.ts', 'vitest.config.ts', 'tailwind.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/test-utils/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
)
