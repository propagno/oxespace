import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativePreviewHost } from '../src/components/WebPreview/NativePreviewHost'

/**
 * #243 (documentation-preview on CI): a dialog over the window marks the native preview covered. When it closes, the
 * preview must be reported visible again even when animation frames are paused (a window without the system's focus,
 * right after a native dialog); otherwise main keeps the preview covered and refuses the agent's next action.
 */
const bounds = vi.fn(async () => undefined)
beforeEach(() => {
  vi.useFakeTimers()
  // Frames never fire, as in a window that lost the system's focus.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200, toJSON: () => ({}) } as DOMRect)
  ;(HTMLElement.prototype as unknown as { checkVisibility: () => boolean }).checkVisibility = () => true
  bounds.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  ;(window as unknown as { oxe: unknown }).oxe = { browserPreview: { mount: async () => ({ lease: 'l' }), bounds, setZoom: async () => undefined, close: async () => undefined } }
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const lastVisible = (): boolean | undefined => (bounds.mock.calls.at(-1) as unknown as [{ visible: boolean }] | undefined)?.[0].visible

describe('the native preview reports its visibility without animation frames', () => {
  it('covered while a dialog is up, and visible again once it closes', async () => {
    render(<NativePreviewHost mount={{ ownerKey: 'ws', tabId: 't1', url: 'http://localhost:1/', workspaceId: 'ws', allowExternal: false, agentAccess: true } as never} active zoom={1} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(150) })
    expect(lastVisible()).toBe(true)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    await act(async () => { document.body.append(dialog); await Promise.resolve(); vi.advanceTimersByTime(150) })
    expect(lastVisible()).toBe(false)

    await act(async () => { dialog.remove(); await Promise.resolve(); vi.advanceTimersByTime(150) })
    expect(lastVisible()).toBe(true)
  })
})
