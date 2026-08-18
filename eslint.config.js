import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', 'test-results/**', 'e2e/out/**', 'electron/main/vendor/**', 'tests/token-bench/results/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['electron/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.{js,mjs,cjs,ts}', 'e2e/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': 'off',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off',
      'no-useless-escape': 'off',
      'no-undef': 'off'
    }
  },
  {
    files: ['scripts/**', 'e2e/**', 'tests/token-bench/**', 'electron/main/mcp-internal/tool-handlers.ts', 'electron/main/mcp-internal/local-rpc-server.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  }
)
