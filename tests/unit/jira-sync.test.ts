// @vitest-environment node
// scripts/jira-sync.mjs: which Jira items a pull request names, and where they move.
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { declarationsOf, isTested, keysOf, mergeNotes, plan, shouldMove, STATES, targetOf, versionOfBranch, versionOfTag } from '../../scripts/jira-sync.mjs'

const pr = (o: Record<string, unknown>) => ({ number: 1, title: '', branch: '', state: 'open', merged: false, labels: [], ...o })

describe('jira-sync', () => {
  it('reads the keys from the title and the branch, once each', () => {
    expect(keysOf(pr({ title: 'fix(x): menus (OXE-9, CODE-8)', branch: 'oxe-9-menus' }))).toEqual(['OXE-9'])
    expect(keysOf(pr({ title: 'feat: a (OXE-15) and b (oxe-21)' }))).toEqual(['OXE-15', 'OXE-21'])
    expect(keysOf(pr({ title: 'no key here', branch: 'feat/thing' }))).toEqual([])
  })

  it('follows the 12-column flow the user accepted on 14/11 (OXE-119)', () => {
    expect(STATES).toEqual(['Backlog', 'Em grooming', 'Em refinamento', 'Pronto para desenvolvimento', 'Em desenvolvimento', 'Em revisão', 'Testado', 'Na fila', 'Na main', 'Em homologação', 'Homologado', 'Lançado'])
  })

  it('an open PR asks Em revisão, a tested one Testado, a queued one Na fila, a merged one Na main, a closed unmerged one nothing', () => {
    expect(targetOf(pr({}))).toBe('Em revisão')
    expect(targetOf(pr({ tested: true }))).toBe('Testado')
    expect(targetOf(pr({ tested: true, labels: ['na-fila'] }))).toBe('Na fila')
    expect(targetOf(pr({ labels: ['na-fila'] }))).toBe('Na fila')
    expect(targetOf(pr({ state: 'closed', merged: true }))).toBe('Na main')
    expect(targetOf(pr({ state: 'closed' }))).toBeNull()
  })

  it('a PR is Testado only with CI result and pr:ready green at their latest status', () => {
    expect(isTested([{ context: 'pr:ready', state: 'success' }, { context: 'CI result', state: 'success' }])).toBe(true)
    // GitHub lists statuses newest first: a newer failure wins over an older success.
    expect(isTested([{ context: 'CI result', state: 'failure' }, { context: 'pr:ready', state: 'success' }, { context: 'CI result', state: 'success' }])).toBe(false)
    expect(isTested([{ context: 'CI result', state: 'success' }])).toBe(false)
    expect(isTested([])).toBe(false)
  })

  it('moves forward only, except back and forth inside review', () => {
    expect(shouldMove('Backlog', 'Em revisão')).toBe(true)
    expect(shouldMove('Pronto para desenvolvimento', 'Em revisão')).toBe(true)
    expect(shouldMove('Em desenvolvimento', 'Na fila')).toBe(true)
    expect(shouldMove('Em revisão', 'Testado')).toBe(true)
    expect(shouldMove('Testado', 'Em revisão')).toBe(true)
    expect(shouldMove('Na fila', 'Em revisão')).toBe(true)
    expect(shouldMove('Na fila', 'Testado')).toBe(true)
    expect(shouldMove('Na main', 'Em revisão')).toBe(false)
    expect(shouldMove('Em homologação', 'Na main')).toBe(false)
    expect(shouldMove('Homologado', 'Testado')).toBe(false)
    expect(shouldMove('Lançado', 'Na main')).toBe(false)
    expect(shouldMove('Em revisão', 'Em revisão')).toBe(false)
    expect(shouldMove('Algo novo', 'Na main')).toBe(false)
  })

  it('two PRs on one item: the furthest state wins', () => {
    const wanted = plan([pr({ number: 1, title: 'a (OXE-5)' }), pr({ number: 2, title: 'b (OXE-5)', body: 'Fecha OXE-5', state: 'closed', merged: true })])
    expect(wanted.get('OXE-5')).toEqual({ target: 'Na main', pr: 2 })
  })

  it('only a release/X.Y.Z branch names a version in homologation', () => {
    expect(versionOfBranch('release/1.5.2')).toBe('1.5.2')
    expect(versionOfBranch('release/1.5.2-hotfix')).toBeNull()
    expect(versionOfBranch('main')).toBeNull()
  })

  it('only a stable vX.Y.Z tag names a version', () => {
    expect(versionOfTag('v1.5.2')).toBe('1.5.2')
    expect(versionOfTag('v1.5.2-beta.1')).toBeNull()
    expect(versionOfTag('1.5.2')).toBeNull()
  })

  describe('a merged PR moves only the cards it closes (OXE-277)', () => {
    const merged = (o: Record<string, unknown>) => pr({ state: 'closed', merged: true, url: 'https://github.com/o/r/pull/9', number: 9, ...o })

    it('"Fecha OXE-N" moves to Na main', () => {
      expect(declarationsOf(merged({ body: 'Fecha OXE-60, OXE-63\nmore text' }))).toEqual({ closes: ['OXE-60', 'OXE-63'], parts: [] })
      expect(plan([merged({ title: 'feat: sidebar (OXE-60)', body: 'Fecha OXE-60' })]).get('OXE-60')).toEqual({ target: 'Na main', pr: 9 })
      expect(plan([merged({ title: 'chore', body: 'Closes OXE-7' })]).get('OXE-7')).toEqual({ target: 'Na main', pr: 9 })
    })

    it('"Parte de OXE-N" only comments, with the PR link', () => {
      const piece = merged({ title: 'feat(mobile): pairing protocol (OXE-102)', body: 'Parte de OXE-102\nFecha OXE-179' })
      expect(plan([piece]).has('OXE-102')).toBe(false)
      expect(plan([piece]).get('OXE-179')).toEqual({ target: 'Na main', pr: 9 })
      expect(mergeNotes([piece])).toEqual({ comments: [{ key: 'OXE-102', pr: 9, url: 'https://github.com/o/r/pull/9' }], warnings: [] })
    })

    it('a bare key does not move, and the run warns', () => {
      const bare = merged({ title: 'fix: a thing (OXE-72)', branch: 'oxe-72-title-bar' })
      expect(plan([bare]).has('OXE-72')).toBe(false)
      expect(mergeNotes([bare])).toEqual({ comments: [], warnings: [{ key: 'OXE-72', pr: 9 }] })
    })

    it('opening and review moves stay as they are: an open PR moves every key it names', () => {
      expect(plan([pr({ number: 3, title: 'feat (OXE-72)' })]).get('OXE-72')).toEqual({ target: 'Em revisão', pr: 3 })
      expect(plan([pr({ number: 3, title: 'feat (OXE-72)', labels: ['na-fila'] })]).get('OXE-72')).toEqual({ target: 'Na fila', pr: 3 })
      expect(mergeNotes([pr({ number: 3, title: 'feat (OXE-72)' })])).toEqual({ comments: [], warnings: [] })
    })
  })
})

