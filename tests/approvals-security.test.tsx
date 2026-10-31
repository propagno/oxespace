import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mainMessage } from '../shared/messages'
import { changeLanguage } from '../src/i18n'
import { useContributedCommands } from '../src/utils/commandRegistry'
import { resetApprovalsApi } from '../src/components/Approvals/approvalsApi'
import { installApprovalsMock, mockRequest, type ApprovalsMockHook, type MockRequestInput } from '../src/components/Approvals/approvalsMock'
import { resetApprovalsBoot } from '../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'
import { ApprovalCenter } from '../src/components/Approvals/ApprovalCenter'
import { ApprovalsHost } from '../src/components/Approvals/ApprovalsHost'
import { hasHiddenChars, revealHidden } from '../src/components/Approvals/hiddenChars'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import { threadApprovalRisk } from '../src/components/Threads/threadApprovalRisk'
import type { ApprovalsApi } from '../shared/types/approvals'
import type { ThreadRequest } from '../shared/types/thread'

/** F18 · the review findings on PR #243 (R1–R9): the window answers only what the person saw, and hides nothing. */

let hook: ApprovalsMockHook
let api: ApprovalsApi & { hook: ApprovalsMockHook }
let focused = true

beforeEach(() => {
  resetApprovalsApi()
  resetApprovalsBoot()
  useApprovalsStore.getState().reset()
  api = installApprovalsMock()
  hook = api.hook
  focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const dialog = () => screen.getByTestId('approval-dialog')
const request = (partial: MockRequestInput = {}) => act(() => { hook.request(partial) })
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const blur = () => act(() => { focused = false; window.dispatchEvent(new Event('blur')) })
const focus = () => act(() => { focused = true; window.dispatchEvent(new Event('focus')) })

async function mount(armMs = 0) {
  render(<ApprovalCenter armMs={armMs} />)
  await waitFor(() => expect(screen.getByTestId('approval-dialog')).toBeInTheDocument())
}

describe('R1 · the answer belongs to the request on screen', () => {
  it('a click on A after A was cancelled and B took its place does not answer B; B then renders fresh', async () => {
    request({ id: 'A', createdAt: 1, agentText: 'request A' })
    request({ id: 'B', createdAt: 2, agentText: 'request B' })
    await mount()
    await waitFor(() => expect(hook.acks.map(ack => ack.id)).toEqual(['A']))
    const allowA = within(dialog()).getByRole('button', { name: 'Allow once' })
    const respond = vi.spyOn(api, 'respond')
    // Between the render and the click: A is withdrawn by its source and B becomes first in the queue. The click
    // reaches A's button before React re-renders (the race the review found).
    const previous = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    try {
      hook.settle('A', 'cancelled')
      expect(useApprovalsStore.getState().queue.map(item => item.id)).toEqual(['B'])
      expect(allowA.isConnected).toBe(true)
      allowA.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    } finally {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous
    }
    await waitFor(() => expect(dialog()).toHaveTextContent('request B'))
    expect(respond).not.toHaveBeenCalled()
    expect(hook.responses).toEqual([])
    expect(useApprovalsStore.getState().queue.map(item => item.id)).toEqual(['B'])
    // B is a fresh dialog: its own buttons, and its own ack.
    const allowB = within(dialog()).getByRole('button', { name: 'Allow once' })
    expect(allowB).not.toBe(allowA)
    await waitFor(() => expect(hook.acks.map(ack => ack.id)).toEqual(['A', 'B']))
  })

  it('the store answers only the rendered id, generation and options, never the head of the queue', async () => {
    const a = mockRequest({ id: 'a', createdAt: 1 })
    const b = mockRequest({ id: 'b', createdAt: 2 })
    const respond = vi.spyOn(api, 'respond')
    act(() => useApprovalsStore.setState({ queue: [b] }))
    await useApprovalsStore.getState().respond(api, a, 'allow')
    // A re-issued generation of b is not the one the person saw.
    await useApprovalsStore.getState().respond(api, { ...b, generation: 2 }, 'allow')
    // An option the rendered request did not show is not answered, even if the stored one has it.
    await useApprovalsStore.getState().respond(api, { ...b, options: b.options.filter(option => option.id === 'deny') }, 'allow')
    await useApprovalsStore.getState().respond(api, { ...b, options: [...b.options, { id: 'sneaky', intent: 'allow', label: mainMessage('approvals.option.allowOnce', {}) }] }, 'sneaky')
    expect(respond).not.toHaveBeenCalled()
  })

  it('an allow before any ack is refused notShown by main, shown as a notice, and the request stays open', async () => {
    request({ id: 'ns' })
    await mount()
    hook.refuseNext('notShown')
    await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Your answer was not applied'))
    expect(useApprovalsStore.getState().queue.map(item => item.id)).toEqual(['ns'])
  })
})

describe('R2 · hidden characters in the agent text', () => {
  const CASES: Array<[string, string]> = [
    ['‪', 'U+202A'], ['‫', 'U+202B'], ['‬', 'U+202C'], ['‭', 'U+202D'], ['‮', 'U+202E'],
    ['⁦', 'U+2066'], ['⁧', 'U+2067'], ['⁨', 'U+2068'], ['⁩', 'U+2069'], ['‎', 'U+200E'], ['‏', 'U+200F'], ['؜', 'U+061C'],
    ['​', 'U+200B'], ['‌', 'U+200C'], ['‍', 'U+200D'], ['⁠', 'U+2060'], ['﻿', 'U+FEFF'], ['­', 'U+00AD'],
    ['\u{E0001}', 'U+E0001'], ['\u{E0041}', 'U+E0041'], ['\u{E007F}', 'U+E007F'], ['⁤', 'U+2064'], ['᠎', 'U+180E']
  ]

  it('marks every bidi, zero-width, tag and other format character by its code point', () => {
    for (const [char, code] of CASES) {
      expect(hasHiddenChars(`a${char}b`), code).toBe(true)
      expect(revealHidden(`a${char}b`), code).toEqual([{ kind: 'text', text: 'a' }, { kind: 'hidden', code }, { kind: 'text', text: 'b' }])
    }
    expect(hasHiddenChars('plain text, ação, 漢字, עברית')).toBe(false)
    expect(revealHidden('plain')).toEqual([{ kind: 'text', text: 'plain' }])
  })

  it('an RLO and zero-width characters show as markers inside the agent block, never take effect, and the app says so', async () => {
    // Reads "rm -rf /tmp/safe" with the RLO applied; the zero-width space splits a word that looks whole.
    const text = 'rm -rf /tmp/‮efas‬ ok​ay \u{E0041}\u{E0042}'
    request({ id: 'rlo', risk: 'low', agentText: text })
    await mount()
    const box = screen.getByTestId('approval-agent-text')
    const shown = box.textContent ?? ''
    // What is on screen, and what a copy takes, holds none of the characters: nothing can be reordered or hidden.
    expect(hasHiddenChars(shown)).toBe(false)
    expect(shown).toBe('rm -rf /tmp/⟨U+202E⟩efas⟨U+202C⟩ ok⟨U+200B⟩ay ⟨U+E0041⟩⟨U+E0042⟩')
    const markers = [...box.querySelectorAll('[data-hidden-char]')].map(node => node.getAttribute('data-hidden-char'))
    expect(markers).toEqual(['U+202E', 'U+202C', 'U+200B', 'U+E0041', 'U+E0042'])
    expect(screen.getByTestId('approval-agent-block').contains(box)).toBe(true)
    expect(box.getAttribute('dir')).toBe('ltr')
    // The app's own note, outside the agent block.
    const notes = screen.getByTestId('approval-app-notes')
    expect(notes).toHaveTextContent('invisible or direction-changing characters')
    expect(screen.getByTestId('approval-agent-block').contains(notes)).toBe(false)
    // At least high: no allow for this run, and the badge says High.
    expect(dialog()).toHaveTextContent('Risk: High')
    expect(within(dialog()).queryByRole('button', { name: 'Allow reads on this connection for this run' })).toBeNull()
    const css = readFileSync(join(__dirname, '..', 'src', 'components', 'Approvals', 'Approvals.module.css'), 'utf8')
    expect(css).toMatch(/\.hiddenChar \{[^}]*unicode-bidi: isolate/)
  })

  it('when main flags them (approvals.note.hiddenCharacters) its note is shown once, in its words', async () => {
    request({ id: 'flagged', risk: 'high', agentText: 'a‮b', appNotes: [mainMessage('approvals.note.hiddenCharacters', {})] })
    await mount()
    const notes = screen.getByTestId('approval-app-notes')
    expect(within(notes).getAllByRole('listitem')).toHaveLength(1)
    expect(notes).toHaveTextContent('so what you see may not be what runs')
    expect(screen.queryByTestId('approval-hidden-note')).toBeNull()
  })
})

describe('R3 · the hold and the ack follow the window being visible and focused', () => {
  it('acks with the window state, again on blur and on refocus, and restarts the visible hold on refocus', async () => {
    request({ id: 'crit', risk: 'critical', allowDelayMs: 600, enterDisabled: true })
    await mount()
    const allow = within(dialog()).getByRole('button', { name: 'Allow once' })
    await waitFor(() => expect(hook.acks).toEqual([{ id: 'crit', generation: 1, visible: true, focused: true }]))
    await sleep(300)
    blur()
    await waitFor(() => expect(hook.acks.at(-1)).toEqual({ id: 'crit', generation: 1, visible: true, focused: false }))
    expect(screen.getByTestId('approval-hold')).toHaveTextContent('Allow waits until this window is in front')
    await sleep(800)
    expect(allow).toBeDisabled()
    focus()
    await waitFor(() => expect(hook.acks.at(-1)).toEqual({ id: 'crit', generation: 1, visible: true, focused: true }))
    expect(hook.acks).toHaveLength(3)
    // The count starts again from the refocus: still held right after it.
    expect(allow).toBeDisabled()
    expect(screen.getByTestId('approval-hold')).toHaveTextContent('Allow is available in 1 s')
    await waitFor(() => expect(allow).toBeEnabled(), { timeout: 2_000 })
  })

  it('shown while the window is behind another: the ack says so, and the hold waits for focus', async () => {
    focused = false
    request({ id: 'behind', risk: 'critical', allowDelayMs: 400, enterDisabled: true })
    await mount()
    await waitFor(() => expect(hook.acks).toEqual([{ id: 'behind', generation: 1, visible: true, focused: false }]))
    await sleep(700)
    expect(within(dialog()).getByRole('button', { name: 'Allow once' })).toBeDisabled()
    focus()
    await waitFor(() => expect(hook.acks.at(-1)).toMatchObject({ focused: true }))
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'Allow once' })).toBeEnabled(), { timeout: 2_000 })
  })

  it('a hidden page counts as not looked at', async () => {
    request({ id: 'hidden-page', risk: 'critical', allowDelayMs: 400 })
    await mount()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(hook.acks.at(-1)).toEqual({ id: 'hidden-page', generation: 1, visible: false, focused: false }))
    visibility.mockReturnValue('visible')
    focus()
    await waitFor(() => expect(hook.acks.at(-1)).toEqual({ id: 'hidden-page', generation: 1, visible: true, focused: true }))
  })
})

