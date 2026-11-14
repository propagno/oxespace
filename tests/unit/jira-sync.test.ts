// @vitest-environment node
// scripts/jira-sync.mjs: which Jira items a pull request names, and where they move.
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { isTested, keysOf, plan, shouldMove, STATES, targetOf, versionOfBranch, versionOfTag } from '../../scripts/jira-sync.mjs'

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
    const wanted = plan([pr({ number: 1, title: 'a (OXE-5)' }), pr({ number: 2, title: 'b (OXE-5)', state: 'closed', merged: true })])
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
})
