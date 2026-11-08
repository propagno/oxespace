// Frozen acceptance test for 1.5.0 A20 and A21 on screen (DESIGN U6.2 and U6.3, OXE program, phase F6, tasks FE-FOLD and
// FE-T76). Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f6-design.md.
// Contract (BACKEND #709 @ 7000ab74): shared/thread-tool-rows.ts exports toolRow, foldSummary(rows) → { steps, read, edited,
// ran, queries, http, containers, other, failed, fixed, running } and TOOL_ROW_KINDS; thread.steerQueued(threadId, itemId)
// refuses with thread.steer.unavailable; Send now is the existing thread.sendQueuedNow(threadId, itemId). The renderer parts:
// - foldSummaryText(summary) in src/components/Threads/foldSummaryText.ts (the words);
// - ToolRowView({ row }) in src/components/Threads/ToolRowView.tsx (one row: kind bar, accessible kind, time on focus);
// - composerHints({ status, canSteer }) → { placeholder, steer, sendNow } and modelChipState({ active, next }) → { pending, note }
//   in src/components/Threads/composerModel.ts;
// - QueuedMessageRow({ threadId, item, canSteer, working }) in src/components/Threads/QueuedMessageRow.tsx.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MAIN_MESSAGE_ERROR_TAG } from '../../../shared/messages'
import { changeLanguage } from '../../../src/i18n'

type Row = { kind: string; verb: string; target: string; meta: Record<string, unknown>; at: number; failed: boolean; running: boolean; truncated?: boolean }
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const at = (h: number, m: number, s: number): number => { const date = new Date(); date.setHours(h, m, s, 0); return date.getTime() }
const row = (kind: string, target: string, o: Partial<Row> = {}): Row => ({ kind, verb: kind, target, meta: {}, at: at(14, 41, 7), failed: false, running: false, ...o })
async function wording(rows: Row[]): Promise<string> {
  const { foldSummary } = await load<{ foldSummary: (rows: Row[]) => Record<string, unknown> }>('shared/thread-tool-rows')
  const { foldSummaryText } = await load<{ foldSummaryText: (summary: Record<string, unknown>) => string }>('src/components/Threads/foldSummaryText')
  return foldSummaryText(foldSummary(rows))
}

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('U6.2 · tool calls fold', () => {
  test('six calls fold into "6 steps: read 3 things, edited 2 files, ran 1 command"', async () => {
    const rows = [row('read', 'a.ts'), row('read', 'b.ts'), row('read', 'c.ts'), row('edit', 'a.ts'), row('edit', 'b.ts'), row('run', 'npm test')]
    expect(await wording(rows)).toBe('6 steps: read 3 things, edited 2 files, ran 1 command')
  })

  test('the summary names at most three parts, the largest first, never "other", with singulars', async () => {
    const rows = [row('query', 'q1'), row('query', 'q2'), row('query', 'q3'), row('edit', 'a.ts'), row('edit', 'b.ts'), row('http', 'api'), row('other', 'x')]
    expect(await wording(rows)).toBe('7 steps: ran 3 queries, edited 2 files, made 1 HTTP call')
    expect(await wording([row('container', 'db'), row('read', 'a.ts')])).toMatch(/^2 steps: (started 1 container, read 1 thing|read 1 thing, started 1 container)$/)
  })

  test('a failure reads "· 1 failed", and a failure fixed later reads "· 1 error, fixed"', async () => {
    expect(await wording([row('run', 'npm test', { failed: true })])).toBe('1 step: ran 1 command · 1 failed')
    expect(await wording([row('run', 'npm test', { failed: true }), row('run', 'npm test')])).toMatch(/· 1 error, fixed$/)
  })

  test('the summary reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const rows = [row('read', 'a.ts'), row('read', 'b.ts'), row('read', 'c.ts'), row('edit', 'a.ts'), row('edit', 'b.ts'), row('run', 'npm test')]
    expect(await wording(rows)).toBe('6 passos: leu 3 itens, editou 2 arquivos, rodou 1 comando')
  })

  test('a row names its kind for assistive tech, carries its kind for the bar, and shows its time on focus', async () => {
    const { ToolRowView } = await load<{ ToolRowView: (props: { row: Row }) => JSX.Element }>('src/components/Threads/ToolRowView')
    render(<ToolRowView row={row('edit', 'src/app.ts')} />)
    const item = screen.getByRole('button', { name: /Edit.*src\/app\.ts/ })
    expect(item.closest('[data-kind]')?.getAttribute('data-kind')).toBe('edit')
    expect(screen.queryByText('14:41:07')).toBeNull()
    item.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('14:41:07')
  })
})

