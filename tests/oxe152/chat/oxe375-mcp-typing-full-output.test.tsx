import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { OXESPACE_MCP_TOOLS, oxespaceToolLabel } from '../../../shared/oxespace-mcp-tools'
import { classifyToolRowKind, toolRow, type ToolRowKind } from '../../../shared/thread-tool-rows'
import { threadToolSummary } from '../../../shared/threadToolSummary'
import type { ThreadEvent } from '../../../shared/types/thread'
import { ThreadActivityGroup } from '../../../src/components/Threads/ThreadActivityGroup'
import { changeLanguage } from '../../../src/i18n'
import { TOOL_OUTPUT_CUT_BYTES, useToolOutputCuts } from '../../../src/store/tool-output-cut.store'

type Tool = Extract<ThreadEvent, { type: 'tool' }>

const toolEvent = (id: string, name: string, over: Partial<Tool> = {}): Tool => ({
  type: 'tool',
  id,
  name,
  state: 'completed',
  detail: '',
  startedAt: 1_000,
  completedAt: 1_200,
  ...over
})

afterEach(async () => {
  cleanup()
  useToolOutputCuts.setState({ cuts: {} })
  await changeLanguage('en')
})

describe('OXE-375 · rich classification & summaries for internal OXESpace MCP tools', () => {
  test('classifies every internal OXESpace MCP tool family into semantic kinds', () => {
    const cases: Array<[string, ToolRowKind]> = [
      // Preview & HTTP & GitHub
      ['mcp__oxespace__oxespace_open_web_preview', 'http'],
      ['mcp__oxespace__oxespace_capture_web_preview', 'http'],
      ['mcp__oxespace__oxespace_preview_interact', 'http'],
      ['mcp__oxespace__oxespace_github', 'http'],
      ['mcp__oxespace__oxespace_github_change', 'http'],
      ['mcp__oxespace__oxespace_http_request', 'http'],
      // Git
      ['mcp__oxespace__oxespace_git', 'read'],
      ['mcp__oxespace__oxespace_git_change', 'edit'],
      // Quality & Orchestration
      ['mcp__oxespace__oxespace_quality_check', 'run'],
      ['mcp__oxespace__oxespace_run_script', 'run'],
      ['mcp__oxespace__oxespace_delegate_task', 'run'],
      ['mcp__oxespace__oxespace_work_plan', 'run'],
      ['mcp__oxespace__oxespace_delegation_status', 'read'],
      ['mcp__oxespace__oxespace_work_result', 'read'],
      // Android
      ['mcp__oxespace__oxespace_device_screenshot', 'read'],
      // OxeQuery
      ['mcp__oxespace__oxespace_db_query', 'query'],
      ['mcp__oxespace__oxespace_db_describe', 'query'],
      ['mcp__oxespace__oxespace_mongo_find', 'query'],
      // Threads
      ['mcp__oxespace__oxespace_threads', 'read'],
      ['mcp__oxespace__oxespace_thread_read', 'read'],
      ['mcp__oxespace__oxespace_thread_create', 'run'],
      ['mcp__oxespace__oxespace_thread_send', 'run'],
      ['mcp__oxespace__oxespace_threads_change', 'edit'],
      // Containers
      ['mcp__oxespace__oxespace_containers_list', 'container'],
      ['mcp__oxespace__oxespace_container_logs', 'container'],
      ['mcp__oxespace__oxespace_container_action', 'container'],
      // Workspace
      ['mcp__oxespace__oxespace_project_context', 'read'],
      ['mcp__oxespace__oxespace_search', 'read'],
      ['mcp__oxespace__oxespace_diagnostics', 'read'],
      ['mcp__oxespace__oxespace_workspace_change', 'edit'],
      ['mcp__oxespace__oxespace_create_worktree', 'edit'],
      // External MCP stays other
      ['mcp__github__create_issue', 'other']
    ]

    for (const [name, expected] of cases) {
      expect(classifyToolRowKind(name), name).toBe(expected)
    }
    expect(Object.keys(OXESPACE_MCP_TOOLS).length).toBeGreaterThanOrEqual(40)
  })

  test('produces clean human-readable targets and summaries instead of raw mcp__oxespace__ slugs', () => {
    const preview = toolRow(
      toolEvent('p1', 'mcp__oxespace__oxespace_open_web_preview', { detail: JSON.stringify({ url: 'http://localhost:5173/dashboard' }) }),
      '/repo'
    )
    expect(preview.kind).toBe('http')
    expect(preview.target).toBe('Open web preview · http://localhost:5173/dashboard')

    const gitDiff = toolRow(
      toolEvent('g1', 'mcp__oxespace__oxespace_git', { detail: JSON.stringify({ action: 'diff', path: '/repo/src/app.ts' }) }),
      '/repo'
    )
    expect(gitDiff.kind).toBe('read')
    expect(gitDiff.target).toBe('Git · diff src/app.ts')

    const emptyDetail = toolRow(
      toolEvent('c1', 'mcp__oxespace__oxespace_capture_web_preview', { detail: '{}' }),
      '/repo'
    )
    expect(emptyDetail.target).toBe('Capture web preview')
    expect(emptyDetail.target).not.toContain('mcp__oxespace')

    expect(threadToolSummary({
      name: 'mcp__oxespace__oxespace_quality_check',
      detail: JSON.stringify({ scope: 'workspace' })
    })).toBe('Quality check · workspace')

    expect(threadToolSummary({
      name: 'mcp__oxespace__oxespace_project_context',
      detail: '{}'
    })).toBe('Project context')

    expect(oxespaceToolLabel('mcp__oxespace__oxespace_future_inspector')).toBe('Future inspector')
  })

  test('renders internal MCP steps in normal mode with readable headlines and no raw slugs', async () => {
    const events: Tool[] = [
      toolEvent('t1', 'mcp__oxespace__oxespace_open_web_preview', {
        detail: JSON.stringify({ url: 'http://localhost:5173' }),
        output: 'HTTP/1.1 200 OK\nPreview ready'
      }),
      toolEvent('t2', 'mcp__oxespace__oxespace_quality_check', {
        detail: JSON.stringify({ scope: 'changed' }),
        output: 'All checks passed'
      }),
      toolEvent('t3', 'mcp__oxespace__oxespace_container_logs', {
        detail: JSON.stringify({ container: 'postgres' }),
        output: 'database system is ready'
      })
    ]

    render(<ThreadActivityGroup events={events} mode="normal" rootPath="/repo" />)
    expect(document.body.textContent).not.toContain('mcp__oxespace__')
    expect(screen.getByRole('button', { name: /Open web preview · http:\/\/localhost:5173 200 OK/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quality check · changed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Container logs · postgres' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Container logs · postgres' }))
    expect(screen.getByText('database system is ready')).toBeInTheDocument()
  })
})

