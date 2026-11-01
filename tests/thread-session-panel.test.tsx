import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent, ThreadSnapshot } from '../shared/types/thread'
import { normalizeClaudeContext, normalizeCodexTokenUsage } from '../electron/main/services/conversation/thread-context'
import { addTurnCost } from '../electron/main/services/conversation/thread-cost'
import { ThreadSessionPanel } from '../src/components/Threads/ThreadSessionPanel'
import { ThreadChangesPanel } from '../src/components/Threads/ThreadChangesPanel'
import { latestContextReport, moveSection, normalizeSectionOrder, readSectionOrder, sessionContext, sessionToolUse, SESSION_SECTIONS } from '../src/components/Threads/threadSessionModel'
import { compactTokens } from '../src/components/Threads/ThreadUsagePanel'
import { changeLanguage } from '../src/i18n'

const thread: ThreadSnapshot['thread'] = { id: 't1', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', nativeSessionId: 'native', title: 'Session', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1 }

/** Claude's get_context_usage payloads, as the provider sends them, turned into the usage events the thread receives. */
const claudeEvents = (): ThreadEvent[] => [
  { name: 'first', totalTokens: 15741, maxTokens: 200_000, categories: [{ name: 'System prompt', tokens: 2371 }, { name: 'Messages', tokens: 8000 }, { name: 'Free space', tokens: 151_259, kind: 'free' }, { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' }] },
  { name: 'latest', totalTokens: 64_000, maxTokens: 200_000, model: 'claude-x', categories: [
    { name: 'System prompt', tokens: 3000 }, { name: 'System tools', tokens: 12_000 }, { name: 'MCP tools', tokens: 9000 }, { name: 'Memory files', tokens: 1000 },
    { name: 'Skills', tokens: 2000 }, { name: 'Messages', tokens: 36_000 }, { name: 'MCP tools (deferred)', tokens: 7000, isDeferred: true },
    { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' }, { name: 'Free space', tokens: 103_000, kind: 'free' }
  ] }
].map((raw, index) => ({ type: 'context-usage', report: normalizeClaudeContext(raw, 1000 + index)! }))

function snapshotWith(change: Partial<ThreadSnapshot['thread']> = {}, events: ThreadEvent[] = []): ThreadSnapshot {
  return { thread: { ...thread, ...change }, events }
}
function renderPanel(snapshot: ThreadSnapshot, extra: { running?: boolean; onCompact?: () => void; onOpenPanel?: (panel: string) => void } = {}) {
  return render(<ThreadSessionPanel snapshot={snapshot} running={extra.running ?? false} onCompact={extra.onCompact} onOpenPanel={extra.onOpenPanel ?? (() => {})} />)
}
const row = (name: string): HTMLElement => within(screen.getByTestId('session-context-breakdown')).getByRole('row', { name: new RegExp(`^${name} `) })

beforeEach(() => { try { localStorage.clear() } catch { /* jsdom always has it */ } })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('session panel context numbers', () => {
  it('match the usage events the thread received: the newest report, grouped by category', () => {
    const report = latestContextReport(claudeEvents())!
    expect(report.capturedAt).toBe(1001)
    const context = sessionContext(report)!
    // The panel never recomputes the totals: they are the event's.
    expect(context).toMatchObject({ used: report.usedTokens, window: report.windowTokens, percent: report.percentage, free: 103_000, reserved: 33_000, deferred: 7000, autoCompactAt: 167_000, itemized: true })
    expect(Object.fromEntries(context.rows.map(item => [item.bucket, item.tokens]))).toEqual({ messages: 36_000, tools: 12_000, mcp: 9000, system: 4000, skills: 2000 })
    // Every used token is in a row, and used + free + reserved is the window.
    expect(context.rows.reduce((sum, item) => sum + item.tokens, 0) + context.unattributed).toBe(report.usedTokens)
    expect(context.used + context.free + context.reserved).toBe(context.window)

    renderPanel(snapshotWith({ contextReport: report }))
    expect(screen.getByText(`${compactTokens(64_000)} of ${compactTokens(200_000)} · 32%`)).toBeVisible()
    expect(screen.getByRole('meter', { name: 'Context window' })).toHaveAttribute('aria-valuenow', '64000')
    expect(row('Messages')).toHaveTextContent(compactTokens(36_000))
    expect(row('Tools')).toHaveTextContent(compactTokens(12_000))
    expect(row('MCP')).toHaveTextContent(compactTokens(9000))
    expect(row('System')).toHaveTextContent(compactTokens(4000))
    expect(row('Skills')).toHaveTextContent(compactTokens(2000))
    expect(row('Free')).toHaveTextContent(compactTokens(103_000))
    expect(row('Reserved for compaction')).toHaveTextContent(compactTokens(33_000))
    expect(screen.getByText(`${compactTokens(7000)} more in tools loaded only when the agent asks for them.`)).toBeVisible()
    expect(screen.getByText(`Compacts by itself at ${compactTokens(167_000)}.`)).toBeVisible()
  })

  it('keeps what a report counts but does not itemize, and the Codex total without a breakdown', () => {
    const claude = sessionContext(normalizeClaudeContext({ totalTokens: 15741, maxTokens: 1_000_000, categories: [{ name: 'System prompt', tokens: 2371 }, { name: 'Free space', tokens: 951_259, kind: 'free' }] }, 5))!
    expect(claude).toMatchObject({ unattributed: 13_370, rows: [{ bucket: 'system', tokens: 2371 }] })

    const codex = latestContextReport([{ type: 'context-usage', report: normalizeCodexTokenUsage({ modelContextWindow: 200_000, last: { totalTokens: 50_000 } }, 'gpt', 7)! }])!
    expect(sessionContext(codex)).toMatchObject({ used: 50_000, window: 200_000, percent: 25, free: 150_000, itemized: false, unattributed: 50_000, rows: [] })
    renderPanel(snapshotWith({ provider: 'codex', contextReport: codex }))
    expect(row('In use')).toHaveTextContent(compactTokens(50_000))
    expect(row('Free')).toHaveTextContent(compactTokens(150_000))
    expect(screen.getByText('Codex reports only the total, not what fills it.')).toBeVisible()
  })

  it('shows the cost folded from the turn-cost events', () => {
    const cost = addTurnCost(addTurnCost(undefined, { usd: 0.4, inputTokens: 10 }, 1), { usd: 0.35, inputTokens: 5 }, 2)
    renderPanel(snapshotWith({ contextReport: latestContextReport(claudeEvents()), costReport: cost }))
    // Claude reports its cost: "Reported". A figure worked out from tokens (Codex) is "Estimated" (#227 review).
    expect(screen.getByText('Reported cost so far: US$ 0.75 in 2 turns.')).toBeVisible()
    cleanup()
    renderPanel(snapshotWith({ contextReport: latestContextReport(claudeEvents()), costReport: { ...cost!, source: 'codex-token-usage' } }))
    expect(screen.getByText('Estimated cost so far: US$ 0.75 in 2 turns.')).toBeVisible()
  })

  it('rejects reports that prove nothing and says the context is still unknown', () => {
    expect(sessionContext(undefined)).toBeNull()
    expect(sessionContext({ usedTokens: 10, windowTokens: 0, percentage: 0, categories: [], capturedAt: 1, source: 'claude-control' })).toBeNull()
    expect(sessionContext({ usedTokens: Number.NaN, windowTokens: 100, percentage: 400, categories: [{ name: '', tokens: -5, kind: 'used' }], capturedAt: 1, source: 'claude-control' })).toMatchObject({ used: 0, percent: 100, free: 100 })
    renderPanel(snapshotWith(), { onCompact: vi.fn() })
    expect(screen.getByText('No context report yet')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Compact' })).toBeDisabled()
    expect(screen.getByText('Nothing to compact yet.')).toBeVisible()
  })

  it('asks for a fresher report while idle and shows the newer one', async () => {
    const stored = latestContextReport(claudeEvents())!
    const fresh = { ...stored, usedTokens: 80_000, percentage: 40, capturedAt: stored.capturedAt + 10 }
    const contextUsage = vi.fn().mockResolvedValue(fresh)
    vi.stubGlobal('oxe', { thread: { contextUsage } })
    try {
      renderPanel(snapshotWith({ contextReport: stored }))
      expect(await screen.findByText(`${compactTokens(80_000)} of ${compactTokens(200_000)} · 40%`)).toBeVisible()
      expect(contextUsage).toHaveBeenCalledWith('t1')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('session panel actions', () => {
  it('compacts only when idle and there is context, through the conversation command', async () => {
    const user = userEvent.setup()
    const onCompact = vi.fn()
    const { unmount } = renderPanel(snapshotWith({ contextReport: latestContextReport(claudeEvents()) }), { onCompact, running: true })
    expect(screen.getByRole('button', { name: 'Compact' })).toBeDisabled()
    expect(screen.getByText('Wait for the agent to finish before compacting.')).toBeVisible()
    unmount()
    renderPanel(snapshotWith({ contextReport: latestContextReport(claudeEvents()) }), { onCompact })
    await user.click(screen.getByRole('button', { name: 'Compact' }))
    expect(onCompact).toHaveBeenCalledOnce()
  })

  it('offers no Compact when the conversation cannot run commands', () => {
    renderPanel(snapshotWith({ contextReport: latestContextReport(claudeEvents()) }))
    expect(screen.queryByRole('button', { name: 'Compact' })).toBeNull()
  })

  it('lists the tools the conversation called and the MCP servers the session reported', () => {
    const events: ThreadEvent[] = [
      { type: 'tool', id: '1', name: 'Bash', state: 'completed', detail: 'npm test' },
      { type: 'tool', id: '2', name: 'Bash', state: 'failed', detail: 'npm run lint' },
      { type: 'tool', id: '3', name: 'mcp__oxespace__oxespace_list_panes', state: 'completed', detail: '' },
      { type: 'tool', id: '4', name: '   ', state: 'completed', detail: 'ignored' }
    ]
    expect(sessionToolUse(events)).toEqual([{ name: 'Bash', calls: 2, failed: 1 }, { name: 'oxespace_list_panes', calls: 1, failed: 0, mcpServer: 'oxespace' }])
    renderPanel(snapshotWith({ mcpServers: { servers: [{ name: 'oxespace', status: 'connected' }, { name: 'broken', status: 'failed' }], checkedAt: 1 } }, events))
    const used = screen.getByRole('list', { name: 'Tools used in this conversation' })
    expect(within(used).getAllByRole('listitem')[0]).toHaveTextContent('Bash2 calls · 1 failed')
    expect(within(used).getAllByRole('listitem')[1]).toHaveTextContent('oxespace_list_panesoxespace1 call')
    expect(screen.getByRole('region', { name: /Connected/ })).toHaveTextContent('oxespace')
    expect(screen.getByRole('region', { name: /Failed/ })).toHaveTextContent('broken')
  })

  it('says what is still unknown instead of showing empty lists', () => {
    renderPanel(snapshotWith())
    expect(screen.getByText('The agent has not reported its MCP servers yet. They appear when its session starts.')).toBeVisible()
    expect(screen.getByText('No tools used yet.')).toBeVisible()
    expect(screen.getByText('No files changed yet.')).toBeVisible()
    expect(screen.getByText("No page open in this conversation's browser.")).toBeVisible()
    expect(screen.getByText('Nothing running in the background.')).toBeVisible()
  })

  it('shows changed files, running background work, and opens the panel that has the rest', async () => {
    const user = userEvent.setup()
    const onOpenPanel = vi.fn()
    const events: ThreadEvent[] = [
      { type: 'tool', id: 'f', name: 'fileChange', state: 'completed', detail: 'a', files: [{ path: '/repo/src/a.ts', kind: 'update', state: 'completed', source: 'native-patch', additions: 3, deletions: 1 }] },
      { type: 'subagent', id: 's', action: 'spawnAgent', state: 'running', receiverThreadIds: ['c'], agents: [] }
    ]
    renderPanel(snapshotWith({ background: { running: 2, since: 1 } }, events), { onOpenPanel })
    expect(screen.getByRole('list', { name: 'Changed files' })).toHaveTextContent('src/a.ts')
    expect(screen.getByText('+3')).toBeVisible()
    expect(screen.getByText('1 agent running')).toBeVisible()
    expect(screen.getByText('2 tasks running')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Review changes' }))
    await user.click(screen.getByRole('button', { name: 'Open background activity' }))
    await user.click(screen.getByRole('button', { name: 'Open the browser' }))
    expect(onOpenPanel.mock.calls.map(call => call[0])).toEqual(['changes', 'background', 'preview'])
  })

  it('shows the environment: project, worktree, agent and model', () => {
    renderPanel(snapshotWith({ model: 'claude-x', ownedWorktree: { path: '/repo-wt', branch: 'feat/x', projectRoot: '/repo', baseCommit: 'abc' } as ThreadSnapshot['thread']['ownedWorktree'] }))
    const region = screen.getByRole('region', { name: 'Environment' })
    expect(region).toHaveTextContent('Projectrepo')
    expect(region).toHaveTextContent("This conversation's own worktree")
    expect(region).toHaveTextContent('Branchfeat/x')
    expect(region).toHaveTextContent('AgentClaude Code')
    expect(region).toHaveTextContent('Modelclaude-x')
  })

  it('is one of the Thread side panels', async () => {
    const user = userEvent.setup()
    render(<ThreadChangesPanel snapshot={snapshotWith()} panel="session" onClose={() => {}} />)
    expect(screen.getByTestId('thread-session-panel')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Select workbench panel: Conversation details' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Conversation details' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('session panel order', () => {
  const titles = (): string[] => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent ?? '')

  it('moves a section from its menu, announces it, keeps the order and restores the default', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPanel(snapshotWith())
    expect(titles()).toEqual(['Environment', 'Context', 'Tools and MCP', 'Outputs', 'Background work'])
    await user.click(screen.getByRole('button', { name: 'Move the Background work section' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move to the top' }))
    expect(titles()[0]).toBe('Background work')
    expect(screen.getByRole('status')).toHaveTextContent('Background work moved to position 1 of 5')
    await user.click(screen.getByRole('button', { name: 'Move the Environment section' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    expect(titles()).toEqual(['Background work', 'Context', 'Environment', 'Tools and MCP', 'Outputs'])
    expect(readSectionOrder()).toEqual(['background', 'context', 'environment', 'tools', 'outputs'])
    unmount()

    renderPanel(snapshotWith())
    expect(titles()).toEqual(['Background work', 'Context', 'Environment', 'Tools and MCP', 'Outputs'])
    await user.click(screen.getByRole('button', { name: 'Move the Context section' }))
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).not.toHaveAttribute('data-disabled')
    await user.click(screen.getByRole('menuitem', { name: 'Restore the default order' }))
    expect(titles()).toEqual(['Environment', 'Context', 'Tools and MCP', 'Outputs', 'Background work'])
  })

  it('disables moves that go nowhere', async () => {
    const user = userEvent.setup()
    renderPanel(snapshotWith())
    await user.click(screen.getByRole('button', { name: 'Move the Environment section' }))
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Move to the top' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Restore the default order' })).toHaveAttribute('data-disabled')
  })

  it("reorders by dragging a section's grip onto another", () => {
    renderPanel(snapshotWith())
    const items = screen.getAllByRole('listitem').filter(item => item.dataset.section)
    const at = (section: string) => items.find(item => item.dataset.section === section)!
    // Stacked 100px boxes in the default order.
    items.forEach((item, index) => vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({ top: index * 100, height: 100 } as DOMRect))
    const grip = at('outputs').querySelector('[class*="grip"]')!
    const pointer = (type: string, clientY: number) => act(() => { grip.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY })) })
    pointer('pointerdown', 350)
    expect(at('outputs')).toHaveAttribute('data-dragging', 'true')
    pointer('pointermove', 10)
    expect(at('environment')).toHaveAttribute('data-drop', 'before')
    pointer('pointerup', 10)
    expect(titles()).toEqual(['Outputs', 'Environment', 'Context', 'Tools and MCP', 'Background work'])
    expect(readSectionOrder()[0]).toBe('outputs')
    expect(at('outputs')).not.toHaveAttribute('data-dragging')
    expect(screen.getByRole('status')).toHaveTextContent('Outputs moved to position 1 of 5')
  })

  it('leaves the order alone when a drag ends outside the sections, is cancelled, or uses another button', () => {
    renderPanel(snapshotWith())
    const items = screen.getAllByRole('listitem').filter(item => item.dataset.section)
    items.forEach((item, index) => vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({ top: index * 100, height: 100 } as DOMRect))
    const grip = items[0].querySelector('[class*="grip"]')!
    const pointer = (type: string, clientY: number, button = 0) => act(() => { grip.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, clientY })) })
    pointer('pointerdown', 50); pointer('pointerup', 9999)
    pointer('pointerdown', 50); pointer('pointermove', 250); pointer('pointercancel', 250)
    pointer('pointerdown', 50, 2); pointer('pointerup', 450)
    expect(titles()).toEqual(['Environment', 'Context', 'Tools and MCP', 'Outputs', 'Background work'])
    expect(items[2]).not.toHaveAttribute('data-drop')
  })

  it('works when storage is unavailable or holds something else', async () => {
    expect(normalizeSectionOrder('nonsense')).toEqual(SESSION_SECTIONS)
    expect(normalizeSectionOrder(['tools', 'tools', 'bogus', 42, 'context'])).toEqual(['tools', 'context', 'environment', 'outputs', 'background'])
    expect(moveSection(SESSION_SECTIONS, 'context', 99)).toEqual(['environment', 'tools', 'outputs', 'background', 'context'])
    expect(moveSection(SESSION_SECTIONS, 'nope' as never, 0)).toBe(SESSION_SECTIONS)
    localStorage.setItem('oxe.thread.sessionPanel.order', '{broken')
    expect(readSectionOrder()).toEqual(SESSION_SECTIONS)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const user = userEvent.setup()
    renderPanel(snapshotWith())
    await user.click(screen.getByRole('button', { name: 'Move the Outputs section' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect(titles()).toEqual(['Environment', 'Context', 'Outputs', 'Tools and MCP', 'Background work'])
  })
})

describe('session panel in Portuguese', () => {
  it('names the sections, the context and the actions in pt-BR', async () => {
    await changeLanguage('pt-BR')
    renderPanel(snapshotWith({ contextReport: latestContextReport(claudeEvents()) }), { onCompact: vi.fn() })
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Ambiente', 'Contexto', 'Ferramentas e MCP', 'Saídas', 'Em segundo plano'])
    expect(screen.getByRole('meter', { name: 'Janela de contexto' })).toBeVisible()
    expect(row('Mensagens')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Compactar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Mover a seção Contexto' })).toBeVisible()
  })
})
