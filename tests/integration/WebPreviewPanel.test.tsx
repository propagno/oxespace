import { describe, expect, test } from 'vitest'
import { normalizePreviewUrl } from '../../src/components/WebPreview/WebPreviewPanel'

describe('WebPreviewPanel URL policy', () => {
  test('defaults to loopback-only and requires explicit external opt-in', () => {
    expect(normalizePreviewUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizePreviewUrl('https://example.com')).toBeNull()
    expect(normalizePreviewUrl('https://example.com', true)).toBe('https://example.com/')
    expect(normalizePreviewUrl('file:///C:/secret.txt', true)).toBeNull()
  })
})

// OXE-306: the panel and its dev-server hook reset per preview without an effect that sets state synchronously.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { ESLint } from 'eslint'
import { basename } from 'node:path'
import { afterEach, vi } from 'vitest'
import { WebPreviewPanel } from '../../src/components/WebPreview/WebPreviewPanel'
import { AgentBrowserChrome } from '../../src/components/WebPreview/AgentBrowserChrome'
import type { Workspace } from '../../shared/types/workspace'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../shared/types/browser-preview'

describe('OXE-306 · WebPreviewPanel and DevServerMenu', () => {
  afterEach(() => cleanup())

  test('WebPreviewPanel and DevServerMenu reset state on tab or workspace switch without effect-driven sync setState', async () => {
    const sessions = new Map<string, (state: BrowserPreviewSessionState) => void>()
    const session = vi.fn((input: { ownerKey: string; action: string }) => input.action === 'open'
      ? new Promise<BrowserPreviewSessionState>(resolve => { sessions.set(input.ownerKey, resolve) })
      : Promise.resolve({ ownerKey: input.ownerKey, activeTabId: 'a-1', tabs: [] } as unknown as BrowserPreviewSessionState))
    const previous = window.oxe
    Object.defineProperty(window, 'oxe', { configurable: true, value: { browserPreview: { session, onEvent: () => () => {}, designMode: vi.fn(async () => undefined), setAccess: vi.fn(async () => undefined) } } })
    try {
      const view = render(<WebPreviewPanel workspace={{ id: 'project-a', name: 'A' } as Workspace} onClose={() => {}} />)
      const address = (): HTMLInputElement => screen.getByRole('textbox', { name: 'Preview address' }) as HTMLInputElement
      await act(async () => sessions.get('project-a')!({ ownerKey: 'project-a', activeTabId: 'a-1', tabs: [{ id: 'a-1', url: null, loading: false, error: null, canGoBack: false, canGoForward: false }] } as BrowserPreviewSessionState))
      await waitFor(() => expect(address().disabled).toBe(false))

      // Another workspace: its tabs start empty at once (no tab, so no address yet), and only its own session opens.
      view.rerender(<WebPreviewPanel workspace={{ id: 'project-b', name: 'B' } as Workspace} onClose={() => {}} />)
      expect(address().disabled).toBe(true)
      expect(session).toHaveBeenLastCalledWith({ ownerKey: 'project-b', action: 'open' })
      await act(async () => sessions.get('project-b')!({ ownerKey: 'project-b', activeTabId: 'b-1', tabs: [{ id: 'b-1', url: null, loading: false, error: null, canGoBack: false, canGoForward: false }] } as BrowserPreviewSessionState))
      await waitFor(() => expect(address().disabled).toBe(false))
    } finally { Object.defineProperty(window, 'oxe', { configurable: true, value: previous }) }

    // The React Compiler rules (eslint-plugin-react-hooks 7) find nothing left in either file.
    const results = await new ESLint({ cwd: process.cwd() }).lintFiles(['src/components/WebPreview/WebPreviewPanel.tsx', 'src/components/WebPreview/DevServerMenu.tsx'])
    const report = results.flatMap(result => result.messages.map(message => `${basename(result.filePath)}:${message.line} ${message.ruleId ?? 'eslint'} ${message.message.split('\n')[0]}`))
    expect(report).toEqual([])
  }, 120_000)
})

describe('OXE-328 · WebPreview React Compiler compliance', () => {
  afterEach(() => cleanup())

  test('AgentBrowserChrome resets per-tab state on ownerKey or tabId switch without effect-driven sync setState', async () => {
    const listeners = new Set<(event: BrowserPreviewEvent) => void>()
    const previous = window.oxe
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        browserPreview: {
          onEvent: (listener: (event: BrowserPreviewEvent) => void) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
          },
          revokeGrant: vi.fn(async () => undefined)
        }
      }
    })
    const emit = (event: BrowserPreviewEvent): void => {
      act(() => {
        for (const listener of listeners) listener(event)
      })
    }
    try {
      const view = render(<AgentBrowserChrome ownerKey="ws-1" tabId="tab-1" agentName="Claude" />)
      emit({ ownerKey: 'ws-1', tabId: 'tab-1', type: 'grant', grant: { previewSessionId: 'ps-1', origin: 'http://localhost:3000', scope: 'session', grantedAt: 1 } })
      emit({ ownerKey: 'ws-1', tabId: 'tab-1', type: 'broker', attached: true, devToolsOpen: true })
      emit({ ownerKey: 'ws-1', tabId: 'tab-1', type: 'agent-action', phase: 'after', result: 'ok', action: { id: 'a1', kind: 'click', label: 'Save', at: 1 } })
      emit({ ownerKey: 'ws-1', tabId: 'tab-1', type: 'console', row: { level: 'error', message: 'Boom', source: 'app.ts', line: 10 }, at: 1 })

      expect(screen.getByText(/is using this page/)).toBeInTheDocument()
      expect(screen.getByText(/Close the browser's DevTools/)).toBeInTheDocument()
      expect(screen.getByText(/Clicked Save/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Console/ }).textContent).toMatch(/1/)

      // Switching tab resets grant, steps, logs, and DevTools notice synchronously during render.
      view.rerender(<AgentBrowserChrome ownerKey="ws-1" tabId="tab-2" agentName="Claude" />)
      expect(screen.queryByText(/is using this page/)).toBeNull()
      expect(screen.queryByText(/Close the browser's DevTools/)).toBeNull()
      expect(screen.queryByText(/Clicked Save/)).toBeNull()
      expect(screen.getByRole('button', { name: /^Console/ }).textContent).not.toMatch(/1/)

      // Switching ownerKey also resets state cleanly.
      emit({ ownerKey: 'ws-1', tabId: 'tab-2', type: 'grant', grant: { previewSessionId: 'ps-2', origin: 'http://localhost:3000', scope: 'session', grantedAt: 2 } })
      expect(screen.getByText(/is using this page/)).toBeInTheDocument()
      view.rerender(<AgentBrowserChrome ownerKey="ws-2" tabId="tab-2" agentName="Claude" />)
      expect(screen.queryByText(/is using this page/)).toBeNull()
    } finally {
      Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
    }

    // Zero React Compiler / ESLint warnings across all of src/components/WebPreview/.
    const results = await new ESLint({ cwd: process.cwd() }).lintFiles(['src/components/WebPreview/**/*.{ts,tsx}'])
    const report = results.flatMap(result => result.messages.map(message => `${basename(result.filePath)}:${message.line} ${message.ruleId ?? 'eslint'} ${message.message.split('\n')[0]}`))
    expect(report).toEqual([])
  }, 120_000)
})
