// Frozen acceptance test for 1.5.0 A60 / G1–G2 (OXE program, phase F4): the Pull request tab reads the same shape for a
// GitHub remote and an Azure DevOps (cloud) remote, detected from the remote URL. Merge detection asks the provider
// first; git is only the fallback, and says it can't see squash merges. Without the CLI, or signed out, the state says so.
// Written by the planner; the executor must not edit it. Fake CLIs only: no network, no user token, no user home.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A60 and DESIGN's 1.5.0-f4-design.md U4.6 (PR provider).
import { describe, expect, test } from 'vitest'
import { detectPrProvider, PullRequestProvider, type PrCliRunner } from '../../../electron/main/services/pull-request/pr-provider'
import { isSafeBranchName } from '../../../electron/main/utils/git-ref-name'

interface Call { command: 'gh' | 'az'; args: string[]; cwd: string }
type Reply = { status: number | null; stdout: string; stderr: string; missing?: boolean }
const ok = (value: unknown): Reply => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' })
const fail = (stderr: string): Reply => ({ status: 1, stdout: '', stderr })

/** A fake CLI: answers by subcommand, records every call, and has no PR unless given one. */
function fakeCli(options: { gh?: 'ok' | 'missing' | 'signed-out'; az?: 'ok' | 'missing' | 'signed-out'; ghPr?: unknown; ghMerged?: unknown[]; azPrs?: unknown[]; azPolicies?: unknown[]; azWorkItems?: unknown[] } = {}) {
  const calls: Call[] = []
  const run: PrCliRunner = async (command, args, cwd) => {
    calls.push({ command, args, cwd })
    const line = args.join(' ')
    const state = command === 'gh' ? options.gh ?? 'ok' : options.az ?? 'ok'
    if (state === 'missing') return { status: null, stdout: '', stderr: '', missing: true }
    if (line.includes('--version')) return ok(`${command} version 2.0.0`)
    if (command === 'gh' && line.startsWith('auth status')) return state === 'ok' ? ok('Logged in to github.com') : fail('You are not logged into any GitHub hosts. Run gh auth login to authenticate.')
    if (command === 'az' && line.startsWith('account show')) return state === 'ok' ? ok({ user: { name: 'dev' } }) : fail("Please run 'az login' to setup account.")
    if (state === 'signed-out') return fail('not signed in')
    if (command === 'gh' && line.startsWith('pr view')) return options.ghPr ? ok(options.ghPr) : fail('no pull requests found for branch "agent-fix"')
    if (command === 'gh' && line.startsWith('pr list')) return ok(options.ghMerged ?? [])
    if (command === 'az' && line.startsWith('repos pr list')) return ok(options.azPrs ?? [])
    if (command === 'az' && line.startsWith('repos pr policy list')) return ok(options.azPolicies ?? [])
    if (command === 'az' && line.startsWith('repos pr work-item list')) return ok(options.azWorkItems ?? [])
    return fail(`unexpected ${command} ${line}`)
  }
  return { run, calls }
}

const GITHUB = 'https://github.com/acme/shop.git'
const AZURE = 'https://dev.azure.com/acme/Shop/_git/shop-api'
function provider(remote: string | null, cli: ReturnType<typeof fakeCli>, gitMerged = false) {
  return new PullRequestProvider({ run: cli.run, remoteUrl: async () => remote, gitMerged: async () => gitMerged })
}

