import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportProblem } from '../src/components/Diagnostics/ReportProblem'
import { ISSUE_NEW_URL, ISSUE_URL_MAX, buildIssueUrl, issueClipboardText } from '../shared/issue-report'

const REPORT = { title: '[Bug] ', diagnosticLines: 3, body: '## What happened\n\n## Environment\n\n- OXESpace: 1.4.0\n- System: Windows 11 10.0 (win32 x64)\n' }

function install(build: () => Promise<typeof REPORT>): { writeText: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(async () => true)
  const open = vi.fn()
  vi.stubGlobal('open', open)
  ;(window as unknown as { oxe: unknown }).oxe = { diagnostics: { buildIssueReport: vi.fn(build) }, clipboard: { writeText } }
  return { writeText, open }
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { oxe?: unknown }).oxe })

describe('Report a problem dialog', () => {
  it('shows the report for review and sends nothing until a button is clicked', async () => {
    const { open, writeText } = install(async () => REPORT)
    render(<ReportProblem onClose={() => undefined} />)
    const body = await screen.findByLabelText('Report')
    expect((body as HTMLTextAreaElement).value).toContain('- OXESpace: 1.4.0')
    expect(open).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('opens the issue page with the edited title and text only on click, then closes', async () => {
    const { open } = install(async () => REPORT)
    const onClose = vi.fn()
    render(<ReportProblem onClose={onClose} />)
    const title = await screen.findByLabelText('Title')
    // An empty title cannot be opened.
    await userEvent.clear(title)
    expect(screen.getByRole('button', { name: 'Open on GitHub' })).toBeDisabled()
    await userEvent.type(title, 'Crash on start')
    await userEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    expect(open).toHaveBeenCalledTimes(1)
    const [url, target] = open.mock.calls[0] as [string, string]
    expect(target).toBe('_blank')
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe(ISSUE_NEW_URL)
    expect(parsed.searchParams.get('title')).toBe('Crash on start')
    expect(parsed.searchParams.get('body')).toBe(REPORT.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('copies the title and text on request without opening anything', async () => {
    const { open, writeText } = install(async () => REPORT)
    render(<ReportProblem onClose={() => undefined} />)
    await screen.findByLabelText('Report')
    await userEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    expect(writeText).toHaveBeenCalledWith(issueClipboardText({ title: REPORT.title, body: REPORT.body }))
    expect(open).not.toHaveBeenCalled()
  })

  it('says so when the report cannot be prepared and lets the person try again', async () => {
    let calls = 0
    install(async () => { if (++calls === 1) throw new Error('boom'); return REPORT })
    render(<ReportProblem onClose={() => undefined} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The report could not be prepared.')
    expect(screen.getByRole('button', { name: 'Open on GitHub' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByLabelText('Report')).toBeInTheDocument())
  })

  it('warns when the text is too long for a link', async () => {
    install(async () => ({ ...REPORT, body: 'x'.repeat(ISSUE_URL_MAX * 2) }))
    render(<ReportProblem onClose={() => undefined} />)
    expect(await screen.findByRole('note')).toHaveTextContent('too long for a link')
  })
})

describe('issue link', () => {
  it('encodes a short report whole', () => {
    const link = buildIssueUrl({ title: 'A & B', body: 'line 1\nline 2 #3' })
    expect(link.truncated).toBe(false)
    const parsed = new URL(link.url)
    expect(parsed.searchParams.get('title')).toBe('A & B')
    expect(parsed.searchParams.get('body')).toBe('line 1\nline 2 #3')
  })

  it('cuts a long body to fit, never splits an emoji, and says it was cut', () => {
    const link = buildIssueUrl({ title: 'Long', body: '🚀'.repeat(5_000) })
    expect(link.truncated).toBe(true)
    expect(link.url.length).toBeLessThanOrEqual(ISSUE_URL_MAX)
    const body = new URL(link.url).searchParams.get('body')!
    expect(body).toContain('text cut to fit the link')
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})
