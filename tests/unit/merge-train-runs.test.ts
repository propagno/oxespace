// @vitest-environment node
// How the merge train tells which workflow a run belongs to, and which runs tested their own head. Split out of
// merge-train.test.ts to keep each file under the 1,000-line limit.
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { CI_WORKFLOW, createGitHubApi, step, testsItsOwnHead } from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-11-01T02:00:00Z')
const HEAD = 'a'.repeat(40)
type Check = { name: string; headSha: string; status: string; conclusion: string | null; failedStep?: string | null }
const check = (name: string, over: Partial<Check> = {}): Check => ({ name, headSha: HEAD, status: 'completed', conclusion: 'success', ...over })
const pr = () => ({ number: 358, state: 'open', draft: false, isFork: false, headSha: HEAD, headRef: 'be/mcp/off-groups-server', mergeable: true, mergeableState: 'clean', changesRequested: false, labeledAt: '2026-11-01T01:00:00Z', labeledBy: 'maintainer', labelerAllowed: true })
const input = (over: Record<string, unknown> = {}) => ({
  pr: pr(),
  behindBy: 0,
  runs: [{ name: CI_WORKFLOW, path: '.github/workflows/ci.yml', headSha: HEAD, status: 'completed', conclusion: 'success', createdAt: '2026-11-01T01:40:00Z' }],
  checks: [check('Changed paths'), check('Typecheck, test and build (linux-x64)')],
  requiredChecks: [],
  trainState: null,
  now: NOW,
  timeoutMinutes: 60,
  ...over,
})

describe('run identity: workflow runs by file, jobs by check runs (#358, #337)', () => {
  const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => '' } })
  const run = (name: string, file: string, event: string, conclusion: string | null, at: string) => ({ name, display_title: name, path: `.github/workflows/${file}`, event, status: conclusion ? 'completed' : 'in_progress', conclusion, head_sha: HEAD, head_branch: 'be/mcp/off-groups-server', head_repository: { full_name: 'o/r' }, created_at: at, check_suite_id: name.length })
  // The runs on #358's head dc7dc2d: the bot update's unapproved pull_request runs, and the train's dispatches.
  const raw = (ci: string | null) => [run('Accessibility scan (axe)', 'a11y-axe.yml', 'workflow_dispatch', 'success', '2026-11-01T01:41:41Z'), run('Full check · be/mcp/off-groups-server', 'ci.yml', 'workflow_dispatch', ci, '2026-11-01T01:41:40Z'), run('Accessibility scan (axe)', 'a11y-axe.yml', 'pull_request', 'action_required', '2026-11-01T01:41:38Z'), run('CI and Release', 'ci.yml', 'pull_request', 'action_required', '2026-11-01T01:41:38Z')]
  const listRuns = (ci: string | null) => createGitHubApi({ token: 't', repo: 'o/r', fetchImpl: async () => respond({ workflow_runs: raw(ci) }) }).listRuns(HEAD)

  it("the runs list names a ci.yml run by its workflow, whatever its title (PR #N · …, Full check · …)", async () => {
    expect((await listRuns('success')).map((r: { name: string }) => r.name)).toEqual(['Accessibility scan (axe)', CI_WORKFLOW, 'Accessibility scan (axe)', CI_WORKFLOW])
  })

  it('a green train dispatch next to an unapproved bot run merges; while it runs, the car waits for it', async () => {
    expect(step(input({ runs: await listRuns('success') })).type).toBe('merge')
    expect(step(input({ runs: await listRuns(null) })).message).toMatch(/CI and Release still running/)
    // Before this fix the only "CI and Release" run was the action_required one, so a green car left the queue.
    expect(step(input({ runs: raw('success').map((r) => ({ name: r.name, path: r.path, headSha: HEAD, status: r.status, conclusion: r.conclusion, createdAt: r.created_at })) })).type).not.toBe('merge')
  })

  it('an unlisted workflow never reads as CI, and a dispatch that built another branch never counts, jobs included', async () => {
    const fake = run('CI and Release', 'fake.yml', 'pull_request', 'success', '2026-11-01T01:50:00Z')
    const other = { ...run('Full check · green-branch', 'ci.yml', 'workflow_dispatch', 'success', '2026-11-01T01:51:00Z'), check_suite_id: 999 }
    const smoke = run('Packaged smoke · be/mcp/off-groups-server', 'ci.yml', 'workflow_dispatch', 'success', '2026-11-01T01:52:00Z')
    const api = createGitHubApi({
      token: 't',
      repo: 'o/r',
      fetchImpl: async (url: string) =>
        respond(
          url.includes('/check-runs')
            ? { check_runs: [{ name: 'Typecheck, test and build (linux-x64)', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, check_suite: { id: 999 } }] }
            : { workflow_runs: [fake, other, smoke] },
        ),
    })
    expect(await api.listRuns(HEAD)).toEqual([expect.objectContaining({ name: null })])
    expect(await api.listChecks(HEAD)).toEqual([])
    expect(step(input({ runs: await api.listRuns(HEAD) })).message).toMatch(/has not started/)
    expect(testsItsOwnHead({ event: 'workflow_dispatch', path: '.github/workflows/ci.yml', display_title: 'Full check · feat/x', head_branch: 'feat/x' })).toBe(true)
    expect(testsItsOwnHead({ event: 'workflow_dispatch', path: '.github/workflows/a11y-axe.yml', display_title: 'Accessibility scan (axe)', head_branch: 'feat/x' })).toBe(true)
  })

  it('jobs still come from check runs on the head, whatever the run is called', () => {
    const checks = [check('Typecheck, test and build (linux-x64)', { conclusion: 'failure', failedStep: 'E2E performance gate (Linux)' })]
    expect(step(input({ checks })).message).toContain('"Typecheck, test and build (linux-x64)" failure at step "E2E performance gate (Linux)"')
    expect(step(input({ checks: [check('Typecheck, test and build (windows-x64)', { status: 'in_progress', conclusion: null })] })).message).toMatch(/windows-x64\) still running/)
  })
})

