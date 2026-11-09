/**
 * `npm run release` (agents maturity M7): the steps of a patch release cut from an older tag, as done by hand for
 * 1.4.2 and 1.4.3 (.claude/roadmap-1.4/team/estado/rodadas.log). One step per call, in this order:
 *
 *   npm run release -- status     <version>                  what is done and what is missing (reads only)
 *   npm run release -- cut        <version> --from <vX.Y.Z>  release/<version> from that tag
 *   npm run release -- pick       <version> <sha>...         cherry-pick -x onto release/<version>
 *   npm run release -- trial      <version>                  merge/release-<version>-into-main + main's jobs on it
 *   npm run release -- tag        <version>                  tag v<version> on the release head
 *   npm run release -- approve    <version>                  approve the `release`, then `android-release` deployment
 *   npm run release -- verify-apk <version>                  the published APK: sha256, signer, version
 *
 * Every step that writes (a branch, a pick, a push, a dispatch, the tag, an approval) prints its plan and does
 * nothing unless `--run` is given. The reads (fetch, the API, the checks) always run.
 *
 * Who runs what: the tag and the approvals are for the people the user delegated releases to (the TECH LEAD and
 * the coordinator, team/delegation.md), with the user's OK for that version. They need --run typed in a terminal:
 * under CI they refuse. The script checks the release's conditions, it does not grant them.
 *
 * It never deletes a branch or a tag, not even to undo a step: it prints the command for a person instead. `trial`
 * works in a worktree of its own under the temp folder, never in the checkout it runs from.
 *
 * The rules it keeps, each learnt on 1.4.2 or 1.4.3:
 * - A pick that adds or changes snapshot images is refused: the images belong to main's design, not the release
 *   tree's. Ask MOBILE (or FRONTEND) for a twin PR re-recorded on the release branch (#637).
 * - A stable tag must be on main (ci.yml refuses it otherwise), so the release branch goes back to main by a
 *   hand-merged PR, never the train (its update-branch would pull main into the tagged tree). `trial` builds that
 *   merge first: snapshot conflicts take main's images, and the release's other image changes are listed for a
 *   re-record. Main's jobs then run on it before the PR (feedback_release_branch_goldens).
 * - The tag goes on the release head, and only after that head is on main and has a green completed CI run.
 * - The APK is the one the project's key signed: its certificate digest is the one published in the 1.4.0 notes.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { withNetworkRetry } from './pr-ready.mjs'

/** mobile/android/RELEASING.md: the release key's certificate, as `apksigner` prints it. */
export const SIGNER_DIGEST = 'cc65d90afa2fde6518adad92d40769496a043b901f603eff0562e056cd4336e4'
export const CI_WORKFLOW = '.github/workflows/ci.yml'
export const ENVIRONMENTS = ['release', 'android-release']
/** What main runs on a change, dispatched on the trial merge. */
export const MAIN_JOBS = [
  { file: 'ci.yml' },
  { file: 'android.yml' },
  { file: 'visual-regression.yml' },
  { file: 'android-emulator.yml', inputs: { 'api-level': '36' } },
]
export const SNAPSHOT_IMAGE = /(^|\/)(__screenshots__|__snapshots__|snapshots)\/.+\.png$/

export const releaseBranch = version => `release/${version}`
export const trialBranch = version => `merge/release-${version}-into-main`
export const tagOf = version => `v${version}`

export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? ''))
  if (!match) throw new Error(`"${text}" is not a stable version X.Y.Z`)
  const [major, minor, patch] = match.slice(1).map(Number)
  return { version: `${major}.${minor}.${patch}`, major, minor, patch }
}

/** mobile/android/app/build.gradle.kts versionCodeOf: 1.4.3 → 10403. */
export const versionCodeOf = ({ major, minor, patch }) => major * 10000 + minor * 100 + patch

const lines = text => String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean)