// OXE-291: the workflow file itself, read as YAML.
describe('the Jira sync workflow (OXE-291)', () => {
  type Workflow = { on: Record<string, { types?: string[]; workflows?: string[]; cron?: string }[] | Record<string, unknown> | null>; concurrency: { group: string; 'cancel-in-progress': boolean }; permissions: Record<string, string>; jobs: { sync: { steps: Array<{ uses?: string; with?: Record<string, unknown>; run?: string }> } } }
  const workflow = load(readFileSync('.github/workflows/jira-sync.yml', 'utf8')) as Workflow

  it('runs when a Merge train run completes, so train merges never wait for the schedule', () => {
    expect(workflow.on.workflow_run).toEqual({ workflows: ['Merge train'], types: ['completed'] })
    const train = load(readFileSync('.github/workflows/merge-train.yml', 'utf8')) as { name: string }
    expect(train.name).toBe('Merge train')
  })

  it('keeps its other triggers, its non-cancelling concurrency group and empty permissions', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request_target', 'release', 'schedule', 'workflow_dispatch', 'workflow_run'])
    expect(workflow.on.pull_request_target).toEqual({ types: ['opened', 'reopened', 'edited', 'labeled', 'unlabeled', 'closed'] })
    expect(workflow.on.release).toEqual({ types: ['published'] })
    expect(workflow.on.schedule).toEqual([{ cron: '7,22,37,52 * * * *' }])
    expect(workflow.concurrency).toEqual({ group: 'jira-sync', 'cancel-in-progress': false })
    expect(workflow.permissions).toEqual({})
  })

  it('a workflow_run sync checks out main only and never fails the run on a Jira error', () => {
    const [checkout, , sync] = workflow.jobs.sync.steps
    expect(checkout.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}/)
    expect(checkout.with).toMatchObject({ ref: '${{ github.event.repository.default_branch }}', 'sparse-checkout': 'scripts/jira-sync.mjs', 'persist-credentials': false })
    expect(sync.run).toBe('node scripts/jira-sync.mjs')
    expect(readFileSync('scripts/jira-sync.mjs', 'utf8')).toMatch(/never fails/)
  })
})