const ghPr = {
  number: 321, title: 'Fix login', state: 'OPEN', isDraft: false, url: 'https://github.com/acme/shop/pull/321', headRefName: 'agent-fix', baseRefName: 'main',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:01:23Z' },
    { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '', startedAt: '2026-11-08T10:00:00Z', completedAt: '0001-01-01T00:00:00Z' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-11-08T10:00:00Z', completedAt: '2026-11-08T10:00:09Z' }
  ],
  latestReviews: [{ author: { login: 'ana' }, state: 'APPROVED' }, { author: { login: 'bia' }, state: 'CHANGES_REQUESTED' }],
  reviewRequests: [{ login: 'caio' }],
  closingIssuesReferences: []
}
const azPr = {
  pullRequestId: 4521, title: 'Fix login', status: 'active', isDraft: false, sourceRefName: 'refs/heads/agent-fix', targetRefName: 'refs/heads/main',
  repository: { webUrl: 'https://dev.azure.com/acme/Shop/_git/shop-api' },
  reviewers: [
    { displayName: 'Ana', vote: 10 }, { displayName: 'Bia', vote: 5 }, { displayName: 'Caio', vote: 0 }, { displayName: 'Duda', vote: -5 }, { displayName: 'Edu', vote: -10 }
  ]
}
const azPolicies = [
  { status: 'approved', configuration: { type: { displayName: 'Build' }, settings: { displayName: 'CI build' } }, startedDate: '2026-11-08T10:00:00Z', completedDate: '2026-11-08T10:02:00Z' },
  { status: 'running', configuration: { type: { displayName: 'Build' }, settings: { displayName: 'Integration' } }, startedDate: '2026-11-08T10:00:00Z' },
  { status: 'rejected', configuration: { type: { displayName: 'Minimum number of reviewers' }, settings: {} } }
]

describe('A60 · provider from the remote URL', () => {
  test('A60: GitHub and Azure DevOps (cloud) remotes, in their https and ssh forms', () => {
    for (const url of ['https://github.com/acme/shop.git', 'git@github.com:acme/shop.git', 'ssh://git@github.com/acme/shop', 'https://user@github.com/acme/shop']) expect(detectPrProvider(url), url).toBe('github')
    for (const url of [
      'https://dev.azure.com/acme/Shop/_git/shop-api', 'https://acme@dev.azure.com/acme/Shop/_git/shop-api', 'git@ssh.dev.azure.com:v3/acme/Shop/shop-api',
      'https://acme.visualstudio.com/Shop/_git/shop-api', 'acme@vs-ssh.visualstudio.com:v3/acme/Shop/shop-api'
    ]) expect(detectPrProvider(url), url).toBe('azure')
  })

  test('A60: any other remote, a lookalike host, or none is none', () => {
    for (const url of ['https://gitlab.com/acme/shop.git', 'https://github.com.evil.example/acme/shop', 'https://dev.azure.com.evil.example/acme/Shop/_git/x', 'https://evil.example/github.com/acme/shop', '', null]) {
      expect(detectPrProvider(url), String(url)).toBe('none')
    }
  })

  test('A60: provider none runs no CLI and has no PR', async () => {
    const cli = fakeCli()
    const state = await provider('https://gitlab.com/acme/shop.git', cli).state({ rootPath: '/repo', branch: 'agent-fix' })
    expect(state).toMatchObject({ provider: 'none' })
    expect(state.pr).toBeUndefined()
    expect(cli.calls).toEqual([])
  })
})