export const snapshotImages = files => files.filter(file => SNAPSHOT_IMAGE.test(file))

/** A pick is refused when the commit adds or changes snapshot images (`git show --name-status` lines). */
export function pickCheck(sha, nameStatus) {
  const touched = nameStatus.split('\n').map(line => line.trim().split(/\s+/)).filter(([status]) => /^[AMRC]/.test(status ?? ''))
    .map(parts => parts[parts.length - 1])
  const images = snapshotImages(touched)
  return images.length === 0
    ? { ok: true, sha }
    : { ok: false, sha, images, reason: `${sha.slice(0, 8)} adds or changes ${images.length} snapshot image(s): ask for a twin PR re-recorded on the release branch` }
}

/** The trial merge's conflicts: snapshot images take main's version, anything else is for a person. */
export function splitConflicts(files) {
  const images = snapshotImages(files)
  return { images, others: files.filter(file => !images.includes(file)) }
}

/** `apksigner verify --print-certs` → the first signer's SHA-256 digest. */
export function signerDigest(output) {
  return /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(String(output))?.[1]?.toLowerCase() ?? null
}

/** `aapt2 dump badging` → versionName and versionCode. */
export function badging(output) {
  const text = String(output)
  return { versionName: /versionName='([^']*)'/.exec(text)?.[1] ?? null, versionCode: Number(/versionCode='(\d+)'/.exec(text)?.[1]) || null }
}

/** The `.sha256` file's first word (sha256sum's format: "<hex>  <name>"). */
export const sha256Of = text => /^([0-9a-f]{64})\b/i.exec(String(text).trim())?.[1]?.toLowerCase() ?? null

/** The APK checks: what the release says, what the file is, who signed it, which version it is. */
export function apkFindings({ expectedSha, actualSha, digest, versionName, versionCode }, parsed) {
  const findings = []
  if (!expectedSha) findings.push('the release has no readable .sha256 asset')
  else if (expectedSha !== actualSha) findings.push(`sha256 ${actualSha} does not match the release's ${expectedSha}`)
  if (digest !== SIGNER_DIGEST) findings.push(`signer digest ${digest ?? '(none)'} is not the project's key ${SIGNER_DIGEST}`)
  if (versionName !== parsed.version) findings.push(`versionName ${versionName ?? '(none)'} is not ${parsed.version}`)
  if (versionCode !== versionCodeOf(parsed)) findings.push(`versionCode ${versionCode ?? '(none)'} is not ${versionCodeOf(parsed)}`)
  return findings
}

/** The newest completed CI run on that sha, and whether its "CI result" passed. */
export function ciVerdict(runs, sha) {
  // `name` is the run's title ("Full check · …"); the workflow is its file.
  const completed = runs.filter(run => run.path === CI_WORKFLOW && run.head_sha === sha && run.status === 'completed')
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const latest = completed[0]
  return latest ? { run: latest.id, ok: latest.conclusion === 'success', event: latest.event } : { run: null, ok: false }
}

/**
 * The tag's conditions on the release head. `state`: { head, onMain, tagExists, packageVersion, notes: [paths],
 * ci: ciVerdict }. Each failure is a sentence; an empty list means the tag may go.
 */
export function tagFindings(parsed, state) {
  const findings = []
  if (!state.head) findings.push(`${releaseBranch(parsed.version)} is not on origin`)
  if (state.tagExists) findings.push(`${tagOf(parsed.version)} already exists: a published tag is never moved`)
  if (state.packageVersion !== parsed.version) findings.push(`package.json on the release head says ${state.packageVersion ?? '(none)'}, not ${parsed.version}`)
  for (const note of [`docs/releases/${parsed.version}.md`, `docs/releases/${parsed.version}.pt-BR.md`]) {
    if (!state.notes?.includes(note)) findings.push(`${note} is missing on the release head`)
  }
  if (state.head && !state.onMain) findings.push(`the release head ${state.head.slice(0, 8)} is not on main yet: hand-merge the trial PR first (ci.yml refuses a stable tag off main)`)
  if (state.head && !state.ci?.run) findings.push(`no completed ci.yml run on ${state.head.slice(0, 8)}`)
  else if (state.head && !state.ci.ok) findings.push(`the latest ci.yml run on ${state.head.slice(0, 8)} (${state.ci.run}) did not pass`)
  return findings
}

