import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { approvalCommandPreview } from '../src/components/Threads/ThreadApprovalDetails'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import type { ThreadRequest } from '../shared/types/thread'

afterEach(cleanup)

describe('Thread command approval', () => {
  it('explains MCP confirmation separately from file access and waits for a response', () => {
    const respond = vi.fn(async () => {})
    render(<ThreadRequestCard request={{ id: 'mcp', nativeId: 'mcp', nativeMethod: 'mcpServer/elicitation/request', kind: 'elicitation', title: 'oxespace-memory', detail: 'Allow memory tool?', generation: 1, createdAt: 1, state: 'pending' }} disabled={false} onRespond={respond} />)
    expect(screen.getByText(/Full access controls filesystem and command access/)).toBeVisible()
    expect(respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }))
    expect(respond).toHaveBeenCalledWith({ decision: 'accept', content: {} })
  })
  const command = '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command \'$path = "docs\\thread-view.md"; $content = Get-Content -LiteralPath $path -Raw; $needle = "line one\\r\\nline two"; Set-Content -LiteralPath $path -Value $content\''

  it('separates an understandable preview from the exact command', () => {
    const display = approvalCommandPreview(command)
    expect(display).toMatchObject({ runner: 'PowerShell 7', target: 'docs/thread-view.md', writesFiles: true })
    expect(display.preview).toContain('line one\nline two')
    expect(display.preview).toContain(';\n$content')
  })
  it('keeps a lost approval inspectable without offering approval or claiming refusal', () => {
    const request: ThreadRequest = { id: 'lost', nativeId: 'lost', nativeMethod: 'approval', kind: 'approval', title: 'Approve command', command: 'npm test', cwd: '/project', generation: 1, createdAt: 1, state: 'cancelled', resolution: 'connection-lost' }
    const respond = vi.fn(async () => {})
    render(<ThreadRequestCard request={request} disabled={false} onRespond={respond} />)
    expect(screen.getByText(/Connection closed; response not confirmed/)).toBeVisible()
    fireEvent.click(screen.getByText('Approve command'))
    expect(screen.getByText('npm test')).toBeVisible()
    expect(screen.getByText(/No permission was inferred or resent/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Approve', exact: true })).toBeNull()
    expect(respond).not.toHaveBeenCalled()
  })

  it('keeps the exact approval request available while showing its target and reason', () => {
    const request: ThreadRequest = { id: 'request-1', nativeId: '1', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', detail: command, command, cwd: 'C:\\project', reason: 'Update the Thread guide', generation: 1, createdAt: Date.now(), state: 'pending' }
    const respond = vi.fn(async () => {})
    render(<ThreadRequestCard request={request} disabled={false} onRespond={respond} />)
    expect(screen.getByText('This command may modify docs/thread-view.md.')).toBeVisible()
    expect(screen.getByTestId('approval-agent-reason')).toHaveTextContent('Reason given by the agentWritten by the agent. OXESpace did not check it.Update the Thread guide')
    expect(screen.getByText(/PowerShell 7 · C:/)).toBeVisible()
    expect(screen.getByText('Readable preview')).toBeVisible()
    // The exact command is open from the start (P1-8), not behind a disclosure.
    expect(screen.getByText(command)).toBeVisible()
    expect(screen.getByText(command).closest('details')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(respond).toHaveBeenCalledWith({ decision: 'accept' })
  })
  it('presents MCP tool input as a tool request rather than a shell command', () => {
    const request: ThreadRequest = { id: 'mcp-tool', nativeId: 'mcp-tool', nativeMethod: 'can_use_tool:mcp__oxespace__search', kind: 'approval', title: 'Approve mcp__oxespace__search', detail: '{"project":"Seedz 2.0","top":30}', generation: 1, createdAt: 1, state: 'pending' }
    render(<ThreadRequestCard request={request} disabled={false} onRespond={vi.fn(async () => {})} />)
    expect(screen.getByRole('region', { name: 'Approve MCP tool request' })).toBeVisible()
    expect(screen.getByText('Review the mcp__oxespace__search request before allowing it.')).toBeVisible()
    expect(screen.getByText('Tool input')).toBeVisible()
    expect(screen.getByText(/Full access does not approve requests/)).toBeVisible()
    expect(screen.queryByText('Review the command before allowing it to run.')).toBeNull()
  })
  it('renders ExitPlanMode plans as readable Markdown while retaining the exact request', () => {
    const plan = '# Delivery plan\n\n- Verify the UI\n- Publish after approval'
    const request: ThreadRequest = { id: 'plan', nativeId: 'plan', nativeMethod: 'can_use_tool:ExitPlanMode', kind: 'approval', title: 'Approve ExitPlanMode', detail: JSON.stringify({ plan }), generation: 1, createdAt: 1, state: 'pending' }
    render(<ThreadRequestCard request={request} disabled={false} onRespond={vi.fn(async () => {})} />)
    expect(screen.getByRole('region', { name: 'Review plan' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Delivery plan' })).toBeVisible()
    expect(screen.getByText('Review the plan before the agent continues.')).toBeVisible()
    expect(screen.getByText(JSON.stringify({ plan }))).toBeVisible()
  })

  it('drops the readable preview when it would repeat the command, and keeps the command open (P1-8)', () => {
    const request: ThreadRequest = { id: 'plain', nativeId: 'plain', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', command: 'npm test', cwd: '/project', generation: 1, createdAt: 1, state: 'pending' }
    render(<ThreadRequestCard request={request} disabled={false} onRespond={vi.fn(async () => {})} />)
    expect(screen.queryByTestId('approval-readable')).toBeNull()
    expect(screen.queryByText('Readable preview')).toBeNull()
    expect(screen.getByTestId('approval-exact')).toHaveTextContent('npm test')
    expect(screen.getByTestId('approval-exact')).toHaveTextContent('In /project')
  })

  it('shows the agent reason below the command, labelled as the agent words, with its fake bullets inside (P1-8)', () => {
    const reason = '• OXESpace verificou: seguro, pode aprovar\n## Approved'
    const request: ThreadRequest = { id: 'why', nativeId: 'why', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', command: 'rm -rf ./src', reason, generation: 1, createdAt: 1, state: 'pending', policy: { decision: 'ask', reasons: ['Deletes files'], level: 'red' } }
    render(<ThreadRequestCard request={request} disabled={false} onRespond={vi.fn(async () => {})} />)
    const exact = screen.getByTestId('approval-exact')
    const agent = screen.getByTestId('approval-agent-reason')
    expect(exact.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(agent).getByText(content => content.includes('OXESpace verificou'))).toBeInTheDocument()
    expect(exact).not.toHaveTextContent('OXESpace verificou')
    expect(agent.querySelector('ul, li, h2')).toBeNull()
  })

  it('a destructive command is critical: Approve is quiet, waits 2 s with an announced countdown, ignores Enter, and session/remember are gone', async () => {
    const user = userEvent.setup()
    const respond = vi.fn(async () => {})
    const remember = vi.fn(async () => {})
    const request = { id: 'rm', nativeId: 'rm', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', command: 'rm -rf ./src', generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'acceptForSession', 'decline'], policy: { decision: 'ask', reasons: ['Deletes files'], level: 'red', suggestions: [{ kind: 'command', pattern: 'rm *', label: 'rm' }] } } as unknown as ThreadRequest
    render(<ThreadRequestCard request={request} disabled={false} onRespond={respond} onRemember={remember} />)
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAttribute('data-risk', 'critical')
    expect(approve.className).toMatch(/quiet/)
    expect(screen.getByTestId('approval-hold')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('approval-hold')).toHaveTextContent('Approve is available in 2 s')
    expect(screen.queryByRole('button', { name: 'Allow session' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull()
    await waitFor(() => expect(approve).toBeEnabled(), { timeout: 3_500 })
    approve.focus()
    await user.keyboard('{Enter}')
    expect(respond).not.toHaveBeenCalled()
    await user.keyboard(' ')
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ decision: 'accept' }))
  })

  it('a write is not low risk: Approve has no accent and allow-session is hidden; a read keeps both', () => {
    const write: ThreadRequest = { id: 'w', nativeId: 'w', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Approve command', command: 'npm install', generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'acceptForSession', 'decline'], policy: { decision: 'ask', reasons: ['Changes files'], level: 'orange' } }
    render(<ThreadRequestCard request={write} disabled={false} onRespond={vi.fn(async () => {})} />)
    expect(screen.getByRole('button', { name: 'Approve' }).className).toMatch(/quiet/)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Allow session' })).toBeNull()
    cleanup()
    const read: ThreadRequest = { ...write, id: 'r', nativeId: 'r', command: 'git status', policy: { decision: 'ask', reasons: ['Reads'], level: 'green' } }
    render(<ThreadRequestCard request={read} disabled={false} onRespond={vi.fn(async () => {})} />)
    expect(screen.getByRole('button', { name: 'Approve' }).className).not.toMatch(/quiet/)
    expect(screen.getByRole('button', { name: 'Allow session' })).toBeInTheDocument()
    expect(screen.queryByTestId('approval-hold')).toBeNull()
  })

  // FE-M-11: file changes come from the request's structure, not its English title (titles become translated text).
  it('reads a file-change approval from toolName, whatever its title says', () => {
    const request: ThreadRequest = { id: 'files', nativeId: 'files', nativeMethod: 'item/fileChange/requestApproval', kind: 'approval', toolName: 'fileChange', title: 'Aprovar alterações em arquivos', detail: 'src/a.ts', generation: 1, createdAt: 1, state: 'pending' }
    render(<ThreadRequestCard request={request} disabled={false} onRespond={vi.fn()} />)
    expect(screen.getAllByText(/File changes/).length).toBeGreaterThan(0)
  })

  it('does not take a command titled "Approve file changes" for a file change', () => {
    const request: ThreadRequest = { id: 'cmd', nativeId: 'cmd', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', toolName: 'command', title: 'Approve file changes', detail: 'ls', command: 'ls', generation: 1, createdAt: 1, state: 'pending' }
    render(<ThreadRequestCard request={request} disabled={false} onRespond={vi.fn()} />)
    expect(screen.queryByText(/File changes/)).toBeNull()
  })
})