describe('A60 · one PR shape for both providers', () => {
  test('A60: GitHub: number, state, head and base, checks with state and seconds, reviewers with votes', async () => {
    const state = await provider(GITHUB, fakeCli({ ghPr })).state({ rootPath: '/repo', branch: 'agent-fix' })
    expect(state).toEqual({
      provider: 'github', cli: 'ok',
      pr: {
        number: 321, title: 'Fix login', state: 'open', draft: false, head: 'agent-fix', base: 'main', url: 'https://github.com/acme/shop/pull/321', workItems: [],
        checks: [{ name: 'build', state: 'pass', duration: 83 }, { name: 'e2e', state: 'running', duration: null }, { name: 'lint', state: 'fail', duration: 9 }],
        reviewers: [{ name: 'ana', vote: 'approved' }, { name: 'bia', vote: 'changes-requested' }, { name: 'caio', vote: 'review-requested' }]
      }
    })
  })

  test('A60: Azure DevOps: the same shape, with policies as checks, the five votes and the work items', async () => {
    const cli = fakeCli({ azPrs: [azPr], azPolicies, azWorkItems: [{ id: 812, url: 'https://dev.azure.com/acme/_apis/wit/workItems/812' }] })
    const state = await provider(AZURE, cli).state({ rootPath: '/repo', branch: 'agent-fix' })
    expect(state).toEqual({
      provider: 'azure', cli: 'ok',
      pr: {
        number: 4521, title: 'Fix login', state: 'open', draft: false, head: 'agent-fix', base: 'main', url: 'https://dev.azure.com/acme/Shop/_git/shop-api/pullrequest/4521',
        workItems: [{ id: 812, url: 'https://dev.azure.com/acme/_workitems/edit/812' }],
        checks: [{ name: 'CI build', state: 'pass', duration: 120 }, { name: 'Integration', state: 'running', duration: null }, { name: 'Minimum number of reviewers', state: 'fail', duration: null }],
        reviewers: [
          { name: 'Ana', vote: 'approved' }, { name: 'Bia', vote: 'approved-with-suggestions' }, { name: 'Caio', vote: 'no-vote' },
          { name: 'Duda', vote: 'waiting-for-author' }, { name: 'Edu', vote: 'rejected' }
        ]
      }
    })
    // az is pointed at the organization, project and repository from the remote, and asked for that branch.
    const list = cli.calls.find(call => call.command === 'az' && call.args.join(' ').startsWith('repos pr list'))
    expect(list?.args).toEqual(expect.arrayContaining(['--org', 'https://dev.azure.com/acme', '--project', 'Shop', '--repository', 'shop-api', '--source-branch', 'refs/heads/agent-fix']))
  })

  test('A60: Azure states: completed is merged, abandoned is closed; GitHub MERGED and CLOSED likewise', async () => {
    expect((await provider(AZURE, fakeCli({ azPrs: [{ ...azPr, status: 'completed' }] })).state({ rootPath: '/r', branch: 'agent-fix' })).pr?.state).toBe('merged')
    expect((await provider(AZURE, fakeCli({ azPrs: [{ ...azPr, status: 'abandoned' }] })).state({ rootPath: '/r', branch: 'agent-fix' })).pr?.state).toBe('closed')
    expect((await provider(GITHUB, fakeCli({ ghPr: { ...ghPr, state: 'MERGED' } })).state({ rootPath: '/r', branch: 'agent-fix' })).pr?.state).toBe('merged')
    expect((await provider(GITHUB, fakeCli({ ghPr: { ...ghPr, state: 'CLOSED' } })).state({ rootPath: '/r', branch: 'agent-fix' })).pr?.state).toBe('closed')
  })

  test('A60: no PR for the branch is pr: null, with the CLI ok', async () => {
    expect(await provider(GITHUB, fakeCli()).state({ rootPath: '/r', branch: 'agent-fix' })).toEqual({ provider: 'github', cli: 'ok', pr: null })
    expect(await provider(AZURE, fakeCli()).state({ rootPath: '/r', branch: 'agent-fix' })).toEqual({ provider: 'azure', cli: 'ok', pr: null })
  })

  test('A60: without the CLI the state is missing; signed out is signed-out; both keep the provider', async () => {
    expect(await provider(GITHUB, fakeCli({ gh: 'missing' })).state({ rootPath: '/r', branch: 'agent-fix' })).toEqual({ provider: 'github', cli: 'missing' })
    expect(await provider(AZURE, fakeCli({ az: 'missing' })).state({ rootPath: '/r', branch: 'agent-fix' })).toEqual({ provider: 'azure', cli: 'missing' })
    expect(await provider(GITHUB, fakeCli({ gh: 'signed-out' })).state({ rootPath: '/r', branch: 'agent-fix' })).toEqual({ provider: 'github', cli: 'signed-out' })
    expect(await provider(AZURE, fakeCli({ az: 'signed-out' })).state({ rootPath: '/r', branch: 'agent-fix' })).toEqual({ provider: 'azure', cli: 'signed-out' })
  })

  test('A60: a branch name that could be read as an option is refused before any CLI runs', async () => {
    const cli = fakeCli({ ghPr })
    await expect(provider(GITHUB, cli).state({ rootPath: '/r', branch: '--web' })).rejects.toThrow()
    await expect(provider(GITHUB, cli).state({ rootPath: '/r', branch: 'a b' })).rejects.toThrow()
    expect(cli.calls.filter(call => !call.args.includes('--version') && call.args[0] !== 'auth')).toEqual([])
  })
})