/** The deployments to approve now, in order: `release` first, `android-release` only after it. */
export function approvals(pending, tagSha) {
  return pending.filter(item => item.sha === tagSha && ENVIRONMENTS.includes(item.environment))
    .sort((a, b) => ENVIRONMENTS.indexOf(a.environment) - ENVIRONMENTS.indexOf(b.environment))
}

export function parseArgs(argv) {
  const args = { step: argv[0], version: null, from: null, shas: [], run: false }
  const rest = argv.slice(1)
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--run') args.run = true
    else if (arg === '--from') args.from = rest[++i]
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else if (!args.version) args.version = arg
    else args.shas.push(arg)
  }
  if (!STEPS[args.step]) throw new Error(`the step is one of: ${Object.keys(STEPS).join(', ')}`)
  if (!args.version) throw new Error('give the version, X.Y.Z')
  return args
}

// ---- I/O ------------------------------------------------------------------------------------------------------

const NETWORK = new Set(['fetch', 'push', 'ls-remote', 'pull'])

function makeIo(run) {
  const exec = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options })
  const net = (cmd, args) => withNetworkRetry(() => exec(cmd, args), { log: line => console.error(line) })
  const git = args => (NETWORK.has(args[0]) ? net('git', args) : exec('git', args))
  const gh = args => net('gh', args)
  const tryGit = args => { try { return git(args).trim() } catch { return null } }
  return {
    run,
    git, gh, tryGit,
    exec,
    log: line => console.log(line),
    /** A write: printed always, done only with --run. */
    write(label, fn) {
      console.log(`${run ? '→' : '[plan]'} ${label}`)
      return run ? fn() : undefined
    },
    repo: () => gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim(),
  }
}