describe('R4 · each request acks itself; a crash hands everything back to main', () => {
  it('each request on screen acks once per generation, and a re-issued generation acks again', async () => {
    request({ id: 'one', createdAt: 1 })
    request({ id: 'two', createdAt: 2 })
    await mount()
    await waitFor(() => expect(hook.acks.map(ack => `${ack.id}#${ack.generation}`)).toEqual(['one#1']))
    act(() => useApprovalsStore.setState(state => ({ queue: [...state.queue] })))
    act(() => hook.bump('one'))
    await waitFor(() => expect(hook.acks.map(ack => `${ack.id}#${ack.generation}`)).toEqual(['one#1', 'one#2']))
    await userEvent.setup().click(within(dialog()).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(hook.acks.map(ack => `${ack.id}#${ack.generation}`)).toEqual(['one#1', 'one#2', 'two#1']))
  })

  it('a dialog that throws after mounting: every remaining request goes native once each, the window says so, nothing is answered', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unavailable = vi.spyOn(api, 'unavailable')
    render(<ApprovalsHost />)
    act(() => { hook.request({ id: 'good', createdAt: 1 }) })
    expect(await screen.findByTestId('approval-dialog', {}, { timeout: 15_000 })).toBeInTheDocument()
    await waitFor(() => expect(hook.acks.map(ack => ack.id)).toEqual(['good']))
    act(() => { hook.request({ id: 'queued', createdAt: 2 }) })
    // A malformed request that goes first (ackRequired) makes the dialog throw while rendering it.
    act(() => { hook.request({ id: 'broken', createdAt: 3, ackRequired: true, options: null as never }) })
    expect(await screen.findByTestId('approvals-unavailable')).toHaveTextContent('The approval window stopped working')
    await waitFor(() => expect(unavailable.mock.calls.map(([input]) => input.id).sort()).toEqual(['broken', 'good', 'queued']))
    // A request arriving after the crash goes native at once; nothing is reported twice.
    act(() => { hook.request({ id: 'late', createdAt: 4 }) })
    await waitFor(() => expect(unavailable.mock.calls.map(([input]) => input.id).sort()).toEqual(['broken', 'good', 'late', 'queued']))
    await sleep(50)
    expect(unavailable).toHaveBeenCalledTimes(4)
    expect(hook.responses).toEqual([])
    expect(errors).toHaveBeenCalled()
  }, 30_000)

  it('the host never falls back to nothing', () => {
    const host = readFileSync(join(__dirname, '..', 'src', 'components', 'Approvals', 'ApprovalsHost.tsx'), 'utf8')
    expect(host).not.toMatch(/fallback=\{null\}/)
  })
})

