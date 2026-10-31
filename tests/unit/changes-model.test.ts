import { describe, expect, it } from 'vitest'
import type { GitDiffSummaryFile } from '../../shared/types/git'
import { buildChangeTree, filterChangedFiles, isLargeDiff, languageFor, normalizeBranchName, orderedFiles, splitPath } from '../../src/components/Changes/changesModel'

const file = (path: string, additions = 1, deletions = 0): GitDiffSummaryFile => ({ path, status: 'M', additions, deletions, binary: false })

describe('changes model', () => {
  it('groups files into directories, directories first, rolling up counts', () => {
    const tree = buildChangeTree([file('src/a.ts', 2, 1), file('README.md'), file('src/lib/b.ts', 3, 0)])
    expect(tree.map(node => `${node.kind}:${node.path}`)).toEqual(['dir:src', 'file:README.md'])
    expect(tree[0].additions).toBe(5)
    expect(tree[0].deletions).toBe(1)
    expect(orderedFiles(tree).map(entry => entry.path)).toEqual(['src/lib/b.ts', 'src/a.ts', 'README.md'])
  })

  it('collapses single-child directory chains', () => {
    const tree = buildChangeTree([file('docs/audits/2026/one.md'), file('docs/audits/2026/two.md')])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('docs/audits/2026')
  })

  it('filters by path substring ignoring case', () => {
    expect(filterChangedFiles([file('src/App.tsx'), file('docs/a.md')], 'app').map(entry => entry.path)).toEqual(['src/App.tsx'])
    expect(filterChangedFiles([file('a')], '  ')).toHaveLength(1)
  })

  it('hides HEAD aliases and strips remotes/ prefixes from branch names', () => {
    expect(normalizeBranchName('remotes/origin/main')).toBe('origin/main')
    expect(normalizeBranchName('origin/HEAD')).toBeNull()
    expect(normalizeBranchName('origin/HEAD -> origin/main')).toBeNull()
    expect(normalizeBranchName('feature/x')).toBe('feature/x')
  })

  it('flags large diffs by file or line count', () => {
    expect(isLargeDiff(3, 100)).toBe(false)
    expect(isLargeDiff(41, 100)).toBe(true)
    expect(isLargeDiff(3, 5001)).toBe(true)
  })

  it('splits paths and maps languages', () => {
    expect(splitPath('src/a/b.ts')).toEqual({ directory: 'src/a/', name: 'b.ts' })
    expect(splitPath('b.ts')).toEqual({ directory: '', name: 'b.ts' })
    expect(languageFor('x/y.tsx')).toBe('typescript')
    expect(languageFor('Makefile')).toBe('plaintext')
  })
})

import { chooseBase } from '../../src/components/Changes/changesModel'
describe('chooseBase', () => {
  it('prefers the resolved base when it exists', () => {
    expect(chooseBase('origin/develop', ['origin/develop', 'main'])).toBe('origin/develop')
  })
  it('falls back to trunk names, then HEAD', () => {
    expect(chooseBase(null, ['feature/x', 'main'])).toBe('main')
    expect(chooseBase('origin/main', ['main'])).toBe('main')
    expect(chooseBase(null, [])).toBe('HEAD')
  })
})