function remoteHead(io, branch) {
  return io.git(['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s/)[0] || null
}

function tagCommit(io, tag) {
  const lines = io.git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).trim().split('\n').filter(Boolean)
  const peeled = lines.find(line => line.endsWith('^{}')) ?? lines[0]
  return peeled ? peeled.split(/\s/)[0] : null
}

function runsOn(io, repo, sha) {
  return JSON.parse(io.gh(['api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`, '--jq', '.workflow_runs'])) ?? []
}

function tagState(io, parsed) {
  const branch = releaseBranch(parsed.version)
  io.git(['fetch', '--quiet', 'origin', 'main', branch])
  const head = io.tryGit(['rev-parse', `origin/${branch}`])
  if (!head) return { head: null }
  const repo = io.repo()
  let packageVersion = null
  try { packageVersion = JSON.parse(io.git(['show', `${head}:package.json`])).version } catch { /* reported as missing */ }
  return {
    head,
    onMain: io.tryGit(['merge-base', '--is-ancestor', head, 'origin/main']) !== null,
    tagExists: Boolean(tagCommit(io, tagOf(parsed.version))),
    packageVersion,
    notes: io.git(['ls-tree', '--name-only', head, 'docs/releases/']).split('\n').map(line => line.trim()).filter(Boolean),
    ci: ciVerdict(runsOn(io, repo, head), head),
  }
}

// ---- steps ----------------------------------------------------------------------------------------------------

function status(io, parsed) {
  const state = tagState(io, parsed)
  const tag = tagOf(parsed.version)
  io.log(`${releaseBranch(parsed.version)}: ${state.head ?? '(not on origin)'}`)
  if (!state.head) return 1
  io.log(`on main: ${state.onMain ? 'yes' : 'no'} · CI: ${state.ci.run ? `${state.ci.run} ${state.ci.ok ? 'success' : 'not passed'}` : 'none completed'} · ${tag}: ${state.tagExists ? 'exists' : 'not yet'}`)
  const findings = state.tagExists ? [] : tagFindings(parsed, state)
  for (const finding of findings) io.log(`  - ${finding}`)
  if (!state.tagExists && findings.length === 0) io.log(`ready to tag: npm run release -- tag ${parsed.version} --run`)
  return 0
}

function cut(io, parsed, from) {
  if (!from) throw new Error('give the tag to cut from: --from vX.Y.Z')
  const branch = releaseBranch(parsed.version)
  const base = tagCommit(io, tagOf(parseVersion(from).version))
  if (!base) throw new Error(`${from} is not a tag on origin`)
  if (remoteHead(io, branch)) throw new Error(`${branch} already exists on origin`)
  io.git(['fetch', '--quiet', 'origin', `refs/tags/${tagOf(parseVersion(from).version)}:refs/tags/${tagOf(parseVersion(from).version)}`])
  io.write(`git branch ${branch} ${base.slice(0, 8)} (${from})`, () => io.git(['branch', branch, base]))
  io.write(`git push origin ${branch}`, () => io.git(['push', 'origin', `${branch}:refs/heads/${branch}`]))
  io.log(`next: npm run release -- pick ${parsed.version} <sha>... (each one merged to main first), then the version bump and docs/releases/${parsed.version}{,.pt-BR}.md`)
  return 0
}

function pick(io, parsed, shas) {
  if (shas.length === 0) throw new Error('give the commits to pick')
  const branch = releaseBranch(parsed.version)
  io.git(['fetch', '--quiet', 'origin', 'main', branch])
  const checks = shas.map(sha => pickCheck(sha, io.git(['show', '--name-status', '--format=', '-m', '--first-parent', sha])))
  const refused = checks.filter(check => !check.ok)
  for (const check of refused) io.log(`refused: ${check.reason}\n  ${check.images.join('\n  ')}`)
  if (refused.length) return 1
  const current = io.tryGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (io.run && current !== branch) throw new Error(`check out ${branch} in this worktree first (it is on ${current}); the script never switches branches`)
  for (const sha of shas) {
    const merge = io.git(['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').length > 2
    io.write(`git cherry-pick -x ${merge ? '-m 1 ' : ''}${sha.slice(0, 8)}`, () => io.git(['cherry-pick', '-x', ...(merge ? ['-m', '1'] : []), sha]))
  }
  io.write(`git push origin ${branch}`, () => io.git(['push', 'origin', `HEAD:refs/heads/${branch}`]))
  return 0
}

function trial(io, parsed) {
  const branch = releaseBranch(parsed.version)
  const merge = trialBranch(parsed.version)
  io.git(['fetch', '--quiet', 'origin', 'main', branch])
  if (!io.tryGit(['rev-parse', `origin/${branch}`])) throw new Error(`${branch} is not on origin`)
  if (remoteHead(io, merge)) throw new Error(`${merge} already exists on origin: continue on it by hand, or ask for it to be deleted`)
  const changed = lines(io.git(['diff', '--name-only', `origin/main...origin/${branch}`]))
  const releaseImages = snapshotImages(changed)
  if (releaseImages.length) io.log(`the release changes ${releaseImages.length} snapshot image(s) that main has newer: re-record them on ${merge} (MOBILE/FRONTEND) before the PR:\n  ${releaseImages.join('\n  ')}`)
  // A worktree of its own: the merge never switches the branch of the checkout this runs from.
  const dir = join(tmpdir(), `oxespace-${merge.replace(/\//g, '-')}-${process.pid}`)
  if (!io.run) {
    io.log(`[plan] git worktree add -b ${merge} <temp> origin/main; git merge --no-ff origin/${branch}; snapshot conflicts take main's; push`)
    for (const job of MAIN_JOBS) io.log(`[plan] gh workflow run ${job.file} --ref ${merge}`)
    io.log(`[plan] then the PR ${merge} → main, hand-merged with a merge commit (never the train)`)
    return 0
  }
  if (existsSync(dir)) throw new Error(`${dir} already exists; the trial adds only a worktree of its own`)
  io.git(['worktree', 'add', '-b', merge, dir, 'origin/main'])
  io.log(`→ ${merge} from origin/main in ${dir}`)
  // Never deleted here: a person discards a stopped trial.
  const discard = `to discard it: git worktree remove ${dir} && git branch -D ${merge}`
  const at = args => io.git(['-C', dir, ...args])
  const conflicts = (() => {
    try {
      at(['merge', '--no-ff', '--no-edit', `origin/${branch}`])
      return []
    } catch {
      return lines(at(['diff', '--name-only', '--diff-filter=U']))
    }
  })()
  const { images, others } = splitConflicts(conflicts)
  for (const file of images) at(['checkout', '--ours', '--', file])
  if (images.length) at(['add', '--', ...images])
  if (others.length) {
    io.log(`stopped: ${others.length} conflict(s) need a person; the merge is left open in ${dir}:\n  ${others.join('\n  ')}\n${discard}`)
    return 1
  }
  if (conflicts.length) at(['commit', '--no-edit'])
  try {
    io.git(['push', 'origin', `${merge}:refs/heads/${merge}`])
  } catch (error) {
    io.log(`the push failed; the merge stays in ${dir}. ${discard}`)
    throw error
  }
  io.log(`→ pushed ${merge}${images.length ? ` (${images.length} snapshot conflict(s) took main's images)` : ''}`)
  io.git(['worktree', 'remove', dir]) // the one this trial added, now pushed; its branch stays
  for (const job of MAIN_JOBS) {
    const inputs = Object.entries(job.inputs ?? {}).flatMap(([key, value]) => ['-f', `${key}=${value}`])
    io.gh(['workflow', 'run', job.file, '--ref', merge, ...inputs])
    io.log(`→ dispatched ${job.file} on ${merge}`)
  }
  io.log(`next: when every job is green, the PR ${merge} → main, hand-merged with a merge commit (never the train)`)
  return 0
}

function tag(io, parsed) {
  const state = tagState(io, parsed)
  const findings = tagFindings(parsed, state)
  for (const finding of findings) io.log(`not yet: ${finding}`)
  if (findings.length) return 1
  const name = tagOf(parsed.version)
  io.write(`git tag -a ${name} ${state.head.slice(0, 8)} (CI ${state.ci.run} success, on main)`, () => io.git(['tag', '-a', name, state.head, '-m', `OXESpace ${parsed.version}`]))
  io.write(`git push origin refs/tags/${name}`, () => io.git(['push', 'origin', `refs/tags/${name}`]))
  io.log(`next: npm run release -- approve ${parsed.version} when the tag run reaches the release deployment`)
  return 0
}

function approve(io, parsed) {
  const name = tagOf(parsed.version)
  const sha = tagCommit(io, name)
  if (!sha) throw new Error(`${name} is not a tag on origin`)
  const repo = io.repo()
  const waiting = runsOn(io, repo, sha).filter(run => run.status === 'waiting')
  const pending = waiting.flatMap(run => JSON.parse(io.gh(['api', `repos/${repo}/actions/runs/${run.id}/pending_deployments`]))
    .map(item => ({ run: run.id, sha: run.head_sha, environment: item.environment?.name, environmentId: item.environment?.id, canApprove: item.current_user_can_approve })))
  const next = approvals(pending, sha)
  if (next.length === 0) {
    io.log(`nothing waits on ${name} (${sha.slice(0, 8)}) in ${ENVIRONMENTS.join(' or ')}`)
    return 0
  }
  const item = next[0]
  if (!item.canApprove) throw new Error(`run ${item.run} waits on ${item.environment}, and this account may not approve it`)
  io.write(`approve ${item.environment} on run ${item.run} (${name} ${sha.slice(0, 8)})`, () => io.gh(['api', '-X', 'POST', `repos/${repo}/actions/runs/${item.run}/pending_deployments`,
    '-F', `environment_ids[]=${item.environmentId}`, '-f', 'state=approved', '-f', `comment=${name}: npm run release -- approve`]))
  if (item.environment === 'release') io.log(`next: when the desktop is published, android-release starts; approve it the same way, then verify-apk ${parsed.version}`)
  else io.log(`next: npm run release -- verify-apk ${parsed.version}`)
  return 0
}

/** The newest build-tools folder that has the tool. */
export function buildTool(name, env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android', 'Sdk'))
  const root = sdk && join(sdk, 'build-tools')
  if (!root || !existsSync(root)) return null
  const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of versions) {
    for (const file of process.platform === 'win32' ? [`${name}.bat`, `${name}.exe`] : [name]) {
      if (existsSync(join(root, version, file))) return join(root, version, file)
    }
  }
  return null
}

function verifyApk(io, parsed) {
  const name = tagOf(parsed.version)
  const apk = `oxespace-android-${name}.apk`
  const dir = join(tmpdir(), `oxespace-verify-${name}-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    io.gh(['release', 'download', name, '--pattern', apk, '--pattern', `${apk}.sha256`, '--dir', dir])
    const apksigner = buildTool('apksigner')
    const aapt2 = buildTool('aapt2')
    if (!apksigner || !aapt2) throw new Error('apksigner and aapt2 come from the Android SDK build-tools; set ANDROID_HOME')
    const shell = process.platform === 'win32' && apksigner.endsWith('.bat')
    const signer = io.exec(apksigner, ['verify', '--print-certs', join(dir, apk)], { shell })
    const facts = {
      expectedSha: sha256Of(readFileSync(join(dir, `${apk}.sha256`), 'utf8')),
      actualSha: createHash('sha256').update(readFileSync(join(dir, apk))).digest('hex'),
      digest: signerDigest(signer),
      ...badging(io.exec(aapt2, ['dump', 'badging', join(dir, apk)])),
    }
    const findings = apkFindings(facts, parsed)
    io.log(`${apk}: sha256 ${facts.actualSha} · signer ${facts.digest?.slice(0, 8)}…${facts.digest?.slice(-4)} · ${facts.versionName} (${facts.versionCode})`)
    for (const finding of findings) io.log(`FAIL: ${finding}`)
    if (findings.length === 0) io.log('APK verified: the release sha256, the project key, the version.')
    return findings.length ? 1 : 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const STEPS = {
  status: (io, args) => status(io, parseVersion(args.version)),
  cut: (io, args) => cut(io, parseVersion(args.version), args.from),
  pick: (io, args) => pick(io, parseVersion(args.version), args.shas),
  trial: (io, args) => trial(io, parseVersion(args.version)),
  tag: (io, args) => tag(io, parseVersion(args.version)),
  approve: (io, args) => approve(io, parseVersion(args.version)),
  'verify-apk': (io, args) => verifyApk(io, parseVersion(args.version)),
}

/** The tag and the approvals are a person's step: --run typed in a terminal, never from CI. */
export const PERSON_STEPS = ['tag', 'approve']
export function refuseUnattended(args, env = process.env) {
  if (args.run && PERSON_STEPS.includes(args.step) && (env.CI || env.GITHUB_ACTIONS)) {
    throw new Error(`${args.step} --run is for the TECH LEAD or the coordinator in their terminal, not for CI`)
  }
}

export function main(argv, io, env = process.env) {
  const args = parseArgs(argv)
  refuseUnattended(args, env)
  return STEPS[args.step](io ?? makeIo(args.run), args)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`release: ${error.message}`)
    process.exitCode = 1
  }
}
