import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'electron/main/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: ['electron/main/vendor/**', '**/*.d.ts'],
      thresholds: { lines: 35, functions: 35, statements: 35, branches: 25 }
    }
  },
  resolve: {
    alias: {
      '@': '/src',
      '@renderer': '/src',
      '@shared': '/shared'
    }
  }
})
