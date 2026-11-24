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
import type { Workspace } from '../../shared/types/workspace'
import type { BrowserPreviewSessionState } from '../../shared/types/browser-preview'

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