describe('OXE-375 · Open full output button when truncated at 32 KB', () => {
  const TAIL_MARKER = 'END_OF_FULL_OUTPUT_MARKER_OXE375'
  const BIG_OUTPUT = `${'A'.repeat(TOOL_OUTPUT_CUT_BYTES + 2048)}\n${TAIL_MARKER}`

  test.each(['en', 'pt-BR'] as const)('(%s) shows Open full output button in normal mode and opens dialog with untruncated output', async (locale) => {
    await changeLanguage(locale)
    const event = toolEvent('run-32k', 'Bash', {
      detail: JSON.stringify({ command: 'pnpm test' }),
      output: BIG_OUTPUT
    })

    render(<ThreadActivityGroup events={[event]} mode="normal" rootPath="/repo" />)

    // Open the step row
    await userEvent.click(screen.getByRole('button', { name: /pnpm test/ }))

    // Initially truncated to 32 KB — marker past 32 KB is not visible in the inline preview
    expect(screen.queryByText(TAIL_MARKER, { exact: false })).toBeNull()

    const openBtnLabel = locale === 'en' ? 'Open full output' : 'Abrir output completo'
    const openBtn = screen.getByRole('button', { name: openBtnLabel })
    expect(openBtn).toBeInTheDocument()

    await userEvent.click(openBtn)

    const dialog = await screen.findByRole('dialog')
    const fullPre = dialog.querySelector('[data-ui="full-output"]')
    expect(fullPre).toBeTruthy()
    expect(fullPre?.textContent).toContain(TAIL_MARKER)
    expect(fullPre?.textContent?.length).toBe(BIG_OUTPUT.length)

    const closeLabel = locale === 'en' ? 'Close' : 'Fechar'
    await userEvent.click(within(dialog).getAllByRole('button', { name: closeLabel })[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('shows Open full output button in verbose mode when a cut is recorded in useToolOutputCuts', async () => {
    useToolOutputCuts.getState().recordCut('diag-cut', {
      truncated: true,
      keptBytes: 4096,
      totalBytes: BIG_OUTPUT.length
    })
    const event = toolEvent('diag-cut', 'mcp__oxespace__oxespace_diagnostics', {
      detail: JSON.stringify({ scope: 'project' }),
      output: BIG_OUTPUT
    })

    render(<ThreadActivityGroup events={[event]} mode="verbose" rootPath="/repo" />)
    expect(document.body.textContent).toContain('Diagnostics')
    expect(document.body.textContent).not.toContain('mcp__oxespace__')

    const openBtn = screen.getByRole('button', { name: 'Open full output' })
    await userEvent.click(openBtn)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('[data-ui="full-output"]')?.textContent).toContain(TAIL_MARKER)
  })
})
