// Frozen acceptance test for 1.5.0 A22 and A23 on screen (DESIGN U6.4 and U6.5, OXE program, phase F6, tasks FE-T77 and
// FE-A23). Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f6-design.md.
// Contract (BACKEND #709 @ 7000ab74): thread.background(threadId) → [{ id, command, startedBy: 'oxespace'|'agent',
// state: 'running'|'stopped'|'unknown', exitCode?, since, tail[≤5], canStop }], pushed by thread.onBackgroundChanged; an
// OXESpace job stops through the existing window.oxe.background.stop(jobId). A23 is renderer only (TECH LEAD 08/11).
// The renderer parts:
// - ThreadBackgroundShells({ threadId }) in src/components/Threads/ThreadBackgroundShells.tsx (the cards);
// - THREAD_TOOL_PANELS, the "+ Tool" list in order, and clampToolPanelWidth(width, available) in
//   src/components/Threads/threadToolPanels.ts (the panel never under 320 px).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Shell = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const at = (h: number, m: number): number => { const date = new Date(); date.setHours(h, m, 0, 0); return date.getTime() }
const shell = (id: string, o: Shell = {}): Shell => ({ id, command: 'npm run dev', startedBy: 'oxespace', state: 'running', since: Date.now() - 90_000, tail: ['l1', 'l2', 'l3', 'l4', 'l5'], canStop: true, ...o })

function mockMain(first: Shell[]) {
  let shells = first
  const listeners: Array<(event: unknown) => void> = []
  const thread = { background: vi.fn(async () => shells), onBackgroundChanged: vi.fn((listener: (event: unknown) => void) => { listeners.push(listener); return () => undefined }) }
  const background = { stop: vi.fn(async () => undefined) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread, background } })
  return { thread, background, push: (next: Shell[]) => { shells = next; act(() => { for (const listener of listeners) listener({ threadId: 't-1' }) }) } }
}
async function renderShells() {
  const { ThreadBackgroundShells } = await load<{ ThreadBackgroundShells: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/ThreadBackgroundShells')
  render(<ThreadBackgroundShells threadId="t-1" />)
}
const card = (command: string): HTMLElement => screen.getAllByText(command)[0].closest('article, section, li') as HTMLElement

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U6.4 · the background shell', () => {
  test('a running shell shows its command, a live state and the last 5 lines, then Stopped with its exit code', async () => {
    const main = mockMain([shell('j1')])
    await renderShells()
    expect(await screen.findByText('npm run dev')).toBeInTheDocument()
    expect(main.thread.background).toHaveBeenCalledWith('t-1')
    expect(within(card('npm run dev')).getByText(/Running/)).toBeInTheDocument()
    for (const text of ['l1', 'l5']) expect(within(card('npm run dev')).getByText(text)).toBeInTheDocument()
    expect(within(card('npm run dev')).getByRole('button', { name: 'Show output' })).toBeInTheDocument()
    main.push([shell('j1', { state: 'stopped', exitCode: 1, canStop: false })])
    expect(await within(card('npm run dev')).findByText('exit 1')).toBeInTheDocument()
    expect(within(card('npm run dev')).queryByText(/Running/)).toBeNull()
  })

  test('a lost signal reads "State unknown since HH:MM", never Running', async () => {
    mockMain([shell('j1', { state: 'unknown', since: at(14, 41), canStop: false })])
    await renderShells()
    expect(await screen.findByText('State unknown since 14:41')).toBeInTheDocument()
    expect(screen.queryByText(/Running/)).toBeNull()
  })

  test('Stop shows only for a job OXESpace started, and an agent shell says to stop it from the conversation', async () => {
    const main = mockMain([shell('j1'), shell('a1', { command: 'tail -f log', startedBy: 'agent', canStop: false })])
    await renderShells()
    await userEvent.click(await within(card('npm run dev')).findByRole('button', { name: 'Stop' }))
    expect(main.background.stop).toHaveBeenCalledWith('j1')
    expect(within(card('tail -f log')).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(card('tail -f log')).getByText('Stop it from the conversation')).toBeInTheDocument()
  })
})

describe('U6.5 · tools beside the conversation', () => {
  test('"+ Tool" lists exactly the cockpit panels, with no Linear and no search by meaning', async () => {
    const { THREAD_TOOL_PANELS } = await load<{ THREAD_TOOL_PANELS: ReadonlyArray<{ id: string; label: string }> }>('src/components/Threads/threadToolPanels')
    expect(THREAD_TOOL_PANELS.map(panel => panel.label)).toEqual([
      'Files', 'Browser', 'Android device', 'HTTP calls', 'Containers', 'Git and pull request', 'Scripts', 'Search', 'Worktrees', 'Background'
    ])
    expect(THREAD_TOOL_PANELS.map(panel => panel.label).join(' ')).not.toMatch(/Linear|meaning/i)
  })

  test('the tool panel never goes under 320 px and always leaves the conversation its room', async () => {
    const { clampToolPanelWidth } = await load<{ clampToolPanelWidth: (width: number, available: number) => number }>('src/components/Threads/threadToolPanels')
    expect(clampToolPanelWidth(100, 1400)).toBe(320)
    expect(clampToolPanelWidth(500, 1400)).toBe(500)
    expect(clampToolPanelWidth(1300, 1400)).toBeLessThanOrEqual(1400 - 360)
    expect(clampToolPanelWidth(1300, 1400)).toBeGreaterThanOrEqual(320)
  })

  test('with two cells, the close on the inactive right side closes it in one click without activating it first', async () => {
    const { useThreadStore } = await import('../../../src/store/thread.store')
    useThreadStore.setState({ selectedId: 't-1', secondaryId: 't-2', activeCell: 'primary' } as never)
    const { ThreadCellClose } = await load<{ ThreadCellClose: (props: { cell: 'primary' | 'secondary' }) => JSX.Element }>('src/components/Threads/ThreadCellClose')
    render(<ThreadCellClose cell="secondary" />)
    await userEvent.click(screen.getByRole('button', { name: /^Close/ }))
    expect(useThreadStore.getState().secondaryId).toBeNull()
    expect(useThreadStore.getState().selectedId).toBe('t-1')
  })

  test('the tool panel splitter resizes with the arrow keys and holds the 320 px floor', async () => {
    const { ToolPanelSplitter } = await load<{ ToolPanelSplitter: (props: { width: number; available: number; onChange: (width: number) => void }) => JSX.Element }>('src/components/Threads/threadToolPanels')
    let width = 336
    const onChange = vi.fn((next: number) => { width = next })
    const { rerender } = render(<ToolPanelSplitter width={width} available={1400} onChange={onChange} />)
    const separator = screen.getByRole('separator')
    expect(separator).toHaveAttribute('aria-valuenow', '336')
    expect(separator).toHaveAttribute('aria-valuemin', '320')
    separator.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenCalled()
    rerender(<ToolPanelSplitter width={width} available={1400} onChange={onChange} />)
    for (let step = 0; step < 6; step++) { await userEvent.keyboard('{ArrowRight}'); rerender(<ToolPanelSplitter width={width} available={1400} onChange={onChange} />) }
    for (let step = 0; step < 6; step++) { await userEvent.keyboard('{ArrowLeft}'); rerender(<ToolPanelSplitter width={width} available={1400} onChange={onChange} />) }
    expect(Math.min(...onChange.mock.calls.map(([next]) => next as number))).toBeGreaterThanOrEqual(320)
  })

})