describe('A60 · merged: the provider first, git only as the fallback', () => {
  test('A60: GitHub says merged (a squash merge git cannot see): merged by provider', async () => {
    const result = await provider(GITHUB, fakeCli({ ghMerged: [{ number: 321 }] }), false).merged({ rootPath: '/r', branch: 'agent-fix', base: 'main' })
    expect(result).toEqual({ by: 'provider', value: true, prNumber: 321 })
  })

  test('A60: Azure says completed: merged by provider', async () => {
    const result = await provider(AZURE, fakeCli({ azPrs: [{ ...azPr, status: 'completed' }] }), false).merged({ rootPath: '/r', branch: 'agent-fix', base: 'main' })
    expect(result).toEqual({ by: 'provider', value: true, prNumber: 4521 })
  })

  test('A60: the provider\'s "not merged" stands even when git would say merged', async () => {
    expect(await provider(GITHUB, fakeCli({ ghMerged: [] }), true).merged({ rootPath: '/r', branch: 'agent-fix', base: 'main' })).toEqual({ by: 'provider', value: false })
  })

  test('A60: no CLI, signed out, or another remote falls back to git, marked as git', async () => {
    expect(await provider(GITHUB, fakeCli({ gh: 'missing' }), true).merged({ rootPath: '/r', branch: 'agent-fix', base: 'main' })).toEqual({ by: 'git', value: true })
    expect(await provider(AZURE, fakeCli({ az: 'signed-out' }), false).merged({ rootPath: '/r', branch: 'agent-fix', base: 'main' })).toEqual({ by: 'git', value: false })
    expect(await provider('https://gitlab.com/a/b.git', fakeCli(), true).merged({ rootPath: '/r', branch: 'agent-fix', base: 'main' })).toEqual({ by: 'git', value: true })
  })
})

describe('A60 · SECURITY S3 (branch names)', () => {
  const BAD = ['', '-x', '--web', 'a..b', 'a@{1}', '@', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', 'a b', 'a\u0001b', 'a\u007fb', 'a.lock', 'a/b.lock', 'a.', '/a', 'a/', 'a//b', '.a', 'a/.b']
  const GOOD = ['main', 'feature/x-1', 'release/1.5.0', 'user.name/fix_2', 'agent-fix', 'refs-like/a/b/c']

  test('S3: git ref rules: the unsafe names are refused and the ordinary ones pass', () => {
    for (const name of BAD) expect(isSafeBranchName(name), JSON.stringify(name)).toBe(false)
    for (const name of GOOD) expect(isSafeBranchName(name), name).toBe(true)
  })

  test('S3: state and merged refuse every unsafe name before any CLI runs, for both providers', async () => {
    for (const remote of [GITHUB, AZURE]) {
      const cli = fakeCli({ ghPr, azPrs: [azPr] })
      for (const name of BAD) {
        await expect(provider(remote, cli).state({ rootPath: '/r', branch: name }), name).rejects.toThrow()
        await expect(provider(remote, cli).merged({ rootPath: '/r', branch: name, base: 'main' }), name).rejects.toThrow()
      }
      expect(cli.calls.filter(call => !call.args.includes('--version') && call.args[0] !== 'auth' && call.args[0] !== 'account')).toEqual([])
    }
  })

  test('S3: the branch reaches gh after -- (a positional), and az only as an option value', async () => {
    const gh = fakeCli({ ghPr })
    await provider(GITHUB, gh).state({ rootPath: '/r', branch: 'agent-fix' })
    const view = gh.calls.find(call => call.args[0] === 'pr' && call.args[1] === 'view')
    expect(view?.args.indexOf('--')).toBeGreaterThan(-1)
    expect(view?.args.indexOf('--')).toBeLessThan(view?.args.indexOf('agent-fix') ?? -1)
    const az = fakeCli({ azPrs: [azPr] })
    await provider(AZURE, az).state({ rootPath: '/r', branch: 'agent-fix' })
    const list = az.calls.find(call => call.args.join(' ').startsWith('repos pr list'))
    expect(list?.args[(list?.args.indexOf('--source-branch') ?? -2) + 1]).toBe('refs/heads/agent-fix')
  })
})
