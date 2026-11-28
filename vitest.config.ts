import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { scrubLiveAppEnv } from './e2e/helpers/live-app-env'

// Before any worker starts: a test that spawns the bridge or Electron must never reach the running app.
scrubLiveAppEnv()

/** package.json, read once: the renderer's tests see the same __APP_VERSION__ as the build (OXE-213). */
const PACKAGE = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

/**
 * `.test.ts` files that require jsdom (DOM globals, React Testing Library hooks, or renderer i18n/store setup).
 * Listed here so they run in the `ui` project without editing frozen acceptance tests.
 */
const UI_TS_TESTS: string[] = [
  'tests/acceptance/f2/cr36-skills-copy.test.ts',
  'tests/acceptance/f2/cr38-skills-code.test.ts',
  'tests/acceptance/f2/g1-restored-layout-removed-panels.test.ts',
  'tests/acceptance/oxe449/a3-antigravity-resume-security-and-copy.test.ts',
  'tests/acceptance/oxe450/a5-on-demand-and-ui-guards.test.ts',
  'tests/acceptance/oxe451/a1-resize-debounce-single-pty.test.ts',
  'tests/acceptance/oxe451/a2-warm-webgl-lru-switch.test.ts',
  'tests/acceptance/oxe451/a3-webgl-lru-eviction-budget.test.ts',
  'tests/account-store.test.ts',
  'tests/activity-store.test.ts',
  'tests/agent-notice.test.ts',
  'tests/agent-setup.test.ts',
  'tests/app-menus.test.ts',
  'tests/attention-summary.test.ts',
  'tests/code-i18n.test.ts',
  'tests/command-registry.test.ts',
  'tests/first-run-restart.test.ts',
  'tests/first-run.test.ts',
  'tests/humanize-error.test.ts',
  'tests/idle-preload.test.ts',
  'tests/integration/background.store.test.ts',
  'tests/integration/editor.store.test.ts',
  'tests/integration/mcp-cross-provider-handoff.test.ts',
  'tests/integration/paneDisplay.test.ts',
  'tests/integration/restore.test.ts',
  'tests/integration/terminal-prefs.store.test.ts',
  'tests/integration/workspace.store.test.ts',
  'tests/keybindings.test.ts',
  'tests/navigation-prefs.test.ts',
  'tests/optimistic.test.ts',
  'tests/oxe152/activity/ag09-mark-read-on-resolve.test.ts',
  'tests/oxe152/activity/f30-activity-persist.test.ts',
  'tests/oxe152/chat/ag06-grid-persist.test.ts',
  'tests/oxe152/chat/oxe-58-thread-chunk-preload.test.ts',
  'tests/oxe152/code/ag04b-pin-persist.test.ts',
  'tests/oxe152/code/ag04d-changed-files-count.test.ts',
  'tests/oxe152/code/oxe109-agent-opens-panels.test.ts',
  'tests/oxe152/code/p-scm-one-step-switch.test.ts',
  'tests/oxe152/hml/oxe348-app-rerender.test.ts',
  'tests/oxe152/hml/oxe365-diagnostics-plural.test.ts',
  'tests/oxe152/p1a/activity-persist.test.ts',
  'tests/oxe152/p1a/stores-isolation.test.ts',
  'tests/oxe152/polish/pq07-agent-activity-event.test.ts',
  'tests/oxe152/sec/notification-click.test.ts',
  'tests/oxe152/ux/oxe-130-notification.test.ts',
  'tests/perf-journal-window.test.ts',
  'tests/quota-thresholds.test.ts',
  'tests/split-refusal.test.ts',
  'tests/split-room.test.ts',
  'tests/thread-attention.test.ts',
  'tests/thread-live-activity.test.ts',
  'tests/thread-navigation-status.test.ts',
  'tests/thread-sections.test.ts',
  'tests/thread-store.test.ts',
  'tests/thread-timeline-model.test.ts',
  'tests/thread-title.test.ts',
  'tests/tool-catalog.test.ts',
  'tests/ui-scale-density.test.ts',
  'tests/ui/oxe461-app-wide-minimal.test.ts',
  'tests/unit/app-menus-mode.test.ts',
  'tests/unit/changes-compare.test.ts',
  'tests/unit/connector-catalog.test.ts',
  'tests/unit/design-source.test.ts',
  'tests/unit/fileListCache.test.ts',
  'tests/unit/git-store-compare.test.ts',
  'tests/unit/input-timer.test.ts',
  'tests/unit/oxe471-terminal-resize-redraw-guard.test.ts',
  'tests/unit/oxe484-perf-terminal-a2.test.ts',
  'tests/unit/oxepod-engine-advice.test.ts',
  'tests/unit/oxepod-model.test.ts',
  'tests/unit/oxequery-completion.test.ts',
  'tests/unit/oxequery-connection-list-model.test.ts',
  'tests/unit/oxequery-i18n-logic.test.ts',
  'tests/unit/oxequery-mongo-model.test.ts',
  'tests/unit/oxequery-structure-model.test.ts',
  'tests/unit/oxequery-tree-model.test.ts',
  'tests/unit/palette-focus.test.ts',
  'tests/unit/pane-menu-placement.test.ts',
  'tests/unit/paneDisplay.test.ts',
  'tests/unit/pathMenu.test.ts',
  'tests/unit/preview-problems.test.ts',
  'tests/unit/shell-osc-command.test.ts',
  'tests/unit/state-words.test.ts',
  'tests/unit/terminal-pane-agent-identity.test.ts',
  'tests/unit/thread-background-status.test.ts',
  'tests/unit/vt-trim-and-windows-pty.test.ts',
  'tests/voice-removed-notice.test.ts'
]

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(PACKAGE.version) },
  test: {
    globals: true,
    pool: 'forks',
    isolate: true,
    // Native processes and Windows filesystem fixtures compete heavily when
    // files run concurrently. Keep the same deterministic policy locally/CI.
    fileParallelism: false,
    // OXE-434: single-test transient flakes in CI get one targeted retry so
    // push/main runs do not fail on isolated timing noise; local stays 0.
    retry: process.env.CI ? 1 : 0,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'electron/main/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: ['electron/main/vendor/**', '**/*.d.ts'],
      // A CI shard (OXE-142) covers part of the code: its floors are off there; the job that merges the shards' blob
      // reports applies them to the whole run.
      thresholds: process.env.VITEST_COVERAGE_SHARD ? undefined : {
        lines: 35, functions: 35, statements: 35, branches: 25,
        // FE-M-16: the renderer's own floor, about a point under what CI measured on both platforms on 2026-10-31
        // (65.5 / 61.8 / 56.5 / 53.9 %, coverage-summary-<platform> from #293). A ratchet: raise it, never lower it.
        'src/**/*.{ts,tsx}': { lines: 64, statements: 60, branches: 55, functions: 52 }
      }
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.{test,spec}.ts'],
          exclude: [...configDefaults.exclude, ...UI_TS_TESTS]
        }
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/**/*.{test,spec}.tsx', ...UI_TS_TESTS],
          benchmark: { include: [] }
        }
      }
    ]
  },
  resolve: {
    alias: {
      '@': '/src',
      '@renderer': '/src',
      '@shared': '/shared'
    }
  }
})
