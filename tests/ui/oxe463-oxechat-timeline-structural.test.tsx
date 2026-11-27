import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relativeTurnPath } from '../../shared/threadFilePath'
import { toolRow } from '../../shared/thread-tool-rows'
import type { ThreadEvent, ThreadSnapshot } from '../../shared/types/thread'
import { deriveThreadActivity } from '../../src/components/Threads/deriveThreadActivity'
import { ThreadActivityGroup } from '../../src/components/Threads/ThreadActivityGroup'
import { threadFileLabel } from '../../src/components/Threads/threadChanges'
import { ThreadLiveActivity } from '../../src/components/Threads/ThreadLiveActivity'
import { ThreadTurnFoldRow } from '../../src/components/Threads/ThreadTurnFold'
import { summarizeShellCommand } from '../../src/components/Threads/toolStepFormat'
import { changeLanguage } from '../../src/i18n'
import { useThreadViewModeStore } from '../../src/store/thread-view-mode.store'
import { useThreadWorkbenchStore } from '../../src/store/thread-workbench.store'

type Tool = Extract<ThreadEvent, { type: 'tool' }>

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const priorOxe = Object.getOwnPropertyDescriptor(window, 'oxe')

beforeEach(() => {
  localStorage.clear()
  useThreadViewModeStore.setState({ mode: 'normal' })
  useThreadWorkbenchStore.setState({ views: {} })
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: {} } })
})

