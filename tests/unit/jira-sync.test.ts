// @vitest-environment node
// scripts/jira-sync.mjs: which Jira items a pull request names, and where they move.
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { keysOf, plan, shouldMove, targetOf, versionOfTag } from '../../scripts/jira-sync.mjs'

const pr = (o: Record<string, unknown>) => ({ number: 1, title: '', branch: '', state: 'open', merged: false, labels: [], ...o })

describe('jira-sync', () => {
  it('reads the keys from the title and the branch, once each', () => {
    expect(keysOf(pr({ title: 'fix(x): menus (OXE-9, CODE-8)', branch: 'oxe-9-menus' }))).toEqual(['OXE-9'])
    expect(keysOf(pr({ title: 'feat: a (OXE-15) and b (oxe-21)' }))).toEqual(['OXE-15', 'OXE-21'])
    expect(keysOf(pr({ title: 'no key here', branch: 'feat/thing' }))).toEqual([])
  })

  it('an open PR asks Em revisão, a queued one Na fila, a merged one Na main, a closed unmerged one nothing', () => {
    expect(targetOf(pr({}))).toBe('Em revisão')
    expect(targetOf(pr({ labels: ['na-fila'] }))).toBe('Na fila')
    expect(targetOf(pr({ state: 'closed', merged: true }))).toBe('Na main')
    expect(targetOf(pr({ state: 'closed' }))).toBeNull()
  })

  it('moves forward only, except a PR the train took out of the queue', () => {
    expect(shouldMove('A fazer', 'Em revisão')).toBe(true)
    expect(shouldMove('Em andamento', 'Na fila')).toBe(true)
    expect(shouldMove('Na fila', 'Em revisão')).toBe(true)
    expect(shouldMove('Na main', 'Em revisão')).toBe(false)
    expect(shouldMove('Lançado', 'Na main')).toBe(false)
    expect(shouldMove('Em revisão', 'Em revisão')).toBe(false)
    expect(shouldMove('Algo novo', 'Na main')).toBe(false)
  })

  it('two PRs on one item: the furthest state wins', () => {
    const wanted = plan([pr({ number: 1, title: 'a (OXE-5)' }), pr({ number: 2, title: 'b (OXE-5)', state: 'closed', merged: true })])
    expect(wanted.get('OXE-5')).toEqual({ target: 'Na main', pr: 2 })
  })

  it('only a stable vX.Y.Z tag names a version', () => {
    expect(versionOfTag('v1.5.2')).toBe('1.5.2')
    expect(versionOfTag('v1.5.2-beta.1')).toBeNull()
    expect(versionOfTag('1.5.2')).toBeNull()
  })
})
