// Frozen acceptance test for 1.5.0 A58 on screen (DESIGN U3.5, OXE program, phase F3, task FE-A58). Written by the planner;
// the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f3-design.md (U3.5), TECH LEAD G-d (08/11).
// Contract (BACKEND #695 @ 67992154, G-d): a PostToolUse whose result the hook cut reaches the window as an
// AgentHookStatusEvent (window.oxe.agentHooks.onStatus) with `toolUseId` and `output: { truncated: true, keptBytes,
// totalBytes? }`; a result that wasn't cut has no `output`. src/store/tool-output-cut.store.ts exports
// startToolOutputCuts() (subscribes once, returns the unsubscribe) and useToolOutputCuts; src/components/Threads/
// toolOutputCut.tsx exports cutNote(keptBytes, totalBytes?). ThreadActivityGroup shows the note on the tool row whose id is
// that toolUseId. A cut is never silent, and the row keeps the command's real state.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Cut = { cutNote: (keptBytes: number, totalBytes?: number) => string }
type CutStore = { startToolOutputCuts: () => () => void; useToolOutputCuts: { setState(state: Record<string, unknown>, replace?: boolean): void; getState(): Record<string, unknown> } }
const KEPT = 4096
const TOTAL = Math.round(5.1 * 1024 * 1024)
const tool = (id: string, o: Record<string, unknown> = {}) => ({
  type: 'tool', id, name: 'Bash', state: 'completed', detail: 'cat big.log', exitCode: 0, startedAt: 1, completedAt: 2, output: 'x'.repeat(KEPT), ...o
})
const hookEvent = (toolUseId: string, output?: Record<string, unknown>) => ({
  paneId: 'thread:t-1', workspaceId: 'ws-1', agent: 'claude', state: 'idle', event: 'PostToolUse', at: Date.now(), sessionId: 's-1', toolUseId, ...(output ? { output } : {})
})

// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
/** Starts the store against a fake onStatus and returns the function that delivers one hook event. */
async function startCuts(): Promise<(event: Record<string, unknown>) => void> {
  let deliver: (event: Record<string, unknown>) => void = () => undefined
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentHooks: { onStatus: vi.fn((listener: typeof deliver) => { deliver = listener; return () => undefined }) } } })
  const store = await load<CutStore>('src/store/tool-output-cut.store')
  stops.push(store.startToolOutputCuts())
  return event => act(() => deliver(event))
}
async function showTool(id: string): Promise<void> {
  const { ThreadActivityGroup } = await import('../../../src/components/Threads/ThreadActivityGroup')
  render(<ThreadActivityGroup events={[tool(id) as never]} mode="verbose" />)
  const toggle = screen.queryAllByRole('button').find(button => button.getAttribute('aria-expanded') === 'false')
  if (toggle) await userEvent.click(toggle)
}
const stops: Array<() => void> = []

afterEach(async () => { for (const stop of stops.splice(0)) stop(); cleanup(); await changeLanguage('en') })

describe('U3.5 · a cut output is never silent', () => {
  test('the note gives the kept size and the full size, one decimal, in the window language', async () => {
    const { cutNote } = await load<Cut>('src/components/Threads/toolOutputCut')
    expect(cutNote(KEPT, TOTAL)).toBe('Output cut to the first 4.0 KB of 5.1 MB')
    expect(cutNote(KEPT)).toBe('Output cut to the first 4.0 KB')
    await changeLanguage('pt-BR')
    expect(cutNote(KEPT, TOTAL)).toBe('Saída cortada nos primeiros 4,0 KB de 5,1 MB')
    expect(cutNote(KEPT)).toBe('Saída cortada nos primeiros 4,0 KB')
  })

  test('a 5 MiB tool output cut by the hook shows its real state, the cut note and no more than 4 KB of output', async () => {
    const deliver = await startCuts()
    deliver(hookEvent('tool-1', { truncated: true, keptBytes: KEPT, totalBytes: TOTAL }))
    await showTool('tool-1')
    expect(await screen.findByText('Output cut to the first 4.0 KB of 5.1 MB')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bRunning\b/)
    const longest = Math.max(0, ...[...document.querySelectorAll('pre, code')].map(element => element.textContent?.length ?? 0))
    expect(longest).toBeLessThanOrEqual(KEPT)
  })

  test('past 8 MiB the note gives only the kept size', async () => {
    const deliver = await startCuts()
    deliver(hookEvent('tool-2', { truncated: true, keptBytes: KEPT }))
    await showTool('tool-2')
    expect(await screen.findByText('Output cut to the first 4.0 KB')).toBeInTheDocument()
  })

  test('a result that was not cut, or a cut for another tool, adds no note', async () => {
    const deliver = await startCuts()
    deliver(hookEvent('tool-3'))
    deliver(hookEvent('tool-other', { truncated: true, keptBytes: KEPT, totalBytes: TOTAL }))
    await showTool('tool-3')
    expect(screen.queryByText(/Output cut/)).toBeNull()
  })
})
