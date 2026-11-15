// Frozen acceptance test for 1.5.2 OxeCode F4 (OXE program oxespace-152-code, phase F4, tasks T20 and T21, Jira
// OXE-128). Written by the planner; the executor must not edit it. T20 runs `-t "OXE-128 next"`, T21 `-t "OXE-128 ring"`.
// It drives the real stores (workspace, terminal, thread, activity and its attention feed), the real keybinding
// registry and dispatcher, the real command registry and the real PaneContainer over the real preload
// (tests/acceptance/f4/crf4-8-preload.ts, read only).
// "Needs you" is what the attention feed already counts (src/store/activity.feed.ts): a Code terminal pane whose tone is
// needs-decision (an agent stopped on an approval or a question) and a conversation with status 'approval'.
// Contract, T20 ("OXE-128 next"):
// - src/app/nextAttention.ts (new) exports attentionQueue(): Array<{ target: ActivityTarget; since: number }>, every
//   pane and conversation that needs the person, oldest first by `since`: the Date.now() at which it entered "needs you"
//   (OXE-128/Q-4). Leaving the state drops it; entering again starts a new wait. Only open workspaces count: a pane whose
//   workspace is not in the workspace store (closed: no agent runs there) is never in the queue and is never opened
//   (Q-5). A workspace that is not the active one (collapsed in the sidebar or not) is in it.
// - It also exports goToNextAttention(selectView: (view: AppView) => void): the first call activates the oldest; each
//   next call activates the one after the last it activated, in a cycle. A pane: selectView('code'), its workspace
//   becomes the active one when another is (useWorkspaceStore.setActiveWorkspace), and it becomes the active pane
//   (useTerminalStore.activePaneId). A conversation: selectView('thread') and useThreadStore.select(id). On arrival it
//   says once, in the polite live region (announceFocus, src/keyboard/terminalFocusActions.ts),
//   "<name> precisa de você: <request>" (en "<name> needs you: <request>"); the name is the pane's display title or the
//   conversation's title; which text is the request is the implementer's (the pane's attention reason, say).
// - src/components/Attention/NextAttentionHost.tsx (new) exports NextAttentionHost({ selectView }): binds the registry
//   id 'attention.next' (useKeybindings) to goToNextAttention, and with an empty queue changes nothing and shows a
//   role="status" notice "Nada esperando por você" (en "Nothing waiting for you") that goes away by itself within 10 s.
//   App.tsx mounts it with the app's view switch (App.tsx is at 972 lines: one import and one element).
// - src/keyboard/keybindings.ts gains { id: 'attention.next', chords: ['Mod+Shift+U'], scope: 'global',
//   reservedInTerminal: true } (Cmd+Shift+U on macOS; it works from a focused terminal), with no collision; its label
//   (keys.bindings.attention.next) is "Ir para o próximo que precisa de você" in pt-BR; the shortcut guide lists it in
//   OxeCode and OxeChat, and the command bar has a command with shortcut 'attention.next' and that action text. There is
//   no second default chord for Linux: the command is in the palette and can be rebound in Settings › Keyboard; the HML
//   checks IBus, which may take Ctrl+Shift+U.
// Contract, T21 ("OXE-128 ring"):
// - PaneContainer's header (<header class="pane-header">) carries data-attention="true" while the pane needs the
//   person; the attribute goes when the pane leaves the state, or at the first key pressed in the pane (a keydown inside
//   the pane container) until the pane leaves and enters the state again.
// - The CSS draws it as an outline on that attribute, `outline: 2px solid var(--attn); outline-offset: -2px` (brand
//   session and coordination, 14/11): the workspace color stripe stays the header's box-shadow
//   (src/design/workspace-color.css, unchanged), so neither hides the other, and in forced colors the box-shadow goes
//   while the outline stays. No rule on data-attention sets a box-shadow, a height, padding, margin, border or
//   line-height: the ring does not change the header's height, whatever height the header has (measured below with the
//   app's own rules before and after the attribute; the 32 px header comes later with BRD-14). No such rule animates
//   with !important or under a *spin* class, so the reduced-motion rule of src/styles/base.css stops any pulse (CA-7).
//   forced-colors.css takes no outline away from it. The CSS is the product, so reading it as text is allowed here.
// - The brand session confirms the look on the PR (its pixels are e2e/HML).
// Not here: focus landing in the terminal or the composer, and the ring's pixels, are e2e/HML; CA-8 (perf budget) is the
// CI perf-gate and the bundle report.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { useActivityStore } from '../../../src/store/activity.store'
import { connectAttentionFeed } from '../../../src/store/activity.feed'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { bindingsForView, conflictsFor, dispatchKeybinding, getKeybinding, isTerminalReservedChord, setKeyboardView } from '../../../src/keyboard/keybindings'
import { bindingLabel } from '../../../src/keyboard/labels'
import { useContributedCommands } from '../../../src/utils/commandRegistry'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))