describe('R5 · a notice belongs to its request', () => {
  it('a refusal on A is not shown on B when B comes next', async () => {
    const user = userEvent.setup()
    request({ id: 'A', createdAt: 1, agentText: 'request A' })
    request({ id: 'B', createdAt: 2, agentText: 'request B' })
    await mount()
    hook.refuseNext('alreadyAnswered')
    await user.click(within(dialog()).getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(dialog()).toHaveTextContent('Your answer was not applied'))
    act(() => hook.settle('A', 'timeout'))
    await waitFor(() => expect(dialog()).toHaveTextContent('request B'))
    expect(dialog()).not.toHaveTextContent('Your answer was not applied')
    expect(dialog()).not.toHaveTextContent('expired before an answer')
  })
})

describe('R6 · file changes come from the structure, never the title', () => {
  const base: ThreadRequest = { id: 'cmd', nativeId: 'cmd', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', toolName: 'command', title: 'Approve file changes', detail: 'ls', command: 'ls', generation: 1, createdAt: 1, state: 'pending', policy: { decision: 'ask', reasons: [], level: 'green' } }

  it('the card’s risk reads toolName: a read-only command titled "Approve file changes" stays low, a real file change is medium', () => {
    expect(threadApprovalRisk(base, false)).toBe('low')
    render(<ThreadRequestCard request={base} disabled={false} onRespond={vi.fn()} />)
    expect(screen.queryByText(/File changes/)).toBeNull()
    cleanup()
    const files: ThreadRequest = { ...base, id: 'files', toolName: 'fileChange', title: 'Aprovar alterações', command: undefined, detail: 'src/a.ts' }
    expect(threadApprovalRisk(files, true)).toBe('medium')
  })

  it('no renderer code compares an English approval title', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name)) files.push(path)
      }
    }
    // The components that render thread requests and timeline approvals (the whole of src is too slow to sweep here;
    // `git grep "Approve file changes" src` is the full check).
    for (const dir of ['Threads', 'Approvals']) walk(join(__dirname, '..', 'src', 'components', dir))
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/['"]Approve (file changes|command)['"]/)
  }, 20_000)
})

