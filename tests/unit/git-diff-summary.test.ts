import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

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