const base = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentSource: 'hook', location: null, detached: false }
const blocked = { ...base, agentState: 'blocked' } as unknown as TerminalStateEntry
const working = { ...base, agentState: 'working' } as unknown as TerminalStateEntry
const pane = (id: string, workspaceId: string, displayName: string): WorkspacePane => ({ id, workspaceId, type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName, shellProfileId: null, rootPath: null, createdAt: null } as unknown as WorkspacePane)
const P1 = pane('p1', 'ws-1', 'api')
const P2 = pane('p2', 'ws-2', 'web')
const P9 = pane('p9', 'ws-9', 'gone')
const ws = (id: string, panes: WorkspacePane[]): Workspace => ({ id, name: id, rootPath: `/repo/${id}`, defaultShellProfileId: null, panes } as unknown as Workspace)
const thread = (id: string, status: string) => ({ id, workspaceId: 'ws-1', title: 'Refactor', status } as never)
const keyU = () => new KeyboardEvent('keydown', { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
const idOf = (stop: { target: { type: string; paneId?: string; threadId?: string } }) => stop.target.paneId ?? stop.target.threadId

async function nextAttention() {
  const path = '../../../src/app/nextAttention'
  return (await import(/* @vite-ignore */ path)) as {
    attentionQueue(): Array<{ target: { type: string; paneId?: string; threadId?: string; workspaceId?: string }; since: number }>
    goToNextAttention(selectView: (view: string) => void): unknown
  }
}
async function host() {
  const path = '../../../src/components/Attention/NextAttentionHost'
  return (await import(/* @vite-ignore */ path)) as { NextAttentionHost(props: { selectView(view: string): void }): unknown }
}

const select = vi.fn(async () => undefined)
const setActiveWorkspace = vi.fn(async (id: string) => { useWorkspaceStore.setState({ activeWorkspaceId: id }) })

/** t1 waits from 1000, p2 (another workspace) from 2000, p1 (the active one) from 3000; p9's workspace is closed. */
function waiting(): void {
  connectAttentionFeed()
  useWorkspaceStore.setState({ workspaces: [ws('ws-1', [P1]), ws('ws-2', [P2])], activeWorkspaceId: 'ws-1', shellProfiles: [], setActiveWorkspace } as never)
  useTerminalStore.setState({ panes: {}, activePaneId: null })
  useThreadStore.setState({ threads: [], unreadIds: [], select } as never)
  vi.setSystemTime(1000); useThreadStore.setState({ threads: [thread('t1', 'approval')] })
  vi.setSystemTime(2000); useTerminalStore.setState(state => ({ panes: { ...state.panes, p2: blocked } }))
  vi.setSystemTime(2500); useTerminalStore.setState(state => ({ panes: { ...state.panes, p9: blocked } }))
  vi.setSystemTime(3000); useTerminalStore.setState(state => ({ panes: { ...state.panes, p1: blocked } }))
}

beforeEach(async () => {
  await changeLanguage('pt-BR')
  vi.useFakeTimers({ toFake: ['Date'] })
  select.mockClear(); setActiveWorkspace.mockClear()
  useActivityStore.getState().reset()
  setKeyboardView('code')
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('OXE-128 next · go to the next one that needs you (Ctrl+Shift+U)', () => {
  test('CA-1 · vai ao que espera há mais tempo: oldest first by when it entered the state, switching mode and workspace', async () => {
    const { attentionQueue } = await nextAttention()
    const { NextAttentionHost } = await host()
    waiting()
    expect(attentionQueue().map(idOf)).toEqual(['t1', 'p2', 'p1'])
    expect(attentionQueue().map(stop => stop.since)).toEqual([1000, 2000, 3000])
    const selectView = vi.fn()
    render(createElement(NextAttentionHost as never, { selectView }))
    await act(async () => { dispatchKeybinding(keyU()) })
    expect(selectView).toHaveBeenLastCalledWith('thread')
    expect(select).toHaveBeenLastCalledWith('t1')
    await act(async () => { dispatchKeybinding(keyU()) })
    expect(selectView).toHaveBeenLastCalledWith('code')
    expect(setActiveWorkspace).toHaveBeenLastCalledWith('ws-2')
    expect(useTerminalStore.getState().activePaneId).toBe('p2')
    // Leaving the state drops it; coming back is a new wait, at the end of the line.
    vi.setSystemTime(4000); useTerminalStore.setState(state => ({ panes: { ...state.panes, p2: working } }))
    expect(attentionQueue().map(idOf)).toEqual(['t1', 'p1'])
    vi.setSystemTime(5000); useTerminalStore.setState(state => ({ panes: { ...state.panes, p2: blocked } }))
    expect(attentionQueue().map(idOf)).toEqual(['t1', 'p1', 'p2'])
    expect(attentionQueue().find(stop => idOf(stop) === 'p2')?.since).toBe(5000)
  }, 20_000)

  test('CA-2 · ciclo e fila vazia: repeating walks the queue in a cycle; with nothing waiting, nothing changes and a status says so, then goes', async () => {
    const { NextAttentionHost } = await host()
    waiting()
    const selectView = vi.fn()
    render(createElement(NextAttentionHost as never, { selectView }))
    const visited: Array<string | null> = []
    for (let press = 0; press < 4; press++) {
      await act(async () => { dispatchKeybinding(keyU()) })
      visited.push(selectView.mock.calls.at(-1)?.[0] === 'thread' ? String(select.mock.calls.at(-1)?.[0]) : useTerminalStore.getState().activePaneId)
    }
    expect(visited).toEqual(['t1', 'p2', 'p1', 't1'])
    cleanup()

    // CR-F4-6 (liberação de teste congelado: coordenação 15/11, só CA-2, role=status → aria-live polite): the notice is
    // the src/ui toast(), shown by the app's one Toaster (mounted here beside the host, as App.tsx does; the host mounts
    // none) and spoken by its aria-live="polite" region, which announces as role="status" does.
    const { Toaster, useToasts } = await import('../../../src/ui/Toast')
    const { ANNOUNCE_AFTER_MOUNT_MS } = await import('../../../src/ui/ToastStack')
    vi.useFakeTimers()
    useThreadStore.setState({ threads: [] })
    useTerminalStore.setState({ panes: {}, activePaneId: 'p1' })
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
    const idle = vi.fn()
    render(createElement('div', null, createElement(NextAttentionHost as never, { selectView: idle }), createElement(Toaster)))
    setActiveWorkspace.mockClear()
    await act(async () => { dispatchKeybinding(keyU()) })
    expect(idle).not.toHaveBeenCalled()
    expect(setActiveWorkspace).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().activePaneId).toBe('p1')
    // The stack is a lazy chunk; a toast raised before it mounted goes in a short beat after its region does.
    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(ANNOUNCE_AFTER_MOUNT_MS) })
    const notice = screen.getByText('Nada esperando por você')
    expect(notice.closest('[aria-live="polite"]')).not.toBeNull()
    const shown = useToasts.getState().items.find(item => item.title === 'Nada esperando por você')
    expect(shown?.timeout, 'it goes away by itself').toBeGreaterThan(0)
    await act(async () => { vi.advanceTimersByTime(shown!.timeout) })
    expect(screen.queryByText('Nada esperando por você')).toBeNull()
  }, 20_000)

  test('CA-3 · só workspaces abertos: another open workspace is in the queue; a closed one is never opened', async () => {
    const { attentionQueue, goToNextAttention } = await nextAttention()
    waiting()
    const queue = attentionQueue()
    expect(queue.map(idOf)).toContain('p2')
    expect(queue.map(idOf)).not.toContain('p9')
    for (let press = 0; press < 6; press++) await act(async () => { goToNextAttention(() => undefined) })
    expect(setActiveWorkspace.mock.calls.map(call => call[0])).not.toContain('ws-9')
    expect(useTerminalStore.getState().activePaneId).not.toBe('p9')
  }, 20_000)

  test('CA-4 · atalho registrado sem colisão: Ctrl+Shift+U, from a terminal too, in the shortcut guide and the command bar', async () => {
    const binding = getKeybinding('attention.next' as never)
    expect(binding, 'no attention.next in the keybinding registry').toBeDefined()
    expect(binding.chords).toContain('Mod+Shift+U')
    expect(binding.scope).toBe('global')
    expect(conflictsFor('attention.next' as never)).toEqual([])
    expect(isTerminalReservedChord(keyU())).toBe(true)
    expect(bindingLabel(binding)).toBe('Ir para o próximo que precisa de você')
    for (const view of ['code', 'thread'] as const) expect(bindingsForView(view).flatMap(group => group.bindings.map(item => item.id))).toContain('attention.next')
    await import('../../../src/commands/CommandContributors')
    await changeLanguage('pt-BR')
    const { result } = renderHook(() => useContributedCommands())
    const command = result.current.find(item => item.shortcut === 'attention.next')
    expect(command?.action ?? command?.title).toMatch(/Ir para o próximo que precisa de você/)
  })

  test('CA-6 · anúncio único: arriving by the shortcut says "<name> precisa de você: <request>" once', async () => {
    const { NextAttentionHost } = await host()
    waiting()
    render(createElement(NextAttentionHost as never, { selectView: () => undefined }))
    const said: string[] = []
    // Each thing said is one leaf node added with its text (a text node, or an element with no element inside). A
    // container added around it (the live region announceFocus creates on first use, when no host mounted it) is not a
    // second announcement: its textContent is only its child's text (CR-F4-2, T20 attempt 1).
    const leaf = (node: Node): boolean => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && (node as Element).childElementCount === 0)
    const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (leaf(node) && node.textContent) said.push(node.textContent) })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    await act(async () => { dispatchKeybinding(keyU()) })
    await act(async () => { dispatchKeybinding(keyU()) })
    await act(async () => { dispatchKeybinding(keyU()) })
    await act(async () => { useTerminalStore.setState(state => ({ panes: { ...state.panes, p1: { ...blocked, lastActivityAt: 3500 } as TerminalStateEntry } })) })
    await act(async () => { await Promise.resolve() })
    observer.disconnect()
    expect(said.filter(text => text.startsWith('Refactor precisa de você:'))).toHaveLength(1)
    expect(said.filter(text => text.startsWith('web precisa de você:'))).toHaveLength(1)
    expect(said.filter(text => text.startsWith('api precisa de você:'))).toHaveLength(1)
  }, 20_000)
})

