import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { removeTempDir } from '../helpers/removeTempDir'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDiffSummaryFiles, GitService, parseNameStatus, parseNumstat } from '../../electron/main/services/git.service'

describe('git diff summary parsers', () => {
  it('reads numstat records including renames and binary files', () => {
    const raw = '3\t1\tsrc/a.ts\0-\t-\timg.png\0'+'0\t0\t\0old.ts\0new.ts\0'
    const counts = parseNumstat(raw)
    expect(counts.get('src/a.ts')).toEqual({ additions: 3, deletions: 1, binary: false })
    expect(counts.get('img.png')).toEqual({ additions: 0, deletions: 0, binary: true })
    expect(counts.get('new.ts')).toEqual({ additions: 0, deletions: 0, binary: false })
  })

  it('reads name-status records and maps copies and renames to R', () => {
    const entries = parseNameStatus('M\0a.ts\0A\0b.ts\0D\0c.ts\0R087\0old.ts\0new.ts\0')
    expect(entries).toEqual([
      { status: 'M', path: 'a.ts' }, { status: 'A', path: 'b.ts' }, { status: 'D', path: 'c.ts' },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' }
    ])
  })

  it('joins statuses with their counts', () => {
    const files = buildDiffSummaryFiles('M\0a.ts\0', '5\t2\ta.ts\0')
    expect(files).toEqual([{ path: 'a.ts', oldPath: undefined, status: 'M', additions: 5, deletions: 2, binary: false }])
  })
})

describe('GitService.getDiffSummary / getFileOriginal', () => {
  let root = ''
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'oxe-git-summary-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\n')
    writeFileSync(join(root, 'gone.txt'), 'bye\n')
    writeFileSync(join(root, 'keep.txt'), 'same\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feature')
    writeFileSync(join(root, 'src', 'a.ts'), 'one\nTWO\nthree\nfour\n')
    writeFileSync(join(root, 'new.txt'), 'hello\n')
    rmSync(join(root, 'gone.txt'))
    git('add', '-A')
    git('commit', '-qm', 'feature work')
    writeFileSync(join(root, 'keep.txt'), 'same\nplus uncommitted\n')
  })
  afterAll(() => { removeTempDir(root) })

  it('lists committed and uncommitted changes against the base without caps', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', true)
    expect(summary.error).toBeUndefined()
    const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]))
    expect(byPath['src/a.ts']).toMatchObject({ status: 'M', additions: 2, deletions: 1 })
    expect(byPath['new.txt']).toMatchObject({ status: 'A', additions: 1 })
    expect(byPath['gone.txt']).toMatchObject({ status: 'D', deletions: 1 })
    expect(byPath['keep.txt']).toMatchObject({ status: 'M', additions: 1 })
    expect(summary.additions).toBe(4)
  })

  it('leaves out uncommitted work when asked', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', false)
    expect(summary.files.some(file => file.path === 'keep.txt')).toBe(false)
  })

  it('returns the base-side content of a file and flags added files', async () => {
    const service = new GitService()
    expect((await service.getFileOriginal(root, 'main', 'src/a.ts')).content).toBe('one\ntwo\nthree\n')
    expect(await service.getFileOriginal(root, 'main', 'new.txt')).toMatchObject({ missing: true, content: '' })
  })

  it('reports an unresolvable base without throwing', async () => {
    const summary = await new GitService().getDiffSummary(root, 'does-not-exist', true)
    expect(summary.files.length).toBeGreaterThan(0)
  })
})

