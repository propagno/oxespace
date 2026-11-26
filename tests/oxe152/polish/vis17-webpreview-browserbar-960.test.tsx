// @vitest-environment jsdom
// Acceptance test for 1.5.2 VIS-17 (Jira OXE-36): Browser panel browserbar single-row @container collapse and src/ui primitives at 960 px.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetKeptPreviewSettings, WebPreviewPanel } from '../../../src/components/WebPreview/WebPreviewPanel'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { Workspace } from '../../../shared/types/workspace'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

interface CssRule {
  selector: string
  decls: Record<string, string>
}

function parseTopLevelRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  let i = 0
  while (i < clean.length) {
    const open = clean.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let close = open + 1
    for (; close < clean.length && depth > 0; close++) {
      if (clean[close] === '{') depth++
      else if (clean[close] === '}') depth--
    }
    const head = clean.slice(i, open).trim()
    const body = clean.slice(open + 1, close - 1)
    i = close
    if (head.startsWith('@')) continue
    const decls: Record<string, string> = {}
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      const prop = part.slice(0, colon).trim().toLowerCase()
      const val = part.slice(colon + 1).trim()
      if (prop) decls[prop] = val
    }
    for (const sel of head.split(',').map((s) => s.trim()).filter(Boolean)) {
      rules.push({ selector: sel, decls })
    }
  }
  return rules
}

const workspace = {
  id: 'ws-vis17',
  name: 'demo',
  rootPath: '/tmp/demo',
  panes: []
} as unknown as Workspace

function stubPreviewBridge(): {
  emit: (event: Record<string, unknown>) => void
  restore: () => void
} {
  const previous = window.oxe
  const listeners: Array<(event: Record<string, unknown>) => void> = []
  const sessionState: BrowserPreviewSessionState = {
    ownerKey: workspace.id,
    activeTabId: 'tab-1',
    tabs: [
      {
        id: 'tab-1',
        url: 'http://localhost:3000/',
        loading: false,
        error: null,
        canGoBack: true,
        canGoForward: true
      }
    ]
  } as BrowserPreviewSessionState

  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      browserPreview: {
        session: vi.fn(async () => sessionState),
        onEvent: vi.fn((cb: (event: Record<string, unknown>) => void) => {
          listeners.push(cb)
          return () => undefined
        }),
        back: vi.fn(async () => undefined),
        forward: vi.fn(async () => undefined),
        reload: vi.fn(async () => undefined),
        designMode: vi.fn(async () => undefined),
        setAccess: vi.fn(async () => ({ agentAccess: true })),
        setDevice: vi.fn(async () => undefined),
        captureClipboard: vi.fn(async () => undefined),
        mount: vi.fn(async () => undefined),
        unmount: vi.fn(async () => undefined),
        bounds: vi.fn(async () => undefined),
        zoom: vi.fn(async () => undefined),
        setBounds: vi.fn(async () => undefined),
        setZoom: vi.fn(async () => undefined)
      },
      fs: {
        readFile: vi.fn(async () => { throw new Error('ENOENT') }),
        listTree: vi.fn(async () => [])
      },
      background: {
        list: vi.fn(async () => []),
        onEvent: vi.fn(() => () => undefined)
      },
      approvals: {
        list: vi.fn(async () => []),
        onChanged: vi.fn(() => () => undefined)
      },
      terminal: {
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined)
      },
      featureUsage: {
        record: vi.fn(async () => undefined)
      }
    }
  })

  return {
    emit(event: Record<string, unknown>) {
      for (const listener of listeners) listener(event)
    },
    restore() {
      Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
    }
  }
}

beforeEach(async () => {
  await changeLanguage('en')
  if (!('ResizeObserver' in window)) {
    Object.assign(window, {
      ResizeObserver: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    })
  }
  if (typeof HTMLElement.prototype.checkVisibility !== 'function') {
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      value: () => true
    })
  }
})

afterEach(() => {
  cleanup()
  resetKeptPreviewSettings()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  vi.restoreAllMocks()
})

