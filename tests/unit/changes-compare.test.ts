import { describe, expect, it } from 'vitest'
import { comparisonKey, headLabel, isValidRef, swapSides } from '../../src/components/Changes/changesModel'
import { parseGitDiffInput, parseGitFileAtRefInput } from '../../electron/main/ipc/validation'

describe('choosing both sides of a comparison', () => {
  it('accepts the refs the main process accepts and refuses the rest', () => {
    for (const ref of ['main', 'origin/main', 'feature/x-1', 'v1.2.3', 'HEAD~3', 'a1b2c3d', 'HEAD@{1}']) expect(isValidRef(ref)).toBe(true)
    for (const ref of ['', 'main..feature', '-x', 'a b', 'x;rm', 'a$b']) expect(isValidRef(ref)).toBe(false)
  })

  it('labels a side by its ref or by the branch of its work tree', () => {
    expect(headLabel({ kind: 'ref', ref: 'v1' })).toBe('v1')
    expect(headLabel({ kind: 'worktree', path: '/r', branch: 'feature' })).toBe('feature')
    expect(headLabel({ kind: 'worktree', path: '/r', branch: null })).toBe('detached')
  })

  it('keys "viewed" marks by both sides and the mode', () => {
    const tree = { kind: 'worktree' as const, path: '/r-tree', branch: 'feature' }
    const keys = new Set([
      comparisonKey('main', tree, 'merge-base'),
      comparisonKey('main', tree, 'direct'),
      comparisonKey('main', { kind: 'ref', ref: 'feature' }, 'merge-base'),
      comparisonKey('develop', tree, 'merge-base')
    ])
    expect(keys.size).toBe(4)
  })

  it('swaps the sides, turning a work-tree side into its branch', () => {
    expect(swapSides('main', { kind: 'ref', ref: 'feature' })).toEqual({ base: 'feature', head: { kind: 'ref', ref: 'main' } })
    expect(swapSides('main', { kind: 'worktree', path: '/r', branch: 'feature' })).toEqual({ base: 'feature', head: { kind: 'ref', ref: 'main' } })
    expect(swapSides('main', { kind: 'worktree', path: '/r', branch: null })).toBeNull()
  })

  it('validates side B and the mode at the IPC boundary', () => {
    const input = { workspaceId: 'w', rootPath: '/r', base: 'main', includeUncommitted: true }
    expect(parseGitDiffInput(input)).toEqual(input)
    expect(parseGitDiffInput({ ...input, head: 'feature', mode: 'direct' })).toMatchObject({ head: 'feature', mode: 'direct' })
    expect(() => parseGitDiffInput({ ...input, head: 'main..x' })).toThrow(/head/)
    expect(() => parseGitDiffInput({ ...input, head: '--output=x' })).toThrow(/head/)
    expect(() => parseGitDiffInput({ ...input, mode: 'triple' })).toThrow(/mode/)
  })

  it('validates a file-at-ref request', () => {
    expect(parseGitFileAtRefInput({ workspaceId: 'w', rootPath: '/r', ref: 'feature', path: 'src/a.ts' })).toEqual({ workspaceId: 'w', rootPath: '/r', ref: 'feature', path: 'src/a.ts' })
    expect(() => parseGitFileAtRefInput({ workspaceId: 'w', rootPath: '/r', ref: 'feature', path: '../secret' })).toThrow(/path/)
    expect(() => parseGitFileAtRefInput({ workspaceId: 'w', rootPath: '/r', ref: '-p', path: 'a' })).toThrow(/ref/)
  })
})
