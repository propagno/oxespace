/**
 * The command bar's slash commands, as the validation in the real app found them on 2026-11-12 (BAR-1 to BAR-6):
 * /terminal, /new and /theme asked main directly and nothing showed; /pending with nothing waiting closed without a
 * word; /steer with no text and a request main refused left the bar open and silent; /stop asked with no turn running.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandContext, ParsedCommandLine } from '../../shared/command-bar'
import { CommandBar } from '../../src/components/CommandBar/CommandBar'
import { useSkillStore } from '../../src/store/skill.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

afterEach(() => { cleanup(); act(() => { useThreadStore.setState({ snapshot: null }) }) })

type Bridge = Record<string, Record<string, unknown>>
/** The button of the question "/stop" asks before it stops a running turn. */
const STOP = 'Stop'
const CONTEXT: CommandContext = { workspaceId: 'A', threadId: 't-A', pane: { id: 'p-A', agent: true }, enabledSkills: [], requests: [] }

async function bar(context: CommandContext = CONTEXT, bridge: Bridge = {}) {
  const calls = { createPane: vi.fn(async () => ({})), setAppearance: vi.fn(async () => 'dark'), create: vi.fn(async () => ({})), steer: vi.fn(async () => undefined), interrupt: vi.fn(async () => undefined), pendingRequestsAll: vi.fn(async () => []) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe,
    skill: { list: vi.fn(async () => []), invoke: vi.fn(async () => undefined) },
    workspace: { createPane: calls.createPane }, app: { setAppearance: calls.setAppearance },
    thread: { create: calls.create, steer: calls.steer, interrupt: calls.interrupt, pendingRequestsAll: calls.pendingRequestsAll, respond: vi.fn(async () => undefined) },
    ...bridge } })
  act(() => { useSkillStore.setState({ skills: [] as never }); useWorkspaceStore.setState({ workspaces: [] as never }) })
  const onRun = vi.fn<(parsed: ParsedCommandLine) => void>()
  const onOpenChange = vi.fn()
  render(<CommandBar open onOpenChange={onOpenChange} context={context} onRun={onRun} />)
  const input = await screen.findByRole('combobox')
  const run = async (line: string): Promise<void> => { await userEvent.clear(input); await userEvent.type(input, `${line}{Enter}`) }
  return { run, onRun, onOpenChange, calls }
}

describe('the command bar runs what it offers', () => {
  it('/terminal, /new and /theme are the window\'s to run: they go to the host, and main is not asked directly', async () => {
    const { run, onRun, onOpenChange, calls } = await bar()
    for (const [line, id, args] of [['/terminal', 'terminal', ''], ['/new', 'new', ''], ['/theme light', 'theme', 'light']] as const) {
      onRun.mockClear(); onOpenChange.mockClear()
      await run(line)
      await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1))
      expect(onRun.mock.calls[0][0]).toMatchObject({ kind: 'command', id, args })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    }
    expect(calls.createPane).not.toHaveBeenCalled()
    expect(calls.create).not.toHaveBeenCalled()
    expect(calls.setAppearance).not.toHaveBeenCalled()
  })

  it('/pending says nothing is waiting, as /deny does; with a request waiting it goes to the host, which opens the queue', async () => {
    const empty = await bar()
    await empty.run('/pending')
    expect(await screen.findByText('Nothing is waiting for you.')).toBeVisible()
    expect(empty.onRun).not.toHaveBeenCalled()
    expect(empty.onOpenChange).not.toHaveBeenCalledWith(false)
    cleanup()

    const waiting = await bar({ ...CONTEXT, requests: [{ workspaceId: 'A', threadId: 't-A', requestId: 'r-1' }] })
    await waiting.run('/pending')
    await waitFor(() => expect(waiting.onRun).toHaveBeenCalledTimes(1))
    expect(waiting.onRun.mock.calls[0][0]).toMatchObject({ kind: 'command', id: 'pending' })
    expect(waiting.calls.pendingRequestsAll).not.toHaveBeenCalled()
  })

  it('/steer with no text says what is missing and asks main nothing', async () => {
    const { run, calls, onOpenChange } = await bar()
    await run('/steer')
    expect(await screen.findByTestId('command-bar-hint')).toHaveTextContent('Say what to tell the agent: /steer and your message.')
    expect(calls.steer).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('/stop with no turn running says so instead of asking to stop one', async () => {
    const { run, calls } = await bar()
    await run('/stop')
    expect(await screen.findByTestId('command-bar-hint')).toHaveTextContent('No turn is running in the open conversation.')
    // No question with its own Stop button: there is nothing to stop.
    expect(screen.queryByRole('button', { name: STOP })).toBeNull()
    expect(calls.interrupt).not.toHaveBeenCalled()
  })

  it('/stop with a turn running still asks first', async () => {
    act(() => { useThreadStore.setState({ snapshot: { thread: { id: 't-A', status: 'running' }, events: [], turns: [] } as never }) })
    const { run, calls } = await bar()
    await run('/stop')
    expect(await screen.findByRole('button', { name: STOP })).toBeVisible()
    expect(screen.queryByTestId('command-bar-hint')).toBeNull()
    expect(calls.interrupt).not.toHaveBeenCalled()
  })

  it('a request main refuses is said in the bar, which stays open', async () => {
    const steer = vi.fn(async () => { throw new Error("Error invoking remote method 'thread:steer': Error: The agent is not taking messages right now") })
    const { run, onOpenChange } = await bar(CONTEXT, { thread: { steer, respond: vi.fn(async () => undefined), pendingRequestsAll: vi.fn(async () => []) } })
    await run('/steer also update the README')
    expect(await screen.findByTestId('command-bar-hint')).toHaveTextContent('That did not run: The agent is not taking messages right now')
    expect(steer).toHaveBeenCalledWith('t-A', 'also update the README')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