describe('OXE-36 · VIS-17 Browser panel browserbar at 960px', () => {
  test('keeps address input >= 140px on a single row and collapses secondary controls via container width at 960px viewport', async () => {
    const css = read('src/styles/scripts-webpreview.css')
    const rules = parseTopLevelRules(css)

    const panelRules = rules.filter((r) => r.selector === '.web-preview-panel')
    const panelDecls = Object.assign({}, ...panelRules.map((r) => r.decls))
    expect(panelDecls['container-type']).toBe('inline-size')
    expect(panelDecls['container-name']).toBe('web-preview')

    const barRule = rules.find((r) => r.selector === '.web-preview-browserbar')
    expect(barRule).toBeDefined()
    expect(barRule?.decls['flex-wrap']).toBe('nowrap')

    const addressRule = rules.find((r) => r.selector === '.web-preview-address-input')
    expect(addressRule).toBeDefined()
    expect(addressRule?.decls['min-width']).toBe('140px')
    expect(addressRule?.decls.flex).toBe('1 1 140px')

    // Window media query is replaced by panel container query
    expect(css).not.toMatch(/@media\s*\(\s*max-width:\s*760px\s*\)/)
    expect(css).toMatch(/@container\s+web-preview\s*\(\s*max-width:\s*560px\s*\)\s*\{[\s\S]*\.web-preview-secondary-controls\s*\{\s*display:\s*none;\s*\}[\s\S]*\.web-preview-overflow-menu\s*\{\s*display:\s*inline-flex;\s*\}/)

    const bridge = stubPreviewBridge()
    try {
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          resetKeptPreviewSettings()
          document.documentElement.setAttribute('data-theme', theme)
          document.documentElement.setAttribute('data-density', density)

          const { container, unmount } = render(
            <WebPreviewPanel workspace={workspace} embedded onClose={vi.fn()} />
          )
          await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled()
          })

          const bar = container.querySelector<HTMLElement>('.web-preview-browserbar')
          expect(bar, `${theme}/${density}: browserbar renders`).not.toBeNull()
          expect(bar?.getAttribute('role')).toBe('toolbar')

          // Primary navigation controls & address input stay directly in the browserbar
          expect(within(bar!).getByRole('button', { name: 'Back' })).toBeInTheDocument()
          expect(within(bar!).getByRole('button', { name: 'Forward' })).toBeInTheDocument()
          expect(within(bar!).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
          expect(within(bar!).getByRole('button', { name: 'Go' })).toBeInTheDocument()
          expect(within(bar!).getByTestId('design-mode-toggle')).toHaveAttribute('aria-pressed', 'false')

          // Secondary controls are grouped so @container collapses them cleanly together
          const secondary = bar!.querySelector<HTMLElement>('.web-preview-secondary-controls')
          expect(secondary, `${theme}/${density}: secondary controls container`).not.toBeNull()
          expect(secondary!.querySelector('.web-preview-zoom-controls')).not.toBeNull()
          expect(secondary!.querySelector('.web-preview-device-controls')).not.toBeNull()
          expect(within(secondary!).getByTestId('dev-server-menu')).toBeInTheDocument()
          expect(within(secondary!).getByRole('button', { name: 'Copy the preview to the clipboard' })).toBeInTheDocument()
          expect(within(secondary!).getByRole('button', { name: 'Open in your browser' })).toBeInTheDocument()

          // Overflow trigger is keyboard-accessible and opens the Radix Menu portal with secondary actions
          const moreTrigger = within(bar!).getByTestId('web-preview-more-actions')
          expect(moreTrigger).toHaveAttribute('aria-label', 'More browser actions')
          expect(moreTrigger).toHaveAttribute('data-ui', 'icon-button')

          fireEvent.keyDown(moreTrigger, { key: 'Enter' })
          const menu = await screen.findByTestId('web-preview-overflow-menu')
          expect(within(menu).getByRole('menuitem', { name: 'Zoom out' })).toBeInTheDocument()
          expect(within(menu).getByRole('menuitem', { name: 'Zoom in' })).toBeInTheDocument()
          expect(within(menu).getByRole('menuitem', { name: 'Device emulation' })).toBeInTheDocument()
          expect(within(menu).getByRole('menuitem', { name: 'Dev servers' })).toBeInTheDocument()
          expect(within(menu).getByRole('menuitemcheckbox', { name: 'Design Mode' })).toBeInTheDocument()
          expect(within(menu).getByRole('menuitem', { name: 'Copy the preview to the clipboard' })).toBeInTheDocument()
          expect(within(menu).getByRole('menuitem', { name: 'Open in your browser' })).toBeInTheDocument()

          // Zoom works from the overflow menu
          fireEvent.click(within(menu).getByRole('menuitem', { name: 'Zoom in' }))
          expect(within(bar!).getByText('110%')).toBeInTheDocument()

          fireEvent.keyDown(menu, { key: 'Escape' })
          unmount()
        }
      }

      // Verify pt-BR localized labels (CA-3 / RT-4) and preview-auto-verify in thread mode
      await changeLanguage('pt-BR')
      const { container } = render(
        <WebPreviewPanel workspace={workspace} threadId="thread-1" embedded onClose={vi.fn()} />
      )
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: i18n.t('preview.address', { ns: 'code' }) })).not.toBeDisabled()
      })
      const bar = container.querySelector<HTMLElement>('.web-preview-browserbar')!
      expect(within(bar).getByRole('button', { name: 'Voltar' })).toBeInTheDocument()
      expect(within(bar).getByRole('button', { name: 'Avançar' })).toBeInTheDocument()
      expect(within(bar).getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
      expect(within(bar).getByRole('button', { name: 'Ir' })).toBeInTheDocument()
      expect(within(bar).getByRole('button', { name: 'Abrir no seu navegador' })).toBeInTheDocument()
      expect(within(bar).getByTestId('dev-server-menu')).toBeInTheDocument()
      expect(within(bar).getByTestId('web-preview-more-actions')).toHaveAttribute('aria-label', 'Mais ações do navegador')

      // Enable agent access to confirm preview-auto-verify stays operational
      fireEvent.click(screen.getByLabelText(i18n.t('preview.access.toggleLabel', { ns: 'code' })))
      const allowBtn = await screen.findByRole('button', { name: i18n.t('preview.access.allow', { ns: 'code' }) })
      await act(async () => { fireEvent.click(allowBtn) })
      expect(screen.getByTestId('preview-auto-verify')).toBeInTheDocument()
    } finally {
      bridge.restore()
    }
  })

  test('uses design scale tokens and src/ui Button/IconButton primitives with zero raw buttons in browserbar', async () => {
    const css = read('src/styles/scripts-webpreview.css')
    const rules = parseTopLevelRules(css)

    const barRule = rules.find((r) => r.selector === '.web-preview-browserbar')
    expect(barRule?.decls['min-height']).toBe('var(--bar-lg)')
    expect(barRule?.decls.gap).toBe('var(--space-1)')
    expect(barRule?.decls.padding).toBe('var(--space-1) var(--space-2)')

    const addressRule = rules.find((r) => r.selector === '.web-preview-address-input')
    expect(addressRule?.decls.height).toBe('var(--control-sm)')
    expect(addressRule?.decls['font-size']).toBe('var(--fs-xs)')
    expect(addressRule?.decls['font-weight']).toBe('var(--weight-medium)')

    const zoomRule = rules.find((r) => r.selector === '.web-preview-zoom-controls')
    expect(zoomRule?.decls['font-size']).toBe('var(--fs-xs)')
    expect(zoomRule?.decls['font-weight']).toBe('var(--weight-medium)')

    // Legacy raw-button classes and hardcoded pixel/weight overrides are gone
    expect(rules.find((r) => r.selector === '.web-preview-nav-button')).toBeUndefined()
    expect(css).not.toMatch(/\.web-preview-nav-button/)
    expect(css).not.toMatch(/font-weight:\s*900/)
    expect(css).not.toMatch(/\.web-preview-go-button\s*\{[^}]*height:\s*28px/)
    expect(css).not.toMatch(/\.web-preview-address-input\s*\{[^}]*height:\s*30px/)

    const bridge = stubPreviewBridge()
    try {
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          resetKeptPreviewSettings()
          document.documentElement.setAttribute('data-theme', theme)
          document.documentElement.setAttribute('data-density', density)

          const { container, unmount } = render(
            <WebPreviewPanel workspace={workspace} embedded onClose={vi.fn()} />
          )
          await waitFor(() => {
            expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled()
          })

          const bar = container.querySelector<HTMLElement>('.web-preview-browserbar')!
          const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')]
          expect(buttons.length).toBeGreaterThanOrEqual(10)

          const rawButtons = buttons.filter(
            (btn) => btn.dataset.ui !== 'button' && btn.dataset.ui !== 'icon-button'
          )
          expect(rawButtons, `${theme}/${density}: zero raw <button> in browserbar`).toEqual([])

          for (const btn of buttons) {
            expect(btn.dataset.size, `${theme}/${density}: ${btn.getAttribute('aria-label') || btn.textContent}`).toBe('sm')
          }

          const goButton = within(bar).getByRole('button', { name: 'Go' })
          expect(goButton.dataset.ui).toBe('button')
          expect(goButton.dataset.variant).toBe('primary')
          expect(goButton.dataset.size).toBe('sm')

          unmount()
        }
      }
    } finally {
      bridge.restore()
    }
  })
})
