import { act, cleanup, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { Workspace } from '../../../shared/types/workspace'
import { WebPreviewPanel } from '../../../src/components/WebPreview/WebPreviewPanel'

// OXE-305: the Web Preview's tabs, new tab, problems banner and design Review were the last raw <button>s of the panel;
// they are src/ui Button/IconButton now, with the primitives' height, focus and hover.

afterEach(() => cleanup())

describe('OXE-305 · Web Preview controls are src/ui primitives', () => {
  test('WebPreviewPanel renders zero raw button elements across tabs, problems banner and design hint', async () => {
    let ready!: (state: BrowserPreviewSessionState) => void
    const session = vi.fn((input: { action: string }) => input.action === 'open'
      ? new Promise<BrowserPreviewSessionState>(resolve => { ready = resolve })
      : Promise.resolve({ ownerKey: 'project', activeTabId: 't-1', tabs: [] } as unknown as BrowserPreviewSessionState))
    const previous = window.oxe
    Object.defineProperty(window, 'oxe', { configurable: true, value: { browserPreview: { session, onEvent: () => () => {}, designMode: vi.fn(async () => undefined), setAccess: vi.fn(async () => undefined) } } })
    try {
      render(<WebPreviewPanel workspace={{ id: 'project', name: 'Project' } as Workspace} onClose={() => {}} />)
      await act(async () => ready({ ownerKey: 'project', activeTabId: 't-1', tabs: [
        { id: 't-1', url: 'http://localhost:3000/', loading: false, error: null, canGoBack: false, canGoForward: false },
        { id: 't-2', url: null, loading: false, error: null, canGoBack: false, canGoForward: false }
      ] } as BrowserPreviewSessionState))
      const strip = screen.getByRole('group', { name: 'Browser tabs' })
      const buttons = within(strip).getAllByRole('button')
      expect(buttons.length).toBe(5)
      for (const button of buttons) expect(button.getAttribute('data-ui'), button.getAttribute('aria-label') ?? '').toMatch(/^(button|icon-button)$/)
      expect(within(strip).getByRole('button', { name: /^Tab 1/ })).toHaveAttribute('aria-current', 'true')
    } finally { Object.defineProperty(window, 'oxe', { configurable: true, value: previous }) }
  })

  test('[source] no raw <button> is left in WebPreviewPanel.tsx; the banner and design hint use Button and IconButton', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/components/WebPreview/WebPreviewPanel.tsx'), 'utf8')
    expect(tsx).not.toMatch(/<button\b/)
    expect(tsx).toMatch(/<Button[^>]*className="web-preview-problems-send"/)
    expect(tsx).toMatch(/<IconButton[^>]*className="web-preview-problems-dismiss"/)
    expect(tsx).toMatch(/<Button[^>]*className="web-preview-design-review"/)
    expect(tsx).toMatch(/<IconButton[^>]*className="web-preview-new-tab"/)
  })

  test('[css] the problems and design controls no longer pin their own heights or paddings', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/scripts-webpreview.css'), 'utf8')
    for (const name of ['web-preview-problems-send', 'web-preview-problems-dismiss', 'web-preview-design-review', 'web-preview-new-tab']) {
      const rules = [...css.matchAll(new RegExp(`[^}]*\\.${name}\\b[^{]*\\{([^}]*)\\}`, 'g'))].map(match => match[1]).join(' ')
      expect(rules, name).not.toMatch(/(^|[\s;])(height|width|padding)\s*:/)
    }
  })
})
