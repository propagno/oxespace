/**
 * Builds one merge-train batch of docs- and tests-only pull requests, run locally by a maintainer with their own
 * `gh` login (the train's GITHUB_TOKEN cannot open pull requests, and that repository setting stays off).
 *
 *   node scripts/merge-batch.mjs --dry-run      prints the batch it would build, changes nothing
 *   node scripts/merge-batch.mjs                builds it
 *   options: --max N (default 5, at least 2), --exclude 12,34, --include-head, --repo owner/name
 *
 * What it does, all through the GitHub API (no local git, so the checkout it runs in is never touched):
 * 1. Reads the queue (open PRs labelled na-fila, oldest labelling first, like the train) and picks the oldest PRs
 *    whose every changed file is documentation or test code (isBatchablePath), up to --max. Never a draft,
 *    a fork, a PR on another base, a batch, a fix-main car or one labelled no-batch. The queue's first car is
 *    skipped unless --include-head: the train may be testing it right now.
 * 2. Creates train/batch-N from main and merges each picked head into it (a merge commit per PR, so each PR closes
 *    as merged when the batch lands). A head that conflicts is left out and stays in the queue on its own.
 * 3. With two or more merged, opens the batch PR, labels it na-fila, and takes the members out of the queue with
 *    a comment that names the batch. With fewer, it deletes the branch and changes nothing else.
 * If the batch fails: close it, relabel the members, and they go one by one (or label the suspect no-batch first).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FIX_MAIN_LABEL, isDocsOnlyPath, LABEL, orderQueue } from './merge-train.mjs'

export const BATCH_PREFIX = 'train/batch-'
export const NO_BATCH_LABEL = 'no-batch'
export const DEFAULT_MAX = 5
/** GitHub lists at most 3000 files of a pull request: a longer list is never batched. */
export const MAX_LISTED_FILES = 3000
export const COMMENT_PREFIX = 'merge-batch:'

/** App code: a Markdown file under these may be bundled or read by the app, so it never rides a batch. */
const APP_ROOTS = ['src/', 'electron/', 'shared/']

/**
 * A path a batch may carry: documentation (docs/**, .claude/**, or Markdown outside the app's code) or test code
 * (tests/**, e2e/**). Wider than the train's docs-only rule, which decides when CI can be skipped: a batch always
 * runs the full CI, so docs a test reads (README.md, docs/**) are fine here.
 */
export function isBatchablePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return false
  if (isDocsOnlyPath(path) || path.startsWith('tests/') || path.startsWith('e2e/')) return true
  if (APP_ROOTS.some((root) => path.startsWith(root))) return false
  return path.startsWith('docs/') || path.startsWith('.claude/') || path.endsWith('.md')
}

/**
 * Why a PR may not join a batch, or null when it may.
 * pr: { number, draft, isFork, baseRef, headRef, labels: string[], files: string[] | null }
 */
export function batchRefusal(pr, { base = 'main' } = {}) {
  if (pr.draft) return 'draft'
  if (pr.isFork) return 'from a fork'
  if (pr.baseRef !== base) return `base is ${pr.baseRef}`
  if (String(pr.headRef ?? '').startsWith(BATCH_PREFIX)) return 'is a batch'
  const labels = pr.labels ?? []
  if (labels.includes(FIX_MAIN_LABEL)) return FIX_MAIN_LABEL
  if (labels.includes(NO_BATCH_LABEL)) return NO_BATCH_LABEL
  if (!Array.isArray(pr.files) || pr.files.length === 0) return 'no file list'
  if (pr.files.length >= MAX_LISTED_FILES) return 'too many files to list'
  const other = pr.files.find((path) => !isBatchablePath(path))
  return other ? `changes ${other}` : null
}

/**
 * The batch: the oldest eligible PRs in queue order, at most `max`. Empty when fewer than two qualify.
 * queue: [{ number, labeledAt }] (any order); pulls: Map<number, pr> as batchRefusal takes.
 * Returns { members: number[], skipped: [{ number, reason }] }.
 */
export function selectBatch(queue, pulls, { max = DEFAULT_MAX, exclude = [], includeHead = false, base = 'main' } = {}) {
  const ordered = orderQueue(queue)
  const members = []
  const skipped = []
  ordered.forEach((entry, index) => {
    const pr = pulls.get(entry.number)
    let reason = null
    if (index === 0 && !includeHead) reason = 'first car (the train may be testing it)'
    else if (exclude.includes(entry.number)) reason = 'excluded'
    else if (!pr) reason = 'not found'
    else if (members.length >= max) reason = 'batch full'
    else reason = batchRefusal(pr, { base })
    if (reason) skipped.push({ number: entry.number, reason })
    else members.push(entry.number)
  })
  return members.length >= 2 ? { members, skipped } : { members: [], skipped }
}

