// Frozen acceptance test for OXE-360 A2 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// The Pull request tab's links leave through openExternalLink: a host never opened before is asked about first, and a
// work item is an ExternalAnchor (rel="noopener noreferrer"). The install help is OXESpace's own fixed link.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PullRequestTab } from '../../../src/components/Threads/PullRequestTab'
import { SEEN_HOSTS_KEY } from '../../../src/lib/externalLinks'

const WORK_ITEM = 'https://xn--dv-azure-c4a.example/edit/77'
const PR_URL = 'https://code.unseen.example/pull/321'
const original = window.oxe
let open: ReturnType<typeof vi.fn<(url: string) => Promise<{ opened: boolean }>>>

function mount(state: Record<string, unknown>): void {
  window.oxe = {
    ...original,
    pullRequest: { state: async () => state },
    thread: { agentSummary: async () => null },
    app: { platform: 'win32', openExternal: open }
  } as unknown as typeof window.oxe
  render(<PullRequestTab threadId="t-1" rootPath="/repo" branch="agent-fix" />)
}
const withPullRequest = (): void => mount({
  provider: 'azure', cli: 'ok',
  pr: { number: 321, title: 'Fix', state: 'open', draft: false, head: 'agent-fix', base: 'main', url: PR_URL, workItems: [{ id: 77, url: WORK_ITEM }], checks: [], reviewers: [] }
})

beforeEach(() => { localStorage.clear(); open = vi.fn(async (_url: string) => ({ opened: true })) })
afterEach(async () => {
  for (const button of screen.queryAllByRole('button', { name: 'Cancel' })) fireEvent.click(button)
  cleanup()
  window.oxe = original
  await new Promise(resolve => setTimeout(resolve, 0))
})

describe('OXE-360 · the Pull request tab opens links the app\'s one way', () => {
  it('the pull request tab asks before opening an unseen host', async () => {
    withPullRequest()
    fireEvent.click(await screen.findByRole('button', { name: /^Open/ }))
    expect(open).not.toHaveBeenCalled()
    expect(await screen.findByTestId('external-link-dialog', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
  }, 20_000)

  it('a work item link is an external anchor that asks before opening', async () => {
    withPullRequest()
    const link = await screen.findByRole('link', { name: /AB#77/ })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(link)
    expect(open).not.toHaveBeenCalled()
    expect(await screen.findByTestId('external-link-dialog', {}, { timeout: 10_000 })).toBeInTheDocument()
  }, 20_000)

  it('the pull request tab refuses a link that carries credentials', async () => {
    localStorage.setItem(SEEN_HOSTS_KEY, JSON.stringify(['code.unseen.example']))
    mount({ provider: 'github', cli: 'ok', pr: { number: 9, title: 'Fix', state: 'open', draft: false, head: 'a', base: 'main', url: 'https://user:pw@code.unseen.example/pull/9', workItems: [], checks: [], reviewers: [] } })
    fireEvent.click(await screen.findByRole('button', { name: /^Open/ }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(open).not.toHaveBeenCalled()
  })

  it('the install help opens without a question', async () => {
    mount({ provider: 'github', cli: 'missing', pr: null })
    fireEvent.click(await screen.findByRole('button', { name: /install/i }))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('external-link-dialog')).toBeNull()
  })
})
