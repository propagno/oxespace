import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadRequest, ThreadSnapshot } from '../../shared/types/thread'
import { ThreadChangesPanel } from '../../src/components/Threads/ThreadChangesPanel'
import { ThreadRequestCard } from '../../src/components/Threads/ThreadRequestCard'
import { ThreadSidebarRow } from '../../src/components/Threads/ThreadSidebarRow'
import { changeLanguage } from '../../src/i18n'
import { useThreadWorkbenchStore } from '../../src/store/thread-workbench.store'

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const priorOxe = Object.getOwnPropertyDescriptor(window, 'oxe')

beforeEach(() => {
  localStorage.clear()
  useThreadWorkbenchStore.setState({ views: {}, maximizedId: null })
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: {
        respond: vi.fn(async () => undefined)
      },
      clipboard: {
        writeText: vi.fn(async () => true)
      }
    }
  })
})

afterEach(async () => {
  cleanup()
  if (priorOxe) Object.defineProperty(window, 'oxe', priorOxe)
  else Reflect.deleteProperty(window, 'oxe')
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-464 · OxeChat unified composer, numbered cards, silent sidebar & tabbed auxiliary pane', () => {
  it('fuses the unified composer into one Obsidian Minimal hairline surface with Mandacaru focus halo and weightless config pills', () => {
    const composerCss = readCss('src/components/Threads/ThreadComposerChrome.css')
    const openingCss = readCss('src/components/Threads/NewConversationScreen.module.css')

    const composerRule = composerCss.match(/\.thread-composer\[data-ui='composer'\]\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(composerRule).toMatch(/border:\s*1px solid var\(--bd-default\)/)
    expect(composerRule).toMatch(/border-radius:\s*var\(--radius-lg\)/)
    expect(composerRule).toMatch(/background:\s*var\(--surface-raised\)/)

    const composerFocus = composerCss.match(/\.thread-composer\[data-ui='composer'\]:focus-within\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(composerFocus).toMatch(/border-color:\s*var\(--accent-border\)/)
    expect(composerFocus).toMatch(/box-shadow:[^;]*var\(--accent\)/)

    const chipRule = composerCss.match(/\.thread-composer \.thread-config-trigger\.thread-chip,\s*\.thread-composer \.thread-chip\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(chipRule).toMatch(/background:\s*transparent/)
    expect(chipRule).toMatch(/color:\s*var\(--tx-secondary\)/)

    const chipHover = composerCss.match(/\.thread-composer \.thread-config-trigger\.thread-chip:hover:not\(:disabled\),\s*\.thread-composer \.thread-chip:hover:not\(:disabled\)\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(chipHover).toMatch(/background:\s*var\(--fill-hover\)/)
    expect(chipHover).toMatch(/color:\s*var\(--tx-primary\)/)

    const openingFocus = openingCss.match(/\.composer:focus-within\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(openingFocus).toMatch(/border-color:\s*var\(--accent-border\)/)
    expect(openingFocus).toMatch(/box-shadow:[^;]*var\(--accent\)/)

    const starterRule = openingCss.match(/\.starter\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(starterRule).toMatch(/border:\s*1px solid var\(--bd-subtle\)/)
    expect(starterRule).toMatch(/background:\s*var\(--surface-chrome\)/)
  })

  it('numbers question options (1..9), supports 1..9 keyboard selection inside the card, and never hijacks typing in text inputs or composer', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn(async () => undefined)
    const questionRequest: ThreadRequest = {
      id: 'q-464',
      nativeId: 'n-q-464',
      nativeMethod: 'can_use_tool:AskUserQuestion',
      kind: 'question',
      title: 'Choose verification scope',
      generation: 1,
      createdAt: 100,
      state: 'pending',
      questions: [{
        id: 'scope',
        question: 'Which suite should run first?',
        options: [
          { label: 'Unit tests', description: 'Fast Vitest checks' },
          { label: 'UI acceptance', description: 'Component contracts' },
          { label: 'Full build', description: 'Typecheck + bundle' }
        ]
      }]
    }

    const { container } = render(
      <div>
        <textarea aria-label="Message" />
        <ThreadRequestCard request={questionRequest} agent="Claude" disabled={false} conversationId="t-464" onRespond={onRespond} />
      </div>
    )

    const card = container.querySelector<HTMLElement>('[data-ui="request-card"]')!
    const keycaps = [...card.querySelectorAll<HTMLElement>('[data-ui="option-key"]')].map(el => el.dataset.optionKey)
    expect(keycaps).toEqual(['1', '2', '3'])

    const radios = within(card).getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(3)
    expect(radios.every(r => !r.checked)).toBe(true)

    // Focus inside the card and press '2' -> selects option 2; press '3' -> selects option 3.
    radios[0].focus()
    fireEvent.keyDown(radios[0], { key: '2' })
    expect(radios[1].checked).toBe(true)

    fireEvent.keyDown(radios[1], { key: '3' })
    expect(radios[2].checked).toBe(true)
    expect(radios[1].checked).toBe(false)

    // Typing '1' inside the "Other option…" text input must enter text and NOT select radio 1.
    const otherInput = within(card).getByPlaceholderText('Other option…') as HTMLInputElement
    await user.click(otherInput)
    await user.type(otherInput, '1 custom step')
    expect(otherInput.value).toBe('1 custom step')
    expect(radios[0].checked).toBe(false)

    // Typing '1' inside an external composer textarea must NEVER trigger option selection.
    const composer = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.click(composer)
    await user.type(composer, '1')
    expect(composer.value).toBe('1')
    expect(radios[0].checked).toBe(false)
  })

  it('numbers approval choices with safe 1/2 shortcuts and preserves high/critical/irreversible safety guards', () => {
    const lowRespond = vi.fn(async () => undefined)
    const lowRequest: ThreadRequest = {
      id: 'app-low',
      nativeId: 'n-low',
      nativeMethod: 'can_use_tool:Bash',
      kind: 'approval',
      title: 'Run tests',
      toolName: 'Bash',
      command: 'npm test',
      generation: 1,
      createdAt: 100,
      state: 'pending',
      availableDecisions: ['accept', 'decline'],
      impact: {
        where: 'oxespace',
        affects: { count: 1, unit: 'files' },
        reversible: true,
        risk: 'low',
        kind: 'command',
        text: 'npm test',
        lang: 'shell'
      }
    }

    const { container, rerender } = render(
      <ThreadRequestCard request={lowRequest} agent="Claude" disabled={false} conversationId="t-464" onRespond={lowRespond} />
    )
    const card = container.querySelector<HTMLElement>('[data-ui="request-card"]')!
    expect([...card.querySelectorAll<HTMLElement>('[data-ui="option-key"]')].map(el => el.dataset.optionKey)).toEqual(['1', '2'])

    const denyBtn = within(card).getByRole('button', { name: 'Deny' })
    denyBtn.focus()
    fireEvent.keyDown(denyBtn, { key: '2' })
    expect(lowRespond).toHaveBeenCalledTimes(1)
    expect(lowRespond).toHaveBeenCalledWith({ decision: 'accept' })

    // High-risk irreversible approval: '2' opens See impact and NEVER approves.
    const highRespond = vi.fn(async () => undefined)
    const onSeeImpact = vi.fn()
    const highRequest: ThreadRequest = {
      ...lowRequest,
      id: 'app-high',
      impact: { ...lowRequest.impact!, risk: 'high', reversible: false, text: 'rm -rf ./dist' }
    }
    rerender(
      <ThreadRequestCard request={highRequest} agent="Claude" disabled={false} conversationId="t-464" onRespond={highRespond} onSeeImpact={onSeeImpact} />
    )
    const highCard = container.querySelector<HTMLElement>('[data-ui="request-card"]')!
    const highDeny = within(highCard).getByRole('button', { name: 'Deny' })
    highDeny.focus()
    fireEvent.keyDown(highDeny, { key: '2' })
    expect(onSeeImpact).toHaveBeenCalledTimes(1)
    expect(highRespond).not.toHaveBeenCalled()

    // Pressing '1' denies cleanly.
    fireEvent.keyDown(highDeny, { key: '1' })
    expect(highRespond).toHaveBeenCalledTimes(1)
    expect(highRespond).toHaveBeenCalledWith({ decision: 'decline' })

    // Verify Obsidian Minimal containment styles on ThreadRequestCard & ThreadApprovalDetails.
    const cardCss = readCss('src/components/Threads/ThreadRequestCard.module.css')
    expect(cardCss).toMatch(/\.command\s*\{[^}]*overflow-x:\s*auto[^}]*background:\s*var\(--surface-sunken\)/)
    expect(cardCss).toMatch(/\.impact\s*\{[^}]*border:\s*1px solid var\(--attn-border\)[^}]*border-left:\s*3px solid var\(--attn\)/)
  })

  it('preserves OXE-448 harmonized Finished indicator and quiet Obsidian Minimal sidebar/header chrome', () => {
    const finishedThread: ConversationThread = {
      id: 't-done',
      workspaceId: 'ws-1',
      projectId: 'p-1',
      rootPath: '/repo',
      provider: 'claude',
      nativeSessionId: 'native-done',
      title: 'Refine composer spacing',
      pinned: false,
      status: 'idle',
      lastTurnStatus: 'completed',
      createdAt: 10,
      updatedAt: 20
    }

    const { container } = render(
      <ThreadSidebarRow
        thread={finishedThread}
        selected={false}
        unread={false}
        time="2m"
        onSelect={vi.fn()}
        onMenu={vi.fn()}
        onOpenRequest={vi.fn()}
      />
    )

    const indicator = container.querySelector<HTMLElement>('.thread-session-indicator[data-status="completed"]')!
    expect(indicator).not.toBeNull()
    const checkIcon = indicator.querySelector<SVGSVGElement>('svg.lucide-check')!
    expect(checkIcon).not.toBeNull()
    expect(Number(checkIcon.getAttribute('width'))).toBeLessThanOrEqual(12)
    expect(checkIcon.getAttribute('stroke-width')).toBe('2')

    const sidebarCss = readCss('src/components/Threads/ThreadSidebar.module.css')
    expect(sidebarCss).toContain("color-mix(in srgb, var(--intent-success-fg) 65%, var(--tx-muted))")

    const headerCss = readCss('src/components/Threads/ThreadHeaderChrome.css')
    expect(headerCss).toMatch(/\.thread-heading\s*\{[^}]*border-bottom:\s*1px solid var\(--bd-subtle\)/)
    const viewCss = readCss('src/components/Threads/ThreadView.css')
    const navRule = viewCss.match(/\.thread-navigation\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(navRule).toMatch(/background:\s*var\(--surface-chrome\)/)
    expect(navRule).toMatch(/border-right:\s*1px solid var\(--bd-subtle\)/)
  })

  it('consolidates Auxiliary Pane with a hairline tab strip for 1-click Changes/Plan/Preview/Terminal/Requests switching', async () => {
    const user = userEvent.setup()
    const thread: ConversationThread = {
      id: 't-aux',
      workspaceId: 'ws-1',
      projectId: 'p-1',
      rootPath: '/repo',
      provider: 'claude',
      nativeSessionId: 'native-aux',
      title: 'Audit workspace',
      pinned: false,
      status: 'approval',
      createdAt: 10,
      updatedAt: 20
    }
    const pendingReq: ThreadRequest = {
      id: 'req-aux-1',
      nativeId: 'n-aux-1',
      nativeMethod: 'can_use_tool:Bash',
      kind: 'approval',
      title: 'Run lint',
      toolName: 'Bash',
      command: 'npx eslint src',
      generation: 1,
      createdAt: 50,
      state: 'pending',
      availableDecisions: ['accept', 'decline'],
      impact: {
        where: 'repo',
        affects: { count: 1, unit: 'files' },
        reversible: true,
        risk: 'low',
        kind: 'command',
        text: 'npx eslint src',
        lang: 'shell'
      }
    }
    const snapshot: ThreadSnapshot = {
      thread,
      pendingRequests: [pendingReq],
      events: [
        {
          type: 'plan',
          id: 'plan-1',
          explanation: 'Execute OXE-464 cleanly',
          steps: [
            { label: 'Polish unified composer', status: 'completed' },
            { label: 'Verify auxiliary pane tabs', status: 'inProgress' }
          ]
        }
      ]
    }

    const { rerender, container } = render(
      <ThreadChangesPanel snapshot={snapshot} panel="changes" onClose={vi.fn()} />
    )

    const tablist = screen.getByRole('tablist', { name: 'Auxiliary pane views' })
    expect(tablist).toHaveAttribute('data-ui', 'aux-tabs')
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map(tab => tab.getAttribute('data-panel'))).toEqual(['changes', 'plan', 'preview', 'terminal', 'requests'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // Quiet tabular counts on Plan (1/2) and Requests (1).
    expect(tabs[1].textContent).toContain('1/2')
    expect(tabs[4].textContent).toContain('1')

    // 1-click switch to Plan updates store and renders ThreadPlan steps.
    await user.click(tabs[1])
    expect(useThreadWorkbenchStore.getState().views['t-aux']?.panel).toBe('plan')
    rerender(<ThreadChangesPanel snapshot={snapshot} panel="plan" onClose={vi.fn()} />)
    expect(screen.getByText('Polish unified composer')).toBeVisible()
    expect(screen.getByText('Verify auxiliary pane tabs')).toBeVisible()

    // 1-click switch to Requests updates store and renders the pending ThreadRequestCard.
    await user.click(within(tablist).getAllByRole('tab')[4])
    expect(useThreadWorkbenchStore.getState().views['t-aux']?.panel).toBe('requests')
    rerender(<ThreadChangesPanel snapshot={snapshot} panel="requests" onClose={vi.fn()} />)
    expect(container.querySelector('[data-ui="request-card"]')).not.toBeNull()
    expect(screen.getByText('npx eslint src')).toBeVisible()

    // Keyboard navigation: Home returns to Changes, ArrowRight advances to Plan.
    const activeReqTab = within(tablist).getAllByRole('tab')[4]
    activeReqTab.focus()
    fireEvent.keyDown(activeReqTab, { key: 'Home' })
    expect(useThreadWorkbenchStore.getState().views['t-aux']?.panel).toBe('changes')

    // Verify hairline tab strip CSS tokens (Mandacaru active underline, zero boxy selected fill).
    const wbCss = readCss('src/components/Threads/ThreadWorkbench.css')
    expect(wbCss).toMatch(/\.thread-review-heading\s*\{[^}]*height:\s*var\(--bar-lg\)[^}]*border-bottom:\s*1px solid var\(--bd-subtle\)/)
    expect(wbCss).toMatch(/\.thread-review-heading \.thread-aux-tab\[aria-selected='true'\]\s*\{[^}]*background:\s*transparent[^}]*border-bottom-color:\s*var\(--accent\)/)
  })
})
