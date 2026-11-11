// Frozen acceptance test for 1.5.0 A60 and A62 on screen (DESIGN U4.6, OXE program, phase F4, task FE-P9). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f4-design.md (U4.6 and its 08/11
// update). Contract (BACKEND #704, ccr-f4-places-pr.md §A60, §A62): window.oxe.pullRequest.state({ rootPath, branch }) →
// { provider: 'github'|'azure'|'none', cli: 'ok'|'missing'|'signed-out', pr?: { number, title, state, draft, head, base, url,
// workItems[{ id, url }], checks[{ name, state, duration }], reviewers[{ name, vote }] } | null }, and
// window.oxe.thread.agentSummary(threadId) → { files, databases, http, httpProduction, containers, approvals, failedSources }.
// The tab is PullRequestTab({ threadId, rootPath, branch }) in src/components/Threads/PullRequestTab.tsx.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Tab = { PullRequestTab: (props: { threadId: string; rootPath: string; branch: string }) => JSX.Element }
const PR = {
  github: { number: 321, title: 'Fix the checkout total', state: 'open', draft: false, head: 'agent-fix', base: 'main', url: 'https://github.com/o/r/pull/321', workItems: [],
    checks: [{ name: 'ci / unit', state: 'pass', duration: 84 }, { name: 'ci / e2e', state: 'running', duration: null }, { name: 'lint', state: 'skipped', duration: null }],
    reviewers: [{ name: 'ana', vote: 'approved' }, { name: 'bruno', vote: 'changes-requested' }, { name: 'carla', vote: 'commented' }] },
  azure: { number: 4521, title: 'Fix the checkout total', state: 'open', draft: false, head: 'agent-fix', base: 'main', url: 'https://dev.azure.com/o/p/_git/r/pullrequest/4521', workItems: [{ id: 77, url: 'https://dev.azure.com/o/_workitems/edit/77' }],
    checks: [{ name: 'Build validation', state: 'pass', duration: 120 }, { name: 'Required reviewers', state: 'fail', duration: null }, { name: 'Work item linking', state: 'skipped', duration: null }],
    reviewers: [{ name: 'ana', vote: 'approved-with-suggestions' }, { name: 'bruno', vote: 'waiting-for-author' }, { name: 'carla', vote: 'rejected' }, { name: 'davi', vote: 'no-vote' }] }
}
const SUMMARY = { files: 4, databases: 2, http: 3, httpProduction: 1, containers: 0, approvals: 1, failedSources: [] }

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
function mockMain(state: Record<string, unknown>, summary: Record<string, unknown> = SUMMARY) {
  const api = { state: vi.fn(async () => state) }
  const thread = { agentSummary: vi.fn(async () => summary) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, pullRequest: api, thread, app: { platform: 'win32', openExternal: vi.fn(async () => undefined) } } })
  return { api, thread }
}
async function renderTab() {
  const { PullRequestTab } = await load<Tab>('src/components/Threads/PullRequestTab')
  render(<PullRequestTab threadId="t-1" rootPath="/repo" branch="agent-fix" />)
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U4.6 · the Pull request tab, GitHub and Azure DevOps', () => {
  test("GitHub's words: #321, Checks, its votes, Open on GitHub, and skipped checks shown apart", async () => {
    const { api } = mockMain({ provider: 'github', cli: 'ok', pr: PR.github })
    await renderTab()
    expect(await screen.findByText('#321')).toBeInTheDocument()
    expect(api.state).toHaveBeenCalledWith({ rootPath: '/repo', branch: 'agent-fix' })
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Checks' })).toBeInTheDocument()
    for (const vote of ['Approved', 'Changes requested', 'Commented']) expect(screen.getByText(vote)).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 passed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open on GitHub' })).toBeInTheDocument()
  })

  test("Azure DevOps' words: !4521, Pipelines and policies, its votes, the work item and Open in Azure DevOps", async () => {
    mockMain({ provider: 'azure', cli: 'ok', pr: PR.azure })
    await renderTab()
    expect(await screen.findByText('!4521')).toBeInTheDocument()
    expect(screen.getByText('Azure DevOps')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pipelines and policies' })).toBeInTheDocument()
    for (const vote of ['Approved with suggestions', 'Waiting for author', 'Rejected', 'No vote']) expect(screen.getByText(vote)).toBeInTheDocument()
    expect(screen.getByText('Not applicable')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /AB#77/ })).toHaveAttribute('href', 'https://dev.azure.com/o/_workitems/edit/77')
    expect(screen.getByRole('button', { name: 'Open in Azure DevOps' })).toBeInTheDocument()
  })

  test('the PR states read per provider: Draft, Merged or Completed, Closed or Abandoned', async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['github', { ...PR.github, draft: true }, 'Draft'], ['github', { ...PR.github, state: 'merged' }, 'Merged'], ['github', { ...PR.github, state: 'closed' }, 'Closed'],
      ['azure', { ...PR.azure, state: 'merged' }, 'Completed'], ['azure', { ...PR.azure, state: 'closed' }, 'Abandoned']
    ]
    for (const [provider, pr, word] of cases) {
      mockMain({ provider, cli: 'ok', pr })
      await renderTab()
      expect(await screen.findByText(word)).toBeInTheDocument()
      cleanup()
    }
  })

  test('no CLI and signed out keep the tab, with each provider’s words', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['github', 'missing', /Install the GitHub CLI/], ['azure', 'missing', /Install the Azure CLI/],
      ['github', 'signed-out', /Sign in with gh auth login/], ['azure', 'signed-out', /Sign in with az login/]
    ]
    for (const [provider, cli, words] of cases) {
      mockMain({ provider, cli, pr: null })
      await renderTab()
      expect(await screen.findByText(words)).toBeInTheDocument()
      if (cli === 'signed-out') expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument()
      else expect(screen.getByRole('button', { name: 'How to install' })).toBeInTheDocument()
      cleanup()
    }
  })

  test('another remote offers only the push, with the reason', async () => {
    mockMain({ provider: 'none', cli: 'ok', pr: null })
    await renderTab()
    expect(await screen.findByText("Pull requests for this remote aren't supported.")).toBeInTheDocument()
    expect(screen.queryByText(/Checks|Pipelines and policies/)).toBeNull()
  })

  test('What the agent did shows main’s counts without zeros, and Add to description appends once and undoes', async () => {
    const { thread } = mockMain({ provider: 'github', cli: 'ok', pr: null })
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<Toaster />)
    await renderTab()
    await waitFor(() => expect(thread.agentSummary).toHaveBeenCalledWith('t-1'))
    const section = (await screen.findByRole('heading', { name: 'What the agent did' })).closest('section') as HTMLElement
    expect(within(section).getByText(/4 files/)).toBeInTheDocument()
    expect(within(section).getByText(/1 to production/)).toBeInTheDocument()
    expect(within(section).queryByText(/containers?/i)).toBeNull()
    const description = screen.getByRole('textbox', { name: /Description/ }) as HTMLTextAreaElement
    const before = description.value
    await userEvent.click(within(section).getByRole('button', { name: 'Add to description' }))
    const added = description.value
    expect(added.length).toBeGreaterThan(before.length)
    expect(added).toMatch(/4 files/)
    await userEvent.click(within(section).getByRole('button', { name: 'Add to description' }))
    expect(description.value).toBe(added)
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(description.value).toBe(before))
  })

  test('Merge or Complete is never enabled in the tab', async () => {
    for (const provider of ['github', 'azure'] as const) {
      mockMain({ provider, cli: 'ok', pr: { ...PR[provider], checks: PR[provider].checks.map(check => ({ ...check, state: 'pass' })) } })
      await renderTab()
      const merge = await screen.findByRole('button', { name: provider === 'github' ? 'Merge' : 'Complete' })
      expect(merge).toBeDisabled()
      cleanup()
    }
  })

  test('a summary source main could not read leaves one muted line under the list', async () => {
    mockMain({ provider: 'github', cli: 'ok', pr: null }, { ...SUMMARY, databases: null, failedSources: ['databases'] })
    await renderTab()
    const section = (await screen.findByRole('heading', { name: 'What the agent did' })).closest('section') as HTMLElement
    expect(await within(section).findByText("Some sources couldn't be read.")).toBeInTheDocument()
    expect(within(section).getAllByText("Some sources couldn't be read.")).toHaveLength(1)
    expect(within(section).getByText(/4 files/)).toBeInTheDocument()
  })

  test("Azure DevOps' words read in pt-BR", async () => {
    const { changeLanguage } = await import('../../../src/i18n')
    await changeLanguage('pt-BR')
    try {
      mockMain({ provider: 'azure', cli: 'ok', pr: { ...PR.azure, state: 'merged' } })
      await renderTab()
      expect(await screen.findByRole('heading', { name: 'Pipelines e políticas' })).toBeInTheDocument()
      expect(screen.getByText('Aguardando o autor')).toBeInTheDocument()
      expect(screen.getByText('Concluído')).toBeInTheDocument()
      expect(screen.getByText('Não se aplica')).toBeInTheDocument()
    } finally { await changeLanguage('en') }
  })

})