/** The next batch number after every train/batch-N branch and PR head seen. */
export function nextBatchNumber(refs) {
  let max = 0
  for (const ref of refs) {
    const m = new RegExp(`(?:^|/)${BATCH_PREFIX.replace('/', '\\/')}(\\d+)$`).exec(String(ref))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export function renderBatchBody(number, members, titles) {
  const lines = members.map((n) => `- #${n} ${titles.get(n) ?? ''}`.trimEnd())
  return [
    `Batch ${number} of docs- and tests-only pull requests, built by \`scripts/merge-batch.mjs\`. Each head is merged`,
    'onto main with its own merge commit, so each PR closes as merged when this lands.',
    '',
    ...lines,
    '',
    'If this batch fails: close it and relabel the members `na-fila`; they then go one by one.',
  ].join('\n')
}

export function parseArgs(argv) {
  const options = { dryRun: false, max: DEFAULT_MAX, exclude: [], includeHead: false, repo: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--include-head') options.includeHead = true
    else if (arg === '--max') options.max = Number(argv[++i])
    else if (arg === '--exclude') options.exclude = String(argv[++i] ?? '').split(',').filter(Boolean).map(Number)
    else if (arg === '--repo') options.repo = argv[++i]
    else throw new Error(`unknown option ${arg}`)
  }
  if (!Number.isInteger(options.max) || options.max < 2) throw new Error('--max must be an integer of at least 2')
  if (options.exclude.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error('--exclude takes PR numbers, comma-separated')
  if (options.repo !== null && !/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error('--repo must be owner/name')
  return options
}

/** `gh api` with the person's own login. Returns parsed JSON (null when empty). */
function gh(args, { input } = {}) {
  const out = execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  return out.trim() ? JSON.parse(out) : null
}
const ghPaged = (path) => gh(['api', '--paginate', '--slurp', path]).flat()

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const repo = options.repo ?? gh(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner
  const r = `repos/${repo}`
  const base = 'main'

  const issues = ghPaged(`${r}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`).filter((i) => i.pull_request)
  const queue = []
  const pulls = new Map()
  const titles = new Map()
  for (const issue of issues) {
    const events = ghPaged(`${r}/issues/${issue.number}/events?per_page=100`)
    const last = events.filter((e) => e.event === 'labeled' && e.label?.name === LABEL).at(-1)
    queue.push({ number: issue.number, labeledAt: last?.created_at ?? null })
    const pr = gh(['api', `${r}/pulls/${issue.number}`])
    const files = ghPaged(`${r}/pulls/${issue.number}/files?per_page=100`).map((f) => f.filename)
    titles.set(issue.number, pr.title)
    pulls.set(issue.number, {
      number: issue.number,
      draft: Boolean(pr.draft),
      isFork: pr.head?.repo?.full_name !== repo,
      baseRef: pr.base?.ref,
      headRef: pr.head?.ref,
      headSha: pr.head?.sha,
      labels: (pr.labels ?? []).map((l) => l.name),
      files,
    })
  }
  const { members, skipped } = selectBatch(queue, pulls, { ...options, base })
  for (const s of skipped) console.log(`  skip #${s.number}: ${s.reason}`)
  if (!members.length) {
    console.log('No batch: fewer than two queued PRs are docs- or tests-only.')
    return
  }
  const refs = (gh(['api', `${r}/git/matching-refs/heads/${BATCH_PREFIX}`]) ?? []).map((x) => x.ref)
  const batchPrs = gh(['pr', 'list', '--repo', repo, '--state', 'all', '--search', `head:${BATCH_PREFIX}`, '--limit', '100', '--json', 'headRefName'])
  const number = nextBatchNumber([...refs, ...batchPrs.map((p) => p.headRefName)])
  const branch = `${BATCH_PREFIX}${number}`
  console.log(`Batch ${number} (${branch}): ${members.map((n) => `#${n}`).join(' ')}`)
  if (options.dryRun) {
    for (const n of members) console.log(`  #${n} ${titles.get(n)}`)
    console.log('Dry run: nothing changed.')
    return
  }

  const mainSha = gh(['api', `${r}/git/ref/heads/${base}`]).object.sha
  gh(['api', '-X', 'POST', `${r}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${mainSha}`])
  const merged = []
  for (const n of members) {
    const pr = pulls.get(n)
    try {
      gh(['api', '-X', 'POST', `${r}/merges`, '-f', `base=${branch}`, '-f', `head=${pr.headSha}`, '-f', `commit_message=Merge PR #${n} into batch ${number}`])
      merged.push(n)
    } catch (error) {
      console.log(`  #${n} left out (does not merge cleanly): ${String(error.stderr ?? error.message).trim().split('\n')[0]}`)
    }
  }
  if (merged.length < 2) {
    gh(['api', '-X', 'DELETE', `${r}/git/refs/heads/${branch}`])
    console.log(`Only ${merged.length} merged cleanly: ${branch} deleted, nothing else changed.`)
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'merge-batch-'))
  try {
    const bodyFile = join(dir, 'body.md')
    writeFileSync(bodyFile, renderBatchBody(number, merged, titles))
    const title = `train: batch ${number} (${merged.map((n) => `#${n}`).join(' ')})`
    const url = execFileSync('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', title, '--body-file', bodyFile], { encoding: 'utf8' }).trim()
    const batchNumber = Number(url.split('/').pop())
    execFileSync('gh', ['pr', 'edit', String(batchNumber), '--repo', repo, '--add-label', LABEL])
    for (const n of merged) {
      const note = join(dir, `note-${n}.md`)
      writeFileSync(note, `${COMMENT_PREFIX} in batch #${batchNumber}, which merges this PR with it. Out of the queue until then; if the batch fails it comes back.`)
      execFileSync('gh', ['pr', 'comment', String(n), '--repo', repo, '--body-file', note])
      execFileSync('gh', ['pr', 'edit', String(n), '--repo', repo, '--remove-label', LABEL])
    }
    console.log(`Opened ${url}, labelled ${LABEL}; members unlabelled.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stderr ? String(error.stderr) : error)
    process.exitCode = 1
  })
}
