// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WebPreviewPanel } from '../src/components/WebPreview/WebPreviewPanel'
import type { Workspace } from '../shared/types/workspace'
import type { BrowserPreviewSessionState } from '../shared/types/browser-preview'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('does not accept an address until the initial browser tab exists', async () => {
  let ready!: (session: BrowserPreviewSessionState) => void
  const initial = new Promise<BrowserPreviewSessionState>(resolve => { ready = resolve })
  const session = vi.fn(() => initial)
  const previous = window.oxe
  Object.defineProperty(window, 'oxe', { configurable: true, value: { browserPreview: {
    session, onEvent: () => () => {}, designMode: vi.fn(), setAccess: vi.fn()
  } } })
  try {
    render(<WebPreviewPanel workspace={{ id: 'project', name: 'Project' } as Workspace} onRunCommand={() => {}} onClose={() => {}} />)
    const address = screen.getByRole('textbox', { name: 'Preview address' }) as HTMLInputElement
    expect(address.disabled).toBe(true)
    fireEvent.keyDown(address, { key: 'Enter' })
    expect(session).toHaveBeenCalledTimes(1)
    await act(async () => ready({ ownerKey: 'project', activeTabId: 'tab-1', tabs: [{ id: 'tab-1', url: null, loading: false, error: null, canGoBack: false, canGoForward: false }] } as BrowserPreviewSessionState))
    await waitFor(() => expect(address.disabled).toBe(false))
    fireEvent.change(address, { target: { value: 'http://127.0.0.1:4321/' } })
    await act(async () => fireEvent.keyDown(address, { key: 'Enter' }))
    expect(session).toHaveBeenLastCalledWith({ ownerKey: 'project', action: 'navigate', tabId: 'tab-1', url: 'http://127.0.0.1:4321/', allowExternal: false })
  } finally { Object.defineProperty(window, 'oxe', { configurable: true, value: previous }) }
})
