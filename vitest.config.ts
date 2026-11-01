import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { scrubLiveAppEnv } from './e2e/helpers/live-app-env'

// Before any worker starts: a test that spawns the bridge or Electron must never reach the running app.
scrubLiveAppEnv()

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Native processes and Windows filesystem fixtures compete heavily when
    // files run concurrently. Keep the same deterministic policy locally/CI.
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'electron/main/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: ['electron/main/vendor/**', '**/*.d.ts'],
      thresholds: {
        lines: 35, functions: 35, statements: 35, branches: 25,
        // FE-M-16: the renderer's own floor, about a point under what CI measured on both platforms on 2026-10-31
        // (65.5 / 61.8 / 56.5 / 53.9 %, coverage-summary-<platform> from #293). A ratchet: raise it, never lower it.
        'src/**/*.{ts,tsx}': { lines: 64, statements: 60, branches: 55, functions: 52 }
      }
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
