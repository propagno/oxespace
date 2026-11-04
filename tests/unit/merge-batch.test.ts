// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  batchRefusal,
  isBatchablePath,
  MAX_LISTED_FILES,
  nextBatchNumber,
  NO_BATCH_LABEL,
  parseArgs,
  renderBatchBody,
  selectBatch,
} from '../../scripts/merge-batch.mjs'

const pr = (number: number, files: string[], extra: Record<string, unknown> = {}) => ({
  number,
  draft: false,
  isFork: false,
  baseRef: 'main',
  headRef: `topic-${number}`,
  labels: ['na-fila'],
  files,
  ...extra,
})
const at = (minute: number) => `2026-11-03T10:${String(minute).padStart(2, '0')}:00Z`

describe('isBatchablePath', () => {
  it('is the train’s batch allowlist: documentation, docs a test reads included (a batch runs the full CI), tests and e2e specs', () => {
    for (const path of ['docs/guide/setup.pt.md', 'docs/ci-cd.md', 'README.md', '.claude/notes.md', 'CHANGELOG.md', 'docs/screens/a.png', 'tests/unit/x.test.ts', 'e2e/thread-view.spec.ts'])
      expect(isBatchablePath(path), path).toBe(true)
  })
  it('refuses app code (Markdown in it too), config, workflows, scripts, lockfiles, android and e2e helpers', () => {
    for (const path of ['src/App.tsx', 'electron/main/index.ts', 'shared/x.ts', 'package.json', 'package-lock.json', '.github/workflows/ci.yml', 'scripts/merge-train.mjs', 'mobile/android/app/build.gradle.kts', 'mobile/android/RELEASING.md', 'e2e/helpers/launch.ts', 'src/ui/README.md', 'electron/main/x/NOTES.md', 'vitest.config.ts', 'THIRD_PARTY_NOTICES'])
      expect(isBatchablePath(path), path).toBe(false)
  })
  it('refuses odd paths', () => {
    for (const path of ['', '/etc/passwd', 'tests/../src/x.ts', 'docs\\x.md', null, undefined, 42])
      expect(isBatchablePath(path as string)).toBe(false)
  })
})

describe('batchRefusal', () => {
  it('accepts a docs and tests PR', () => {
    expect(batchRefusal(pr(1, ['docs/plans/a.md', 'tests/unit/a.test.ts']))).toBeNull()
  })
  it('names why a PR stays out', () => {
    expect(batchRefusal(pr(1, ['docs/plans/a.md'], { draft: true }))).toBe('draft')
    expect(batchRefusal(pr(1, ['docs/plans/a.md'], { isFork: true }))).toBe('from a fork')
    expect(batchRefusal(pr(1, ['docs/plans/a.md'], { baseRef: 'release' }))).toBe('base is release')
    expect(batchRefusal(pr(1, ['docs/plans/a.md'], { headRef: 'train/batch-7' }))).toBe('is a batch')
    expect(batchRefusal(pr(1, ['docs/plans/a.md'], { labels: ['na-fila', 'fix-main'] }))).toBe('fix-main')
    expect(batchRefusal(pr(1, ['docs/plans/a.md'], { labels: ['na-fila', NO_BATCH_LABEL] }))).toBe(NO_BATCH_LABEL)
    expect(batchRefusal(pr(1, []))).toBe('no file list')
    expect(batchRefusal(pr(1, null as unknown as string[]))).toBe('no file list')
    expect(batchRefusal(pr(1, Array.from({ length: MAX_LISTED_FILES }, (_, i) => `docs/plans/${i}.md`)))).toBe('too many files to list')
    expect(batchRefusal(pr(1, ['tests/unit/a.test.ts', 'src/a.ts']))).toBe('changes src/a.ts')
  })
})

describe('selectBatch', () => {
  const pulls = new Map([
    [10, pr(10, ['docs/plans/a.md'])],
    [11, pr(11, ['src/a.ts'])],
    [12, pr(12, ['tests/unit/b.test.ts'])],
    [13, pr(13, ['e2e/c.spec.ts', 'docs/plans/c.md'])],
    [14, pr(14, ['docs/plans/d.md'])],
    [15, pr(15, ['docs/plans/e.md'], { draft: true })],
  ])
  const queue = [
    { number: 14, labeledAt: at(5) },
    { number: 10, labeledAt: at(1) },
    { number: 11, labeledAt: at(2) },
    { number: 12, labeledAt: at(3) },
    { number: 13, labeledAt: at(4) },
    { number: 15, labeledAt: at(6) },
  ]

  it('takes the oldest eligible PRs in queue order, skipping the first car', () => {
    const { members, skipped } = selectBatch(queue, pulls)
    expect(members).toEqual([12, 13, 14])
    expect(skipped).toEqual([
      { number: 10, reason: 'first car (the train may be testing it)' },
      { number: 11, reason: 'changes src/a.ts' },
      { number: 15, reason: 'draft' },
    ])
  })
  it('takes the first car with includeHead, and stops at max', () => {
    const { members, skipped } = selectBatch(queue, pulls, { includeHead: true, max: 2 })
    expect(members).toEqual([10, 12])
    expect(skipped).toContainEqual({ number: 13, reason: 'batch full' })
  })
  it('leaves out excluded and unknown PRs', () => {
    const { members, skipped } = selectBatch([...queue, { number: 99, labeledAt: at(7) }], pulls, { exclude: [13] })
    expect(members).toEqual([12, 14])
    expect(skipped).toContainEqual({ number: 13, reason: 'excluded' })
    expect(skipped).toContainEqual({ number: 99, reason: 'not found' })
  })
  it('builds no batch of one', () => {
    expect(selectBatch(queue, pulls, { exclude: [12, 13] }).members).toEqual([])
    expect(selectBatch([], pulls).members).toEqual([])
  })
})

describe('nextBatchNumber', () => {
  it('follows the highest batch seen in refs and PR heads', () => {
    expect(nextBatchNumber(['refs/heads/train/batch-45', 'train/batch-47', 'refs/heads/train/batch-9', 'train/batch-x', 'other'])).toBe(48)
    expect(nextBatchNumber([])).toBe(1)
  })
})

describe('renderBatchBody', () => {
  it('lists each member with its title', () => {
    const body = renderBatchBody(48, [12, 13], new Map([[12, 'test: a'], [13, 'docs: b']]))
    expect(body).toContain('- #12 test: a')
    expect(body).toContain('- #13 docs: b')
    expect(body).toContain('Batch 48')
  })
})

describe('parseArgs', () => {
  it('reads the options', () => {
    expect(parseArgs(['--dry-run', '--max', '3', '--exclude', '12,34', '--include-head', '--repo', 'propagno/oxespace'])).toEqual({
      dryRun: true, max: 3, exclude: [12, 34], includeHead: true, repo: 'propagno/oxespace',
    })
  })
  it('refuses bad values', () => {
    expect(() => parseArgs(['--max', '1'])).toThrow()
    expect(() => parseArgs(['--exclude', 'abc'])).toThrow()
    expect(() => parseArgs(['--repo', 'x; rm -rf /'])).toThrow()
    expect(() => parseArgs(['--force'])).toThrow()
  })
})