describe('U6.3 · the composer', () => {
  test('each canSteer × status combination gives its placeholder and queued buttons', async () => {
    const { composerHints } = await load<{ composerHints: (state: { status: string; canSteer: boolean }) => { placeholder: string; steer: boolean; sendNow: boolean } }>('src/components/Threads/composerModel')
    expect(composerHints({ status: 'idle', canSteer: true })).toEqual({ placeholder: 'Ask, or type / for commands', steer: false, sendNow: true })
    expect(composerHints({ status: 'idle', canSteer: false })).toEqual({ placeholder: 'Ask, or type / for commands', steer: false, sendNow: true })
    expect(composerHints({ status: 'working', canSteer: true })).toEqual({ placeholder: 'Steer: the agent reads this after its current step', steer: true, sendNow: true })
    expect(composerHints({ status: 'working', canSteer: false })).toEqual({ placeholder: 'Queued until the current turn ends', steer: false, sendNow: true })
    expect(composerHints({ status: 'needs-you', canSteer: true })).toEqual({ placeholder: 'Answer, or tell the agent what to do instead', steer: false, sendNow: true })
    await changeLanguage('pt-BR')
    expect(composerHints({ status: 'working', canSteer: true }).placeholder).toBe('Direcione: o agente lê depois do passo atual')
  })

  test('Steer with this asks main to steer with the queued message, and a refusal keeps it queued with the reason', async () => {
    const thread = {
      steerQueued: vi.fn(async () => undefined),
      sendQueuedNow: vi.fn(async () => undefined),
      deleteQueued: vi.fn(async () => undefined)
    }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread } })
    const { QueuedMessageRow } = await load<{ QueuedMessageRow: (props: { threadId: string; item: { id: string; text: string }; canSteer: boolean; working: boolean }) => JSX.Element }>('src/components/Threads/QueuedMessageRow')
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<><QueuedMessageRow threadId="t-1" item={{ id: 'q-1', text: 'also run lint' }} canSteer working /><Toaster /></>)
    expect(screen.getByText(/Queued · also run lint/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Steer with this' }))
    await waitFor(() => expect(thread.steerQueued).toHaveBeenCalledWith('t-1', 'q-1'))
    thread.steerQueued.mockRejectedValueOnce(new Error(`steer unavailable${MAIN_MESSAGE_ERROR_TAG}${JSON.stringify({ code: 'thread.steer.unavailable', params: {} })}`))
    await userEvent.click(screen.getByRole('button', { name: 'Steer with this' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Queued · also run lint/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(thread.sendQueuedNow).toHaveBeenCalledWith('t-1', 'q-1'))
  })

  test('without canSteer, or while not working, the queued row offers no Steer with this', async () => {
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread: { steerQueued: vi.fn(), sendQueuedNow: vi.fn(), deleteQueued: vi.fn() } } })
    const { QueuedMessageRow } = await load<{ QueuedMessageRow: (props: { threadId: string; item: { id: string; text: string }; canSteer: boolean; working: boolean }) => JSX.Element }>('src/components/Threads/QueuedMessageRow')
    render(<QueuedMessageRow threadId="t-1" item={{ id: 'q-1', text: 'x' }} canSteer={false} working />)
    expect(screen.queryByRole('button', { name: 'Steer with this' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument()
    cleanup()
    render(<QueuedMessageRow threadId="t-1" item={{ id: 'q-1', text: 'x' }} canSteer working={false} />)
    expect(screen.queryByRole('button', { name: 'Steer with this' })).toBeNull()
  })

  test('a model change is marked pending with "Applies to the next message" and clears once that message is sent', async () => {
    const { modelChipState } = await load<{ modelChipState: (state: { active: string; next: string | null }) => { pending: boolean; note: string | null } }>('src/components/Threads/composerModel')
    expect(modelChipState({ active: 'claude-opus-5-5', next: null })).toEqual({ pending: false, note: null })
    expect(modelChipState({ active: 'claude-opus-5-5', next: 'claude-sonnet-5-5' })).toEqual({ pending: true, note: 'Applies to the next message' })
    // After the send, main reports the new model as active and the choice is no longer pending.
    expect(modelChipState({ active: 'claude-sonnet-5-5', next: 'claude-sonnet-5-5' })).toEqual({ pending: false, note: null })
    await changeLanguage('pt-BR')
    expect(modelChipState({ active: 'a', next: 'b' }).note).toBe('Vale a partir da próxima mensagem')
  })


  test('the chips are Plan or Agent, model, effort and access with no MCP chip, reachable by Tab, and a model menu returns focus', async () => {
    const { ComposerChips } = await load<{ ComposerChips: (props: { mode: string; model: string; models: string[]; nextModel: string | null; effort?: string; efforts?: string[]; access: string; onChange: (change: Record<string, unknown>) => void }) => JSX.Element }>('src/components/Threads/ComposerChips')
    const onChange = vi.fn()
    const { rerender } = render(<ComposerChips mode="agent" model="claude-opus-5-5" models={['claude-opus-5-5', 'claude-sonnet-5-5']} nextModel={null} effort="high" efforts={['low', 'medium', 'high']} access="edit" onChange={onChange} />)
    expect(document.body.textContent).not.toMatch(/\bMCP\b/)
    const chips = screen.getAllByRole('button')
    expect(chips.length).toBeGreaterThanOrEqual(4)
    await userEvent.tab()
    expect(chips).toContain(document.activeElement)
    const model = screen.getByRole('button', { name: /claude-opus-5-5/ })
    model.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(model).toHaveFocus()
    await userEvent.click(model)
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /claude-sonnet-5-5/ }))
    expect(onChange).toHaveBeenCalledWith({ model: 'claude-sonnet-5-5' })
    await waitFor(() => expect(screen.getByRole('button', { name: /claude-opus-5-5|claude-sonnet-5-5/ })).toHaveFocus())
    rerender(<ComposerChips mode="agent" model="claude-opus-5-5" models={['claude-opus-5-5', 'claude-sonnet-5-5']} nextModel="claude-sonnet-5-5" effort="high" efforts={['low', 'medium', 'high']} access="edit" onChange={onChange} />)
    expect(screen.getByText('Applies to the next message')).toBeInTheDocument()
    rerender(<ComposerChips mode="agent" model="claude-sonnet-5-5" models={['claude-opus-5-5', 'claude-sonnet-5-5']} nextModel={null} effort="high" efforts={['low', 'medium', 'high']} access="edit" onChange={onChange} />)
    expect(screen.queryByText('Applies to the next message')).toBeNull()
  })

})
