import { describe, expect, it } from 'vitest'
import { parsePullRequestStatus, summarizeChecks } from '../../electron/main/services/github/pr-status'
import { ciFixPrompt } from '../../src/components/GitHub/PrStatusBar'

const view = {
  number: 42, title: 'Add changes panel', state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/42',
  headRefName: 'feat/changes', baseRefName: 'main', mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED',
  autoMergeRequest: null,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/1' },
    { __typename: 'CheckRun', name: 'test', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/2' },
    { __typename: 'CheckRun', name: 'lint', workflowName: 'CI', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'docs', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR', targetUrl: 'https://ci.example/1' }
  ]
}

describe('pull request status', () => {
  it('maps check runs and commit statuses to four states', () => {
    const status = parsePullRequestStatus(JSON.stringify(view))!
    expect(status).toMatchObject({ number: 42, state: 'OPEN', autoMerge: false, headRefName: 'feat/changes' })
    expect(status.checks.map(check => [check.name, check.state])).toEqual([['build', 'success'], ['test', 'failure'], ['lint', 'pending'], ['docs', 'neutral'], ['ci/legacy', 'failure']])
    expect(status.checks[4]).toMatchObject({ workflow: null, url: 'https://ci.example/1' })
    expect(summarizeChecks(status.checks)).toEqual({ success: 1, failure: 2, pending: 1, neutral: 1 })
  })

  it('reports auto-merge and tolerates missing fields', () => {
    expect(parsePullRequestStatus(JSON.stringify({ ...view, autoMergeRequest: { mergeMethod: 'SQUASH' } }))!.autoMerge).toBe(true)
    expect(parsePullRequestStatus(JSON.stringify({ number: 7, state: 'MERGED' }))).toMatchObject({ number: 7, state: 'MERGED', checks: [], title: 'Pull request #7' })
  })

  it('returns null for output that is not a pull request', () => {
    expect(parsePullRequestStatus('')).toBeNull()
    expect(parsePullRequestStatus('not json')).toBeNull()
    expect(parsePullRequestStatus('{"title":"x"}')).toBeNull()
  })

  it('builds a fix prompt that lists only the failing checks', () => {
    const prompt = ciFixPrompt(parsePullRequestStatus(JSON.stringify(view))!)
    expect(prompt).toContain('pull request #42 (branch feat/changes)')
    expect(prompt).toContain('- test (CI): https://github.com/o/r/actions/runs/2')
    expect(prompt).toContain('- ci/legacy: https://ci.example/1')
    expect(prompt).not.toContain('- build')
  })
})