function cssSources(): Array<{ path: string; text: string }> {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.css') ? [path] : []
  })
  return walk(join(process.cwd(), 'src')).map(path => ({ path: relative(process.cwd(), path), text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))
}
function attentionRules(): Array<{ path: string; selector: string; body: string }> {
  return cssSources().flatMap(({ path, text }) => [...text.matchAll(/([^{}]*data-attention[^{}]*)\{([^{}]*)\}/g)].map(found => ({ path, selector: found[1].trim(), body: found[2] })))
}

describe('OXE-128 ring · the waiting pane wears a ring', () => {
  async function mount() {
    preloadOxe({ 'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }) })
    useWorkspaceStore.setState({ workspaces: [ws('ws-1', [P1])], activeWorkspaceId: 'ws-1', shellProfiles: [] })
    useTerminalStore.setState({ panes: { p1: blocked }, activePaneId: null })
    const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')
    const { container } = render(createElement(PaneContainer, { pane: P1, workspace: ws('ws-1', [P1]), agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined }))
    const header = container.querySelector('header.pane-header') as HTMLElement
    expect(header).not.toBeNull()
    return header
  }

  test('CA-5 · anel no painel: data-attention="true" while it waits; gone when it leaves the state or at the first key in the pane', async () => {
    const header = await mount()
    expect(header).toHaveAttribute('data-attention', 'true')
    await act(async () => { useTerminalStore.setState({ panes: { p1: working } }) })
    expect(header).not.toHaveAttribute('data-attention', 'true')
    await act(async () => { useTerminalStore.setState({ panes: { p1: blocked } }) })
    expect(header).toHaveAttribute('data-attention', 'true')
    await act(async () => { fireEvent.keyDown(header.parentElement!, { key: 'y' }) })
    expect(header).not.toHaveAttribute('data-attention', 'true')
  }, 30_000)

  test('CA-5 · the ring is a 2 px outline in --attn with a negative offset; the workspace stripe stays a box-shadow', () => {
    const rules = attentionRules()
    expect(rules.length, 'no CSS rule on data-attention').toBeGreaterThan(0)
    const body = rules.map(rule => rule.body).join(';')
    expect(body, 'outline: 2px solid var(--attn)').toMatch(/(?:^|[;\s{])outline\s*:\s*2px\s+solid\s+var\(--attn\)/)
    expect(body, 'a negative outline-offset').toMatch(/(?:^|[;\s{])outline-offset\s*:\s*-\d/)
    for (const rule of rules) expect(rule.body, `${rule.path}: ${rule.selector}`).not.toMatch(/(?:^|[;\s{])(?:box-shadow|height|min-height|max-height|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|border(?:-(?:top|bottom|left|right|block|inline))?(?:-width)?|line-height)\s*:/)
    const stripe = readFileSync(join(process.cwd(), 'src/design/workspace-color.css'), 'utf8')
    expect(stripe).toContain('.pane-container > .pane-header[data-ws] { box-shadow: inset 0 2px 0 color-mix(in srgb, var(--ws) 70%, transparent); }')
    expect(stripe).toContain('.pane-container:focus-within > .pane-header[data-ws] { box-shadow: inset 0 2px 0 var(--ws); }')
    const forced = readFileSync(join(process.cwd(), 'src/styles/forced-colors.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const found of forced.matchAll(/([^{}]*(?:data-attention|pane-header)[^{}]*)\{([^{}]*)\}/g)) expect(found[2], found[1].trim()).not.toMatch(/outline(?:-style)?\s*:\s*(?:none|0)/)
  })

  test('CA-5 · the ring does not change the header: the same box before and after data-attention, under the app rules (guard: holds today, must hold with the ring)', () => {
    // The app's own rules for the pane header (wherever they live) and for data-attention, applied by jsdom's cascade.
    const sheets = cssSources().filter(({ text }) => /\.pane-header|data-attention/.test(text))
    const style = document.createElement('style')
    style.textContent = sheets.map(sheet => sheet.text.replace(/@(?:container|layer)[^{;]*\{/g, '@media all {')).join(String.fromCharCode(10))
    document.head.append(style)
    const pane = document.createElement('div')
    pane.className = 'pane-container active'
    const header = document.createElement('header')
    header.className = 'pane-header'
    header.dataset.ws = '1'
    pane.append(header)
    document.body.append(pane)
    const BOX = ['height', 'min-height', 'max-height', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom',
      'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width', 'line-height', 'box-shadow']
    const measure = () => Object.fromEntries(BOX.map(name => [name, getComputedStyle(header).getPropertyValue(name)]))
    const before = measure()
    header.setAttribute('data-attention', 'true')
    expect(measure()).toEqual(before)
    style.remove()
  })

  test('CA-7 · movimento reduzido: the ring never pulses past the reduced-motion rule', () => {
    const rules = attentionRules()
    expect(rules.length, 'no CSS rule on data-attention').toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.selector, rule.path).not.toMatch(/spin/)
      expect(rule.body, `${rule.path}: ${rule.selector}`).not.toMatch(/animation[\w-]*\s*:[^;]*!important/)
    }
    const baseCss = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8')
    expect(baseCss).toMatch(/:root\[data-motion='reduce'\] body \*:not\(\[class\*="spin"\]\)[\s\S]*?animation-iteration-count: 1 !important/)
  })
})