afterEach(async () => {
  cleanup()
  if (priorOxe) Object.defineProperty(window, 'oxe', priorOxe)
  else Reflect.deleteProperty(window, 'oxe')
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-463 · OxeChat timeline structural reconstruction', () => {
  it('normalizes leading-slash Windows paths & file URIs and renders edit path EXACTLY ONCE with zero duplication', async () => {
    const user = userEvent.setup()
    const winRoot = 'C:\\Users\\dudu-\\Estudos\\oxe-453'
    const slashWinPath = '/C:/Users/dudu-/Estudos/oxe-453/src/components/Threads/ThreadView.css'
    const fileUriPath = 'file:///C:/Users/dudu-/Estudos/oxe-453/src/components/Threads/ThreadView.css'

    expect(relativeTurnPath(slashWinPath, [winRoot]).label).toBe('src/components/Threads/ThreadView.css')
    expect(relativeTurnPath(fileUriPath, [winRoot]).label).toBe('src/components/Threads/ThreadView.css')
    expect(threadFileLabel(slashWinPath, winRoot)).toBe('src/components/Threads/ThreadView.css')

    const editEvent: Tool = {
      type: 'tool',
      id: 'edit-1',
      name: 'Edit',
      state: 'completed',
      detail: JSON.stringify({ file_path: slashWinPath }),
      output: 'Updated ThreadView.css cleanly',
      files: [{
        path: slashWinPath,
        kind: 'update',
        source: 'native-patch',
        state: 'completed',
        additions: 14,
        deletions: 5
      }],
      startedAt: 1_000,
      completedAt: 1_300
    }

    const row = toolRow(editEvent, winRoot)
    expect(row.kind).toBe('edit')
    expect(row.target).toBe('src/components/Threads/ThreadView.css')
    expect(row.target).not.toContain('/C:/')

    const liveSnapshot = {
      thread: { id: 't1', workspaceId: 'ws', projectId: 'p1', rootPath: winRoot, provider: 'claude', title: 'Audit', pinned: false, status: 'running', nativeSessionId: null, createdAt: 1, updatedAt: 2 },
      turns: [{ id: 'u1', sequence: 1, status: 'running', startedAt: 1, configuration: {} }],
      events: [{ ...editEvent, state: 'running' as const }]
    } as unknown as ThreadSnapshot
    expect(deriveThreadActivity(liveSnapshot, [])?.text).toBe('src/components/Threads/ThreadView.css')

    const { container } = render(
      <ThreadActivityGroup events={[editEvent]} mode="normal" rootPath={winRoot} threadId="t1" />
    )

    const step = container.querySelector<HTMLElement>('[data-ui="step"][data-kind="edit"]')!
    expect(step).not.toBeNull()

    const fullText = step.textContent ?? ''
    const matches = fullText.match(/src\/components\/Threads\/ThreadView\.css/g) ?? []
    expect(matches, 'relative edit path must appear exactly once').toHaveLength(1)
    expect(fullText, 'no leading-slash Windows absolute path leakage').not.toContain('/C:/Users')
    expect(fullText).not.toContain('C:\\Users')

    const pill = step.querySelector<HTMLElement>('[data-ui="file-pill"]')!
    expect(pill).not.toBeNull()
    expect(pill.textContent).toBe('src/components/Threads/ThreadView.css')
    expect(pill.getAttribute('title')).toBe('C:/Users/dudu-/Estudos/oxe-453/src/components/Threads/ThreadView.css')

    // Clicking the file pill opens Changes; clicking the toggle expands inline output.
    await user.click(pill)
    expect(useThreadWorkbenchStore.getState().views.t1?.panel).toBe('changes')

    const toggle = within(step).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.textContent).not.toContain('ThreadView.css')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(step.querySelector('[data-ui="step-output"]')?.textContent).toContain('Updated ThreadView.css cleanly')
  })

  it('summarizes 300+ char PowerShell commands into contained truncation and expands full raw command + output on click', async () => {
    const user = userEvent.setup()
    const winRoot = 'C:\\Users\\dudu-\\Estudos\\oxe-453'
    const longArgs = Array.from({ length: 14 }, (_, i) => `tests/ui/oxe463-spec-segment-${i}.test.tsx`).join(' ')
    const rawCommand = `Push-Location "${winRoot}"; $ErrorActionPreference = 'Stop'; Remove-Item Env:OXESPACE_* -ErrorAction SilentlyContinue; npx vitest run ${longArgs}; Pop-Location`
    expect(rawCommand.length).toBeGreaterThan(300)

    const summary = summarizeShellCommand(rawCommand, winRoot)
    expect(summary).toMatch(/^npx vitest run /)
    expect(summary).not.toContain('Push-Location')
    expect(summary).not.toContain('ErrorActionPreference')
    expect(summary).not.toContain('Remove-Item Env:')
    expect(summary).not.toContain('Pop-Location')
    expect(summary.length).toBeLessThanOrEqual(140)

    // Simple commands stay verbatim.
    expect(summarizeShellCommand('pnpm test', winRoot)).toBe('pnpm test')

    const runEvent: Tool = {
      type: 'tool',
      id: 'run-ps-1',
      name: 'PowerShell',
      state: 'completed',
      detail: JSON.stringify({ command: rawCommand }),
      output: 'PASS 14 test files',
      exitCode: 0,
      startedAt: 1_000,
      completedAt: 2_500
    }

    const { container } = render(
      <ThreadActivityGroup events={[runEvent]} mode="normal" rootPath={winRoot} threadId="t1" />
    )

    const step = container.querySelector<HTMLElement>('[data-ui="step"][data-kind="run"]')!
    expect(step.querySelector('.thread-step-signal [data-ui="status-signal"]')).not.toBeNull()

    const toggle = step.querySelector<HTMLElement>('.thread-step-toggle')!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.getAttribute('title')).toBe(rawCommand)
    const code = toggle.querySelector('code')!
    expect(code.textContent).toBe(`$ ${summary}`)
    expect(step.querySelector('[data-ui="step-command"]')).toBeNull()
    expect(step.querySelector('[data-ui="step-output"]')).toBeNull()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(step.querySelector('[data-ui="step-command"]')?.textContent).toBe(rawCommand)
    expect(step.querySelector('[data-ui="step-output"]')?.textContent).toBe('PASS 14 test files')

    // Verify CSS structural containment rules preventing icon overlap and left/right overflow.
    const viewCss = readCss('src/components/Threads/ThreadView.css')
    const stepLine = viewCss.match(/\.thread-step-line\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(stepLine).toMatch(/overflow:\s*hidden/)
    expect(stepLine).toMatch(/min-width:\s*0/)
    expect(stepLine).toMatch(/max-width:\s*100%/)

    const signalTrack = viewCss.match(/\.thread-step-signal\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(signalTrack).toMatch(/flex:\s*0 0 var\(--space-4\)/)

    const stepToggle = viewCss.match(/\.thread-step-toggle\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(stepToggle).toMatch(/justify-content:\s*flex-start/)
    expect(stepToggle).toMatch(/min-width:\s*0/)
    expect(stepToggle).toMatch(/max-width:\s*100%/)
    expect(stepToggle).toMatch(/overflow:\s*hidden/)
    expect(stepToggle).toMatch(/text-overflow:\s*ellipsis/)

    const stepCode = viewCss.match(/\.thread-step-toggle\s*>\s*code\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(stepCode).toMatch(/overflow:\s*hidden/)
    expect(stepCode).toMatch(/text-overflow:\s*ellipsis/)
    expect(stepCode).toMatch(/white-space:\s*nowrap/)
  })

  it('hides raw provider telemetry in normal mode while preserving diagnostic telemetry in verbose mode', () => {
    const now = Date.now()
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 't-live',
        workspaceId: 'ws',
        projectId: 'p1',
        rootPath: '/repo',
        provider: 'claude',
        title: 'Live task',
        pinned: false,
        status: 'running',
        nativeSessionId: 'native-1',
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
        connection: { state: 'connected', attempt: 0, changedAt: now - 5_000, lastNativeSignalAt: now - 2_000 }
      },
      turns: [{ id: 'turn-1', sequence: 1, status: 'running', startedAt: now - 5_000, configuration: {} }],
      events: [
        { type: 'message', id: 'u1', role: 'user', text: 'Run checks' },
        { type: 'tool', id: 'tool-1', name: 'Bash', state: 'running', detail: 'npm test', startedAt: now - 3_000 }
      ]
    } as unknown as ThreadSnapshot

    // Normal mode: calm 1-line Working indicator, zero raw provider signal telemetry.
    useThreadViewModeStore.setState({ mode: 'normal' })
    const { rerender } = render(<ThreadLiveActivity snapshot={snapshot} />)
    const normalBanner = document.querySelector<HTMLElement>('[data-ui="live-activity"]')!
    expect(normalBanner).not.toBeNull()
    expect(normalBanner.getAttribute('data-mode')).toBe('normal')
    expect(within(normalBanner).getByRole('status').textContent).toContain('Working · Running a command')
    expect(normalBanner.textContent).not.toContain('Last provider signal')
    expect(normalBanner.textContent).not.toContain('Turn ·')

    // Even when stale (>60s silent), normal mode still suppresses raw provider signal telemetry.
    const staleSnapshot: ThreadSnapshot = {
      ...snapshot,
      thread: {
        ...snapshot.thread,
        connection: { state: 'connected', attempt: 0, changedAt: now - 75_000, lastNativeSignalAt: now - 70_000 }
      },
      turns: [{ id: 'turn-1', sequence: 1, status: 'running', startedAt: now - 75_000, configuration: {} }]
    } as unknown as ThreadSnapshot
    rerender(<ThreadLiveActivity snapshot={staleSnapshot} />)
    expect(document.querySelector('[data-ui="live-activity"]')?.textContent).not.toContain('Last provider signal')

    // Verbose mode: preserves diagnostic telemetry as expected by E2E.
    act(() => {
      useThreadViewModeStore.setState({ mode: 'verbose' })
    })
    rerender(<ThreadLiveActivity snapshot={snapshot} />)
    const verboseBanner = document.querySelector<HTMLElement>('[data-ui="live-activity"]')!
    expect(verboseBanner.getAttribute('data-mode')).toBe('verbose')
    expect(verboseBanner.textContent).toContain('Last provider signal')
    expect(verboseBanner.textContent).toContain('Turn ·')
    expect(within(verboseBanner).getByRole('status').textContent).toContain('Running command: npm test')
  })

  it('keeps Obsidian Minimal hairline rules across turn fold, tool rows, and subagent result cards', () => {
    render(<ThreadTurnFoldRow fold={{ type: 'turn-fold', id: 'f1', steps: 4, expanded: false }} onToggle={vi.fn()} />)
    const fold = screen.getByTestId('thread-turn-fold')
    expect(fold).toHaveAttribute('data-ui', 'turn-line')
    expect(fold.textContent?.trim()).toBe('4 actions')

    const subagentCss = readCss('src/components/Threads/SubagentResultCard.module.css')
    const cardRule = subagentCss.match(/\.card\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(cardRule).toMatch(/background:\s*var\(--surface-chrome\)/)
    expect(cardRule).toMatch(/border:\s*1px solid var\(--bd-subtle\)/)
    expect(cardRule).toMatch(/box-shadow:\s*none/)

    const toolRowCss = readCss('src/components/Threads/ToolRowView.module.css')
    const rowRule = toolRowCss.match(/\.wrap \.row\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(rowRule).toMatch(/justify-content:\s*flex-start/)
    expect(rowRule).toMatch(/min-width:\s*0/)
    expect(rowRule).toMatch(/overflow:\s*hidden/)
  })
})
