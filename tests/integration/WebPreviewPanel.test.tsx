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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ESLint } from 'eslint'
import { basename } from 'node:path'
import { afterEach, vi } from 'vitest'
import { resetKeptPreviewSettings, WebPreviewPanel } from '../../src/components/WebPreview/WebPreviewPanel'
import { AgentBrowserChrome } from '../../src/components/WebPreview/AgentBrowserChrome'
import { i18n } from '../../src/i18n'
import type { Workspace } from '../../shared/types/workspace'
import type { BrowserPreviewEvent, BrowserPreviewMount, BrowserPreviewSessionState } from '../../shared/types/browser-preview'

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

describe('OXE-442 · OxeChat WebPreview preserves access and settings across chat switches', () => {
  afterEach(() => {
    cleanup()
    resetKeptPreviewSettings()
    vi.unstubAllGlobals()
  })

  function installStatefulPreviewBridge(initialUrls: Record<string, string | null> = {}) {
    interface OwnerState {
      tabId: string
      url: string | null
      agentAccess: boolean
      allowExternal: boolean
      autoVerify?: boolean
      zoom?: number
      deviceId?: string | null
      rotated?: boolean
    }
    const owners = new Map<string, OwnerState>()
    const ensure = (ownerKey: string): OwnerState => {
      let state = owners.get(ownerKey)
      if (!state) {
        const suffix = ownerKey.replace(/[^a-z0-9]/gi, '-')
        state = {
          tabId: `tab-${suffix}`,
          url: initialUrls[ownerKey] ?? 'http://localhost:3000/',
          agentAccess: false,
          allowExternal: false
        }
        owners.set(ownerKey, state)
      }
      return state
    }
    const snapshot = (ownerKey: string): BrowserPreviewSessionState => {
      const s = ensure(ownerKey)
      return {
        ownerKey,
        sessionId: `session-${ownerKey}`,
        activeTabId: s.tabId,
        agentAccess: s.agentAccess,
        allowExternal: s.allowExternal,
        ...(s.autoVerify !== undefined ? { autoVerify: s.autoVerify } : {}),
        ...(s.zoom !== undefined ? { zoom: s.zoom } : {}),
        ...(s.deviceId !== undefined ? { deviceId: s.deviceId, rotated: s.rotated === true } : {}),
        tabs: [{ id: s.tabId, url: s.url, title: 'Preview', loading: false, error: null, canGoBack: false, canGoForward: false }]
      }
    }
    const listeners = new Set<(event: BrowserPreviewEvent) => void>()
    const session = vi.fn(async (input: { ownerKey: string; action: string; url?: string; allowExternal?: boolean }) => {
      const s = ensure(input.ownerKey)
      if (input.action === 'navigate' && typeof input.url === 'string') {
        s.url = input.url
        if (typeof input.allowExternal === 'boolean') s.allowExternal = input.allowExternal
      }
      return snapshot(input.ownerKey)
    })
    const mount = vi.fn(async (input: BrowserPreviewMount) => {
      const s = ensure(input.ownerKey)
      s.allowExternal = input.allowExternal
      s.agentAccess = input.agentAccess && s.agentAccess
      return { lease: `lease-${input.ownerKey}` }
    })
    const setAccess = vi.fn(async (input: { ownerKey: string; tabId: string; agentAccess: boolean; allowExternal: boolean; grant?: boolean; autoVerify?: boolean }) => {
      const s = ensure(input.ownerKey)
      s.allowExternal = input.allowExternal
      if (typeof input.autoVerify === 'boolean') s.autoVerify = input.autoVerify
      // T43: main grants only with grant:true; turning off always applies.
      s.agentAccess = input.agentAccess && (input.grant === true || s.agentAccess)
      return { agentAccess: s.agentAccess }
    })
    const setZoom = vi.fn(async (input: { ownerKey: string; tabId: string; zoom: number }) => {
      ensure(input.ownerKey).zoom = input.zoom
    })
    const setDevice = vi.fn(async (input: { ownerKey: string; tabId: string; deviceId: string | null; rotated: boolean }) => {
      const s = ensure(input.ownerKey)
      s.deviceId = input.deviceId
      s.rotated = input.deviceId === null ? false : input.rotated
    })
    const close = vi.fn(async () => undefined)
    const bounds = vi.fn(async () => undefined)
    const onEvent = vi.fn((listener: (event: BrowserPreviewEvent) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    })

    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
    if (typeof HTMLElement.prototype.checkVisibility !== 'function') {
      Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, value: () => true })
    }
    const previous = window.oxe
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        browserPreview: { session, mount, setAccess, setZoom, setDevice, close, bounds, onEvent, designMode: vi.fn(async () => undefined) },
        fs: { readFile: vi.fn(async () => { throw new Error('ENOENT') }), listTree: vi.fn(async () => []) },
        terminal: { onData: vi.fn(() => () => undefined), onExit: vi.fn(() => () => undefined) }
      }
    })
    return {
      owners,
      session,
      mount,
      setAccess,
      setZoom,
      setDevice,
      close,
      revoke(ownerKey: string) {
        ensure(ownerKey).agentAccess = false
      },
      restore() {
        Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
      }
    }
  }

  const workspace = { id: 'ws-chat', name: 'Chat Project', rootPath: '', panes: [] } as unknown as Workspace
  const agentToggleLabel = (): string => i18n.t('preview.access.toggleLabel', { ns: 'code' })
  const agentAllowLabel = (): string => i18n.t('preview.access.allow', { ns: 'code' })

  test('unmounting and remounting WebPreviewPanel for Thread A preserves all grants & settings without sending false', async () => {
    const user = userEvent.setup()
    const bridge = installStatefulPreviewBridge({ 'thread:thread-a': 'https://example.com/' })
    bridge.owners.set('thread:thread-a', {
      tabId: 'tab-a',
      url: 'http://localhost:3000/',
      agentAccess: false,
      allowExternal: false
    })
    try {
      const first = render(<WebPreviewPanel workspace={workspace} threadId="thread-a" embedded onClose={() => {}} />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled())

      // Enable External preview and navigate to an external URL.
      const externalToggle = (): HTMLInputElement => screen.getByLabelText('External') as HTMLInputElement
      const agentToggle = (): HTMLInputElement => screen.getByRole('checkbox', { name: agentToggleLabel() }) as HTMLInputElement
      fireEvent.click(externalToggle())
      expect(externalToggle().checked).toBe(true)
      const address = screen.getByRole('textbox', { name: 'Preview address' })
      fireEvent.change(address, { target: { value: 'https://example.com/' } })
      await act(async () => { fireEvent.keyDown(address, { key: 'Enter' }) })

      // Grant Agent access through consent dialog.
      fireEvent.click(agentToggle())
      const allowBtn = await screen.findByRole('button', { name: agentAllowLabel() })
      await act(async () => { fireEvent.click(allowBtn) })
      await waitFor(() => expect(agentToggle().checked).toBe(true))

      // Turn Auto-verify OFF, adjust Zoom to 120%, and select Pixel 8 rotated.
      const autoVerify = screen.getByTestId('preview-auto-verify') as HTMLInputElement
      expect(autoVerify.checked).toBe(true)
      fireEvent.click(autoVerify)
      expect(autoVerify.checked).toBe(false)

      const zoomInBtn = screen.getByRole('button', { name: 'Zoom in' })
      fireEvent.click(zoomInBtn)
      fireEvent.click(zoomInBtn)
      expect(screen.getByText('120%')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Desktop/ }))
      await user.click(await screen.findByRole('menuitemradio', { name: /Pixel 8/ }))
      await user.click(screen.getByRole('button', { name: 'Rotate' }))
      await waitFor(() => expect(screen.getAllByText(/Pixel 8 · 915 × 412/).length).toBeGreaterThan(0))

      // Wait for all IPC updates to flush, then switch away (unmount) and clear spies.
      await waitFor(() => {
        expect(bridge.owners.get('thread:thread-a')).toMatchObject({
          agentAccess: true,
          allowExternal: true,
          autoVerify: false,
          zoom: 120,
          deviceId: 'pixel-8',
          rotated: true
        })
      })
      first.unmount()
      bridge.mount.mockClear()
      bridge.setAccess.mockClear()
      bridge.setZoom.mockClear()
      bridge.setDevice.mockClear()

      // Return to Thread A: remount WebPreviewPanel.
      render(<WebPreviewPanel workspace={workspace} threadId="thread-a" embedded onClose={() => {}} />)
      await waitFor(() => expect(bridge.mount).toHaveBeenCalled())
      await waitFor(() => expect(bridge.setDevice).toHaveBeenCalled())

      expect(externalToggle().checked).toBe(true)
      expect(agentToggle().checked).toBe(true)
      expect((screen.getByTestId('preview-auto-verify') as HTMLInputElement).checked).toBe(false)
      expect(screen.getByText('120%')).toBeInTheDocument()
      expect(screen.getAllByText(/Pixel 8 · 915 × 412/).length).toBeGreaterThan(0)
      expect(screen.queryByText(/External preview is off/i)).toBeNull()

      // Neither mount nor setAccess may EVER send agentAccess:false or allowExternal:false on return!
      for (const [payload] of bridge.mount.mock.calls) {
        expect(payload.agentAccess).toBe(true)
        expect(payload.allowExternal).toBe(true)
      }
      for (const [payload] of bridge.setAccess.mock.calls) {
        expect(payload.agentAccess).toBe(true)
        expect(payload.allowExternal).toBe(true)
        expect(payload.autoVerify).toBe(false)
      }
      expect(bridge.setZoom).toHaveBeenCalledWith({ ownerKey: 'thread:thread-a', tabId: 'tab-a', zoom: 120 })
      expect(bridge.setDevice).toHaveBeenCalledWith({ ownerKey: 'thread:thread-a', tabId: 'tab-a', deviceId: 'pixel-8', rotated: true })
    } finally {
      cleanup()
      bridge.restore()
    }
  })

  test('switching threadId directly (thread-a -> thread-b -> thread-a) isolates thread-b and restores thread-a intact', async () => {
    const bridge = installStatefulPreviewBridge()
    try {
      const view = render(<WebPreviewPanel workspace={workspace} threadId="thread-a" embedded onClose={() => {}} />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled())

      const externalToggle = (): HTMLInputElement => screen.getByLabelText('External') as HTMLInputElement
      const agentToggle = (): HTMLInputElement => screen.getByRole('checkbox', { name: agentToggleLabel() }) as HTMLInputElement

      // Configure Thread A.
      fireEvent.click(externalToggle())
      fireEvent.click(agentToggle())
      await act(async () => { fireEvent.click(await screen.findByRole('button', { name: agentAllowLabel() })) })
      await waitFor(() => expect(agentToggle().checked).toBe(true))
      fireEvent.click(screen.getByTestId('preview-auto-verify'))
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      expect(screen.getByText('110%')).toBeInTheDocument()

      await waitFor(() => {
        expect(bridge.owners.get('thread:thread-a')).toMatchObject({ agentAccess: true, allowExternal: true, autoVerify: false, zoom: 110 })
      })

      // Switch directly to Thread B while panel stays mounted.
      bridge.mount.mockClear()
      bridge.setAccess.mockClear()
      view.rerender(<WebPreviewPanel workspace={workspace} threadId="thread-b" embedded onClose={() => {}} />)

      // Thread B starts clean immediately (zero leak from Thread A).
      expect(externalToggle().checked).toBe(false)
      expect(agentToggle().checked).toBe(false)
      expect(screen.getByText('100%')).toBeInTheDocument()
      await waitFor(() => expect(bridge.mount).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: 'thread:thread-b', agentAccess: false, allowExternal: false })))
      expect(bridge.setAccess).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: 'thread:thread-b', agentAccess: false, allowExternal: false }))

      // Switch back to Thread A.
      bridge.mount.mockClear()
      bridge.setAccess.mockClear()
      view.rerender(<WebPreviewPanel workspace={workspace} threadId="thread-a" embedded onClose={() => {}} />)

      await waitFor(() => expect(bridge.mount).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: 'thread:thread-a', agentAccess: true, allowExternal: true })))
      expect(externalToggle().checked).toBe(true)
      expect(agentToggle().checked).toBe(true)
      expect((screen.getByTestId('preview-auto-verify') as HTMLInputElement).checked).toBe(false)
      expect(screen.getByText('110%')).toBeInTheDocument()
      for (const [payload] of bridge.setAccess.mock.calls) {
        expect(payload.ownerKey).toBe('thread:thread-a')
        expect(payload.agentAccess).toBe(true)
        expect(payload.allowExternal).toBe(true)
      }
    } finally {
      cleanup()
      bridge.restore()
    }
  })

  test('T43: if main revoked agentAccess while away, returning to Thread A reflects agentAutomation=false and keeps it off', async () => {
    const bridge = installStatefulPreviewBridge()
    try {
      const first = render(<WebPreviewPanel workspace={workspace} threadId="thread-revoked" embedded onClose={() => {}} />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled())

      const externalToggle = (): HTMLInputElement => screen.getByLabelText('External') as HTMLInputElement
      const agentToggle = (): HTMLInputElement => screen.getByRole('checkbox', { name: agentToggleLabel() }) as HTMLInputElement

      fireEvent.click(externalToggle())
      fireEvent.click(agentToggle())
      await act(async () => { fireEvent.click(await screen.findByRole('button', { name: agentAllowLabel() })) })
      await waitFor(() => expect(agentToggle().checked).toBe(true))
      first.unmount()

      // Main revokes agent access while the user is in another chat.
      bridge.revoke('thread:thread-revoked')
      bridge.mount.mockClear()
      bridge.setAccess.mockClear()

      const second = render(<WebPreviewPanel workspace={workspace} threadId="thread-revoked" embedded onClose={() => {}} />)
      await waitFor(() => expect(bridge.mount).toHaveBeenCalled())

      // Main is authoritative: agentAccess is OFF, while allowExternal stays ON.
      expect(agentToggle().checked).toBe(false)
      expect(externalToggle().checked).toBe(true)
      expect(bridge.mount).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: 'thread:thread-revoked', agentAccess: false, allowExternal: true }))
      second.unmount()

      // Remounting again with a session omitting agentAccess never resurrects the revoked grant.
      bridge.session.mockResolvedValueOnce({
        ownerKey: 'thread:thread-revoked',
        sessionId: 'session-thread:thread-revoked',
        activeTabId: 'tab-thread-thread-revoked',
        tabs: [{ id: 'tab-thread-thread-revoked', url: 'http://localhost:3000/', title: 'Preview', loading: false, error: null, canGoBack: false, canGoForward: false }]
      })
      render(<WebPreviewPanel workspace={workspace} threadId="thread-revoked" embedded onClose={() => {}} />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled())
      expect(agentToggle().checked).toBe(false)
    } finally {
      cleanup()
      bridge.restore()
    }
  })

  test('explicitly turning off agent access persists off across unmount/remount (T43)', async () => {
    const bridge = installStatefulPreviewBridge()
    try {
      const first = render(<WebPreviewPanel workspace={workspace} threadId="thread-off" embedded onClose={() => {}} />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled())

      const agentToggle = (): HTMLInputElement => screen.getByRole('checkbox', { name: agentToggleLabel() }) as HTMLInputElement
      fireEvent.click(agentToggle())
      await act(async () => { fireEvent.click(await screen.findByRole('button', { name: agentAllowLabel() })) })
      await waitFor(() => expect(agentToggle().checked).toBe(true))

      // User explicitly disables agent access.
      fireEvent.click(agentToggle())
      await waitFor(() => expect(bridge.owners.get('thread:thread-off')?.agentAccess).toBe(false))
      first.unmount()

      render(<WebPreviewPanel workspace={workspace} threadId="thread-off" embedded onClose={() => {}} />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Preview address' })).not.toBeDisabled())
      expect(agentToggle().checked).toBe(false)
    } finally {
      cleanup()
      bridge.restore()
    }
  })
})
