// Frozen acceptance test for 1.5.0 A19 on screen (DESIGN U6.1, OXE program, phase F6, task FE-T90). Written by the planner;
// the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f6-design.md (U6.1 and its 08/11 update).
// Contract (BACKEND #709 @ 7000ab74): activity = { kind: 'needs-you'|'question'|'working'|'paused'|'error'|'ready'|'done',
// at, text?, verb?, since?, count?, requestId?, reason? }, worded by the window; window.oxe.thread.toolTabs(threadId) →
// [{ tab, count }], pushed by thread.onToolTabsChanged. The renderer parts:
// - NowLine({ activity, agent, irreversible?, hasPullRequest?, onAction }) in src/components/Threads/NowLine.tsx;
// - ThreadSubline({ provider, model, workspace, branch, moved, access, startedAt }) in src/components/Threads/ThreadSubline.tsx;
// - ThreadToolTabs({ threadId }) in src/components/Threads/ThreadToolTabs.tsx;
// - THREAD_MORE_ACTIONS, the ⋯ menu's items in order, in src/components/Threads/threadMoreActions.ts.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Activity = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
type NowLineModule = { NowLine: (props: { activity: Activity; agent: string; irreversible?: boolean; hasPullRequest?: boolean; onAction: (action: string) => void }) => JSX.Element }
async function renderNowLine(activity: Activity, extra: { irreversible?: boolean; hasPullRequest?: boolean } = {}) {
  const { NowLine } = await load<NowLineModule>('src/components/Threads/NowLine')
  const onAction = vi.fn()
  render(<NowLine activity={activity} agent="Claude" {...extra} onAction={onAction} />)
  return onAction
}
const line = (): string => (screen.getByRole('status').textContent ?? '').replace(/\s+/g, ' ').trim()
const actions = (): string[] => screen.queryAllByRole('button').map(button => button.textContent?.trim() ?? '')

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('U6.1 · the header as a task', () => {
  test('each NowLine state reads its copy, with at most two actions and Deny first', async () => {
    const cases: Array<[Activity, RegExp, string[]]> = [
      [{ kind: 'needs-you', at: 1, text: 'run the migrations', requestId: 'r1' }, /^Needs you\. Claude asks to run the migrations\./, ['Deny', 'Allow']],
      [{ kind: 'question', at: 1, count: 2, requestId: 'r2' }, /^Needs you\. Claude asked 2 questions\./, ['Answer']],
      [{ kind: 'working', at: 1, verb: 'editing', text: 'src/app.ts', since: Date.now() - 60_000 }, /^Working\. Editing src\/app\.ts\./, ['Stop']],
      [{ kind: 'working', at: 1, text: 'thinking about the tests' }, /^Working\. thinking about the tests\./, ['Stop']],
      [{ kind: 'paused', at: 1 }, /^Paused\. You stopped it\. Send a message to continue\./, []],
      [{ kind: 'error', at: 1, reason: 'The tool timed out' }, /^Stopped with an error\. The tool timed out\./, ['Retry the failed step']],
      [{ kind: 'ready', at: 1, text: '3 files changed' }, /^Ready for review\. 3 files changed\./, []],
      [{ kind: 'done', at: 1, text: 'Tests pass' }, /^Done\. Tests pass\./, []]
    ]
    for (const [activity, copy, expected] of cases) {
      await renderNowLine(activity)
      expect(line()).toMatch(copy)
      expect(actions()).toEqual(expected)
      expect(actions().length).toBeLessThanOrEqual(2)
      cleanup()
    }
  })

  test('the Working line uses the verb words, and reads in pt-BR', async () => {
    for (const [verb, word] of [['running', 'Running'], ['reading', 'Reading'], ['querying', 'Querying'], ['calling', 'Calling'], ['starting', 'Starting']]) {
      await renderNowLine({ kind: 'working', at: 1, verb, text: 'x' })
      expect(line()).toMatch(new RegExp(`^Working\\. ${word} x\\.`))
      cleanup()
    }
    await changeLanguage('pt-BR')
    await renderNowLine({ kind: 'working', at: 1, verb: 'editing', text: 'src/app.ts' })
    expect(line()).toMatch(/^Trabalhando\. Editando src\/app\.ts\./)
    cleanup()
    await renderNowLine({ kind: 'needs-you', at: 1, text: 'rodar as migrações', requestId: 'r1' })
    expect(line()).toMatch(/^Precisa de você\. Claude pede para rodar as migrações\./)
  })

  test('the NowLine actions call back with what the person chose', async () => {
    const onAction = await renderNowLine({ kind: 'needs-you', at: 1, text: 'run the migrations', requestId: 'r1' })
    screen.getByRole('button', { name: 'Deny' }).click()
    expect(onAction).toHaveBeenCalledWith('deny')
  })

  test('the sub-line has every A19 field and no cost anywhere', async () => {
    const { ThreadSubline } = await load<{ ThreadSubline: (props: Record<string, unknown>) => JSX.Element }>('src/components/Threads/ThreadSubline')
    render(<ThreadSubline provider="claude" model="claude-opus-5-5" workspace={{ id: 'ws-1', name: 'repo', color: 3 }} branch="agent-fix" moved="main" access="edit" startedAt={Date.now() - 44 * 60_000} />)
    const text = document.body.textContent ?? ''
    for (const field of ['claude-opus-5-5', 'repo', 'agent-fix', 'moved to main', 'Can edit', '44 min']) expect(text).toContain(field)
    expect(text).not.toMatch(/\$|\bcost\b|\bcusto\b|US\$/i)
  })

  test('a conversation that used only files shows Conversation and Changes, and a query adds Queries without a reload', async () => {
    const listeners: Array<(event: unknown) => void> = []
    let tabs = [{ tab: 'conversation', count: null }, { tab: 'changes', count: 2 }]
    const thread = { toolTabs: vi.fn(async () => tabs), onToolTabsChanged: vi.fn((listener: (event: unknown) => void) => { listeners.push(listener); return () => undefined }) }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread } })
    const { ThreadToolTabs } = await load<{ ThreadToolTabs: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/ThreadToolTabs')
    render(<ThreadToolTabs threadId="t-1" />)
    expect(await screen.findByRole('tab', { name: /Conversation/ })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+/g, '').trim())).toEqual(['Conversation', 'Changes'])
    expect(screen.getByRole('tab', { name: /Changes/ }).textContent).toMatch(/2/)
    expect(thread.toolTabs).toHaveBeenCalledWith('t-1')
    tabs = [...tabs, { tab: 'queries', count: 1 }]
    act(() => { for (const listener of listeners) listener({ threadId: 't-1' }) })
    expect(await screen.findByRole('tab', { name: /Queries/ })).toBeInTheDocument()
  })

  test('the ⋯ menu lists the cockpit actions in order, with no teammate wording', async () => {
    const { THREAD_MORE_ACTIONS } = await load<{ THREAD_MORE_ACTIONS: ReadonlyArray<{ id: string; label: string }> }>('src/components/Threads/threadMoreActions')
    expect(THREAD_MORE_ACTIONS.map(action => action.label)).toEqual([
      'Rename', 'Pin', 'Delegate…', 'MCP servers…', 'Larger text', 'Show every tool call', 'Details', 'Fork', 'Export', 'Archive', 'Delete…'
    ])
    expect(THREAD_MORE_ACTIONS.map(action => action.label).join(' ')).not.toMatch(/teammate|colega/i)
  })

  test("there is one tab strip: F4's tabs are gone, and Changes, Terminal and Pull request fill in through ThreadToolTabs", async () => {
    // F4 (FE-P7) built ThreadTabs and visibleThreadTabs; F6 replaces them with ThreadToolTabs (TECH LEAD 08/11), so only one
    // strip can render: the old modules no longer resolve.
    await expect(load('src/components/Threads/ThreadTabs')).rejects.toThrow(/does not exist yet/)
    await expect(load('src/components/Threads/threadTabs')).rejects.toThrow(/does not exist yet/)
    const listeners: Array<(event: unknown) => void> = []
    let tabs: Array<{ tab: string; count: number | null }> = [{ tab: 'conversation', count: null }]
    const thread = { toolTabs: vi.fn(async () => tabs), onToolTabsChanged: vi.fn((listener: (event: unknown) => void) => { listeners.push(listener); return () => undefined }) }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread } })
    const { ThreadToolTabs } = await load<{ ThreadToolTabs: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/ThreadToolTabs')
    render(<ThreadToolTabs threadId="t-1" />)
    expect(await screen.findByRole('tab', { name: /Conversation/ })).toBeInTheDocument()
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(screen.queryByRole('tab', { name: /Changes|Terminal|Pull request/ })).toBeNull()
    // F4's fill-in rule holds: a tab appears once main counts something for it.
    tabs = [{ tab: 'conversation', count: null }, { tab: 'terminal', count: 1 }, { tab: 'changes', count: 3 }, { tab: 'pullRequest', count: 1 }]
    act(() => { for (const listener of listeners) listener({ threadId: 't-1' }) })
    expect(await screen.findByRole('tab', { name: /Pull request/ })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+/g, '').trim())).toEqual(['Conversation', 'Terminal', 'Changes', 'Pull request'])
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
  })


  test('an irreversible request reads Deny then See impact, and Ready offers Open pull request only with a PR', async () => {
    await renderNowLine({ kind: 'needs-you', at: 1, text: 'drop the orders table', requestId: 'r9' }, { irreversible: true })
    expect(actions()).toEqual(['Deny', 'See impact'])
    cleanup()
    await renderNowLine({ kind: 'ready', at: 1, text: '3 files changed' }, { hasPullRequest: true })
    expect(actions()).toEqual(['Open pull request'])
    cleanup()
    await renderNowLine({ kind: 'ready', at: 1, text: '3 files changed' }, { hasPullRequest: false })
    expect(actions()).toEqual([])
  })

  test('there is no side chat: no menu action for it, and Ctrl . is bound to nothing', async () => {
    const { THREAD_MORE_ACTIONS } = await load<{ THREAD_MORE_ACTIONS: ReadonlyArray<{ id: string; label: string }> }>('src/components/Threads/threadMoreActions')
    expect(THREAD_MORE_ACTIONS.map(action => `${action.id} ${action.label}`).join(' ')).not.toMatch(/side ?chat|conversa lateral/i)
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+.')).map(binding => binding.id)).toEqual([])
    expect(KEYBINDINGS.map(binding => binding.id as string).filter(id => /sidechat|side[-_.]chat|thread\.side/i.test(id))).toEqual([])
  })

})