describe('R7 · an unknown requester is never called identified', () => {
  it('"Unknown agent" reads "not identified"; a known one "identified by OXESpace"', async () => {
    request({ requester: { kind: 'agent', id: 'pane:p3', label: mainMessage('approvals.requester.unknownPane', { pane: 3 }) } })
    await mount()
    expect(dialog()).toHaveTextContent('Unknown agent · pane 3')
    expect(screen.getByTestId('approval-requester-kind')).toHaveTextContent('Agent · not identified')
    expect(dialog()).not.toHaveTextContent('identified by OXESpace')
    cleanup(); useApprovalsStore.getState().reset(); hook.reset()
    request({ id: 'known' })
    await mount()
    expect(screen.getByTestId('approval-requester-kind')).toHaveTextContent('Agent · identified by OXESpace')
  })
})

describe('R8 · a resolution for an older generation does not close the newer one', () => {
  it('keeps generation 2 open when generation 1 is resolved, and ignores a late older request', () => {
    const second = mockRequest({ id: 'g', generation: 2 })
    act(() => useApprovalsStore.setState({ queue: [second] }))
    useApprovalsStore.getState().resolved({ id: 'g', generation: 1, outcome: 'deny', optionId: 'deny', by: 'timeout' })
    expect(useApprovalsStore.getState().queue).toEqual([second])
    expect(useApprovalsStore.getState().settled).toBeNull()
    useApprovalsStore.getState().received(mockRequest({ id: 'g', generation: 1 }))
    expect(useApprovalsStore.getState().queue.map(item => item.generation)).toEqual([2])
    useApprovalsStore.getState().resolved({ id: 'g', generation: 2, outcome: 'deny', optionId: 'deny', by: 'cancelled' })
    expect(useApprovalsStore.getState().queue).toEqual([])
  })
})

