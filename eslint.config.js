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
    // The redesign builds every interface from src/ui. Radix and the shadcn
    // layer stay behind it; this becomes an error once the legacy UI is gone.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/**', 'src/components/ui/**'],
    rules: {
      'no-restricted-imports': ['warn', { paths: [
        { name: 'radix-ui', message: 'Use the primitives in src/ui instead of Radix directly.' }
      ], patterns: [
        { group: ['**/components/ui/*', '@/components/ui/*'], message: 'shadcn primitives are being replaced; use src/ui.' }
      ] }]
    }
  },
  {
    files: ['scripts/**', 'e2e/**', 'tests/token-bench/**', 'electron/main/mcp-internal/tool-handlers.ts', 'electron/main/mcp-internal/local-rpc-server.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  }
)
