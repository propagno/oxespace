// Frozen acceptance test for 1.5.0 A56 / N6, the window's side (DESIGN U7.5, OXE program, phase F7, task FE-AP5). Written
// by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f7-design.md (U7.5).
// Contract (BACKEND #714 §Contract): main's ApprovalNotifier shows the system notification (only Open; BACKEND's a56 test)
// and, on Open, focuses the window and pushes the request id: window.oxe.approvals.onOpenRequest(cb: (requestId) => void)
// → unsubscribe. The renderer part, in src/components/Approvals/openRequest.ts: useOpenRequest (zustand: { requestId,
// open(id), close() }) and startOpenRequestListener() → stop, which opens what main asked for. The window shows the
// preview for an irreversible request and its card for a reversible one (ApprovalsHost); with Deny focused (u72).
// U7.5b (no system notification while focused, the toast instead) is main's focus check plus u71's toast.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

type OpenRequest = {
  useOpenRequest: { getState(): { requestId: string | null; open(id: string): void; close(): void } }
  startOpenRequestListener(): () => void
}
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
function mockMain() {
  const listeners: Array<(requestId: string) => void> = []
  const unsubscribe = vi.fn()
  const approvals = { onOpenRequest: vi.fn((listener: (requestId: string) => void) => { listeners.push(listener); return unsubscribe }) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, approvals } })
  return { approvals, unsubscribe, push: (requestId: string) => act(() => { for (const listener of listeners) listener(requestId) }) }
}

afterEach(async () => {
  const { useOpenRequest } = await load<OpenRequest>('src/components/Approvals/openRequest')
  act(() => useOpenRequest.getState().close())
})

describe('U7.5 · The system notification opens the request', () => {
  test("Open in the notification opens that request in the window", async () => {
    const main = mockMain()
    const { useOpenRequest, startOpenRequestListener } = await load<OpenRequest>('src/components/Approvals/openRequest')
    const stop = startOpenRequestListener()
    expect(main.approvals.onOpenRequest).toHaveBeenCalledTimes(1)
    expect(useOpenRequest.getState().requestId).toBeNull()
    main.push('r7')
    expect(useOpenRequest.getState().requestId).toBe('r7')
    stop()
    expect(main.unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('a later Open replaces the one before, and closing clears it', async () => {
    const main = mockMain()
    const { useOpenRequest, startOpenRequestListener } = await load<OpenRequest>('src/components/Approvals/openRequest')
    const stop = startOpenRequestListener()
    main.push('r1')
    main.push('r2')
    expect(useOpenRequest.getState().requestId).toBe('r2')
    act(() => useOpenRequest.getState().close())
    expect(useOpenRequest.getState().requestId).toBeNull()
    stop()
  })

  test('a window without the channel starts no listener and does not throw', async () => {
    Object.assign(window, { oxe: {} })
    const { startOpenRequestListener } = await load<OpenRequest>('src/components/Approvals/openRequest')
    expect(() => startOpenRequestListener()()).not.toThrow()
  })
})