describe('R9 · keys typed elsewhere never answer', () => {
  it('a request that appears while someone types in another region does not take their keys', async () => {
    const user = userEvent.setup()
    render(<textarea aria-label="terminal input" />)
    const terminal = screen.getByLabelText('terminal input')
    terminal.focus()
    request({ id: 'typing' })
    await mount()
    // Focus moved into the dialog (it is modal) but not onto a button.
    expect((document.activeElement as HTMLElement).dataset.intent).toBeUndefined()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    // Escape and Enter dispatched in the other region never reach the dialog's answers.
    fireEvent.keyDown(terminal, { key: 'Escape' })
    fireEvent.keyDown(terminal, { key: 'Enter' })
    await sleep(50)
    expect(hook.responses).toEqual([])
    expect(dialog()).toBeInTheDocument()
  })

  it('a held key’s repeats, a keyboard click without its own key down and an outside Escape do nothing', async () => {
    request({ id: 'repeat' })
    await mount()
    const deny = within(dialog()).getByRole('button', { name: 'Deny' })
    fireEvent.keyDown(deny, { key: 'Enter', repeat: true })
    fireEvent.click(deny, { detail: 0 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(deny, { key: 'Escape', repeat: true })
    await sleep(50)
    expect(hook.responses).toEqual([])
    // Its own Escape still denies.
    fireEvent.keyDown(deny, { key: 'Escape' })
    await waitFor(() => expect(hook.responses).toEqual([{ id: 'repeat', optionId: 'deny', generation: 1 }]))
  })
})

describe('palette · the approval history command follows the catalog pattern (F17)', () => {
  it('reads "Help: Show approval history" in the Help group, in English and Portuguese, with its search words', async () => {
    const { result } = renderHook(() => useContributedCommands())
    const command = () => result.current.find(item => item.id === 'help.approvals')
    expect(command()).toMatchObject({ title: 'Help: Show approval history', category: 'Help' })
    expect(command()?.keywords).toEqual(expect.arrayContaining(['approvals', 'aprovações', 'histórico']))
    await act(async () => { await changeLanguage('pt-BR') })
    expect(command()?.title).toBe('Ajuda: Mostrar histórico de aprovações')
    await act(async () => { await changeLanguage('en') })
  })
})

describe('P1-17 · a change to a file that steers agents is answered by a person, each time', () => {
  const guarded: ThreadRequest = {
    id: 'mcp-json', nativeId: 'mcp-json', nativeMethod: 'can_use_tool:Edit', kind: 'approval', toolName: 'Edit', title: 'Edit .mcp.json', detail: '{"file_path":".mcp.json"}', command: '{"file_path":".mcp.json"}', paths: ['.mcp.json'],
    generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'acceptForSession', 'decline'],
    policy: { decision: 'ask', reasons: ['.mcp.json configures the agent’s MCP servers.'], level: 'orange', guarded: true, warnings: ['Changes here steer every agent in this project.'], suggestions: [{ kind: 'path', pattern: '.mcp.json', label: '.mcp.json' }] }
  }

  it('shows the agent-steering badge, offers no session allow and nothing to remember, and Approve is not primary', () => {
    render(<ThreadRequestCard request={guarded} disabled={false} onRespond={vi.fn()} onRemember={vi.fn()} />)
    expect(screen.getByTestId('approval-guarded')).toHaveTextContent('Agent-steering file')
    expect(screen.getByTestId('approval-guarded-hint')).toHaveTextContent('Only a person approves it, each time')
    expect(screen.queryByRole('button', { name: 'Allow session' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull()
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve.dataset.guarded).toBe('true')
    expect(approve.className).toMatch(/quiet/)
    // The reasons the request carries still show, through the policy block, and the exact text is open.
    expect(screen.getByText('.mcp.json configures the agent’s MCP servers.')).toBeInTheDocument()
    expect(screen.getByText('Changes here steer every agent in this project.')).toBeInTheDocument()
    expect(screen.getByTestId('approval-exact')).toBeInTheDocument()
  })

  it('reads in Portuguese, and a low-risk request without the signal keeps its session option', async () => {
    await act(async () => { await changeLanguage('pt-BR') })
    render(<ThreadRequestCard request={guarded} disabled={false} onRespond={vi.fn()} />)
    expect(screen.getByTestId('approval-guarded')).toHaveTextContent('Arquivo que orienta o agente')
    await act(async () => { await changeLanguage('en') })
    cleanup()
    const plain: ThreadRequest = { ...guarded, id: 'plain', title: 'Approve', toolName: 'command', command: 'ls', detail: 'ls', paths: undefined, policy: { decision: 'ask', reasons: ['ls reads'], level: 'green' } }
    render(<ThreadRequestCard request={plain} disabled={false} onRespond={vi.fn()} />)
    expect(screen.queryByTestId('approval-guarded')).toBeNull()
    expect(screen.getByRole('button', { name: 'Allow session' })).toBeInTheDocument()
  })
})