describe('GitService with both sides chosen', () => {
  let root = ''
  let tree = ''
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'oxe-git-sides-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(join(root, 'shared.txt'), 'base\n')
    writeFileSync(join(root, 'old-name.txt'), 'renamed content\nline two\nline three\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'feature')
    writeFileSync(join(root, 'feature.txt'), 'feature only\n')
    git('mv', 'old-name.txt', 'new-name.txt')
    git('add', '-A')
    git('commit', '-qm', 'feature work')
    // main moves on after feature branched, so "common ancestor" and "direct" give different answers.
    git('checkout', '-q', 'main')
    writeFileSync(join(root, 'main-later.txt'), 'main only\n')
    git('add', '.')
    git('commit', '-qm', 'main later')
    git('tag', 'v1')
    tree = `${root}-tree`
    git('worktree', 'add', '-q', tree, 'feature')
    writeFileSync(join(tree, 'feature.txt'), 'feature only\nuncommitted in the worktree\n')
  })
  afterAll(() => { removeTempDir(tree); removeTempDir(root) })

  it('compares two refs without checking either out, from their common ancestor', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', true, 'feature')
    expect(summary.error).toBeUndefined()
    expect(summary.head).toBe('feature')
    expect(summary.includeUncommitted).toBe(false)
    const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]))
    expect(byPath['feature.txt']).toMatchObject({ status: 'A', additions: 1 })
    expect(byPath['new-name.txt']).toMatchObject({ status: 'R', oldPath: 'old-name.txt' })
    // A file only main gained after the branch point is not part of feature's changes.
    expect(byPath['main-later.txt']).toBeUndefined()
  })

  it('compares the base itself in direct mode', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', true, 'feature', 'direct')
    const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]))
    expect(byPath['main-later.txt']).toMatchObject({ status: 'D' })
    expect(byPath['feature.txt']).toMatchObject({ status: 'A' })
  })

  it('compares the other way round when the sides are swapped', async () => {
    const summary = await new GitService().getDiffSummary(root, 'feature', true, 'main')
    const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]))
    expect(byPath['main-later.txt']).toMatchObject({ status: 'A' })
    expect(byPath['feature.txt']).toBeUndefined()
  })

  it('accepts tags and SHAs on either side', async () => {
    const sha = git('rev-parse', 'feature').trim()
    const summary = await new GitService().getDiffSummary(root, 'v1', true, sha)
    expect(summary.error).toBeUndefined()
    expect(summary.files.some(file => file.path === 'feature.txt')).toBe(true)
  })

  it('reports a side B that does not exist instead of comparing against HEAD', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', true, 'no-such-branch')
    expect(summary.files).toEqual([])
    expect(summary.error).toMatch(/no-such-branch/)
  })

  it('reports a base that does not exist in direct mode', async () => {
    const summary = await new GitService().getDiffSummary(root, 'no-such-base', true, 'feature', 'direct')
    expect(summary.files).toEqual([])
    expect(summary.error).toMatch(/no-such-base/)
  })

  it('reads both sides of a file from git when side B is a ref', async () => {
    const service = new GitService()
    expect(await service.getFileOriginal(root, 'main', 'feature.txt', undefined, 'feature')).toMatchObject({ missing: true })
    expect((await service.getFileOriginal(root, 'main', 'new-name.txt', 'old-name.txt', 'feature')).content).toBe('renamed content\nline two\nline three\n')
    expect((await service.getFileAtRef(root, 'feature', 'feature.txt')).content).toBe('feature only\n')
    expect(await service.getFileAtRef(root, 'main', 'feature.txt')).toMatchObject({ missing: true, content: '' })
  })

  it('compares another worktree with its uncommitted changes when that worktree is the root', async () => {
    const summary = await new GitService().getDiffSummary(tree, 'main', true)
    const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]))
    expect(byPath['feature.txt']).toMatchObject({ status: 'A', additions: 2 })
  })

  it('builds the classic review diff for two refs', async () => {
    const diff = await new GitService().buildDiff(root, 'main', true, 'feature')
    expect(diff.includeUncommitted).toBe(false)
    expect(diff.files.map(file => file.path)).toContain('feature.txt')
    expect(diff.files.map(file => file.path)).not.toContain('main-later.txt')
  })

  it('reports an unknown base in the classic review instead of showing no changes', async () => {
    await expect(new GitService().buildDiff(root, 'origin/main', true)).rejects.toThrow()
  })

  it('treats a linked worktree as the same repository, and an unrelated one as not', async () => {
    const { sameRepository, gitCommonDir } = await import('../../electron/main/services/git-common-dir')
    const { worktreeOrWorkspaceRoot } = await import('../../electron/main/ipc/file-system.ipc')
    expect(sameRepository(root, tree)).toBe(true)
    // File reads may target another worktree of the workspace's repository, and nothing else.
    expect(worktreeOrWorkspaceRoot(root, tree)).toBe(tree)
    expect(worktreeOrWorkspaceRoot(root, root)).toBe(root)
    const other = mkdtempSync(join(tmpdir(), 'oxe-git-other-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: other })
      expect(sameRepository(root, other)).toBe(false)
      expect(worktreeOrWorkspaceRoot(root, other)).toBe(root)
      expect(worktreeOrWorkspaceRoot(root, tmpdir())).toBe(root)
      expect(gitCommonDir(join(other, 'missing'))).toBeNull()
    } finally { removeTempDir(other) }
  })
})

describe('GitService.getDiffSummary with untracked files', () => {
  let root = ''
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'oxe-git-untracked-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(join(root, 'tracked.txt'), 'one\n')
    writeFileSync(join(root, '.gitignore'), 'ignored.log\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'brand-new.ts'), 'a\nb\nc\n')
    writeFileSync(join(root, 'no-newline.txt'), 'x')
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]))
    writeFileSync(join(root, 'ignored.log'), 'noise\n')
  })
  afterAll(() => { removeTempDir(root) })

  it('lists files the agent created but did not stage, as added files', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', true)
    const byPath = Object.fromEntries(summary.files.map(file => [file.path, file]))
    expect(byPath['src/brand-new.ts']).toMatchObject({ status: 'A', additions: 3, deletions: 0, binary: false })
    expect(byPath['no-newline.txt']).toMatchObject({ status: 'A', additions: 1 })
    expect(byPath['blob.bin']).toMatchObject({ status: 'A', binary: true })
    expect(byPath['ignored.log']).toBeUndefined()
    expect(summary.additions).toBe(4)
  })

  it('does not list them when uncommitted work is left out', async () => {
    const summary = await new GitService().getDiffSummary(root, 'main', false)
    expect(summary.files).toEqual([])
  })

  it('presents an untracked file as new when its base content is requested', async () => {
    expect(await new GitService().getFileOriginal(root, 'main', 'src/brand-new.ts')).toMatchObject({ missing: true, content: '' })
  })
})
