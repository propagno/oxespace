/**
 * Every git the main process runs goes through here (guarded by tests/unit/safe-git-guard.test.ts).
 *
 * The vector (SECURITY S4-1): main runs git inside repositories an agent can write, and a repository's own config
 * can name commands git then runs, with no click and with main's environment: a partial clone lazy-fetches a missing
 * object through `core.sshCommand` or an `ext::` URL, and `core.fsmonitor`, hooks, the pager, textconv and external
 * diff drivers, filter drivers (`filter.<name>.clean` runs on a plain `git status`), merge drivers,
 * `core.alternateRefsCommand`, signing programs and `credential.helper` do the same. `GIT_*` variables in main's
 * environment redirect all of it.
 *
 * Two paths:
 *  - `runGit` / `execGit` / `execGitSync` (this file): local work, never the network. Every `GIT_*` variable is
 *    dropped, lazy fetch is off, every transport is `never` (named one by one, since a repository's
 *    `protocol.<name>.allow` beats the general key), and the fixed command-bearing keys are emptied on the command
 *    line, which beats the repository's config. Driver names (filter, diff, merge) are only in the config, so every
 *    command except a short list that runs nothing first reads the config (`git config`, which runs nothing) and empties
 *    each one a repository set. Those pairs go through `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` (command-line strength), not
 *    `-c`: `-c` splits at the first `=`, and a driver may be named `a=b`.
 *  - `runPersonGit` (safe-git-person.ts): network git the person started. See that file.
 *
 * Check, then act: the read and the command are two processes, so an agent can add a driver in between. Every driver
 * name ever seen in a repository is remembered (this launch) and emptied on every later call there, and the config is
 * read again after a command that read it first; a new command key is reported (`configChanged`, and
 * `onRepositoryConfigChanged`). Names are kept per common git dir, so a linked worktree shares its checkout's set.
 *
 * Known limit: a FRESH driver name an agent adds between the read and the command runs once, in that command; it is
 * then flagged and emptied from the next call on. `--attr-source=<empty tree>` does not close it: git still reads
 * `$GIT_DIR/info/attributes` (agent-writable, and it can name the driver), and dropping the work tree's
 * `.gitattributes` changes what status and diff report (eol/text conversion, `-diff`/binary, the LFS filter), so
 * CRLF and LFS files would show as changed. Also open: the person's own global and system config are trusted (B16
 * is to protect them from agents).
 *
 * System config stays on for these calls: it is admin-only (`GIT_CONFIG_SYSTEM` is dropped with every `GIT_*`), and
 * Git for Windows keeps `core.autocrlf`, `core.symlinks` and the LFS filter there, without which `git status` reports
 * every CRLF file as changed. `safeGitEnv()` itself turns it off by default, for reads of committed objects only.
 */
import { execFile, execFileSync, type ExecFileException } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { devNull } from 'node:os'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { __forgetGitDirsForTests, baseConfigFiles, commonGitDir, gitDirsOf, gitDirsOfSync, sameFiles, stamp, stampOf, type GitDirs } from './git-dir'

/** Every transport git knows; each is denied by name. */
export const GIT_TRANSPORTS = ['ext', 'file', 'ssh', 'git', 'http', 'https'] as const

/** A hooks directory that holds nothing: the null device (`\\.\nul` on Windows), never a folder anyone can fill. */
export const NO_HOOKS_PATH = devNull

const config = (pairs: string[]): string[] => pairs.flatMap(pair => ['-c', pair])

/**
 * Options that hold for every main-process git: no pager, no fsmonitor, no hooks, no external diff and no signature
 * check on log. Shared with the person path. Fixed keys only: no repository-chosen name ever goes through `-c`.
 */
export const GIT_COMMAND_OFF: readonly string[] = ['--no-pager', ...config([
  'core.fsmonitor=', `core.hooksPath=${NO_HOOKS_PATH}`, 'diff.external=', 'log.showSignature=false', 'core.alternateRefsCommand='
])]

/** The local path's options: the common ones, no transport at all, and no credential or askpass program. */
export const SAFE_GIT_OPTIONS: readonly string[] = [...GIT_COMMAND_OFF, ...config([
  'protocol.allow=never', ...GIT_TRANSPORTS.map(name => `protocol.${name}.allow=never`), 'credential.helper=', 'core.askPass='
])]

/** Global options that take their value as the next argument. */
const VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--attr-source'])

/** Index of the subcommand in a git argument list, past the global options; -1 when there is none (`--version`). */
export function subcommandIndex(args: readonly string[]): number {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-')) return index
    if (VALUE_OPTIONS.has(arg)) index++
  }
  return -1
}

/** Subcommands that run textconv or an external diff driver unless told not to. */
const DIFFING = new Set(['diff', 'show', 'log', 'whatchanged'])
/** Subcommands that walk into submodules for dirtiness, where the submodule's own config would apply. */
const SUBMODULE_STATUS = new Set(['diff', 'status'])

/**
 * The local path's arguments: the safe options first, then the subcommand with `--no-ext-diff --no-textconv` where it
 * diffs and `--ignore-submodules=dirty` where it would spawn git inside a submodule.
 */
export function safeGitArgs(args: readonly string[], prefix: readonly string[] = SAFE_GIT_OPTIONS): string[] {
  const at = subcommandIndex(args)
  if (at < 0) return [...prefix, ...args]
  const sub = args[at]
  const added: string[] = []
  if (DIFFING.has(sub)) added.push('--no-ext-diff', '--no-textconv')
  if (SUBMODULE_STATUS.has(sub) && !args.some(arg => arg.startsWith('--ignore-submodules'))) added.push('--ignore-submodules=dirty')
  return [...prefix, ...args.slice(0, at + 1), ...added, ...args.slice(at + 1)]
}

/** main's environment without its `GIT_*` variables; `GIT_CEILING_DIRECTORIES` stays, as it only stops git looking up. */
export function withoutGitVariables(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(base).filter(([name]) => !/^GIT_/i.test(name) || name.toUpperCase() === 'GIT_CEILING_DIRECTORIES'))
}

/** A config key and its value, kept apart (never `key=value` text). */
export type ConfigPair = readonly [key: string, value: string]

/** `pairs` as `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, after any already in `env`. */
export function withConfigPairs(env: NodeJS.ProcessEnv, pairs: readonly ConfigPair[]): NodeJS.ProcessEnv {
  if (!pairs.length) return env
  const out = { ...env }
  let count = Number(out.GIT_CONFIG_COUNT ?? 0) || 0
  for (const [key, value] of pairs) {
    out[`GIT_CONFIG_KEY_${count}`] = key
    out[`GIT_CONFIG_VALUE_${count}`] = value
    count++
  }
  out.GIT_CONFIG_COUNT = String(count)
  return out
}

/**
 * main's environment without any `GIT_*` variable, with no lazy fetch, no prompt, no editor and no LFS download.
 * `systemConfig` keeps the system config (see the header); without it the environment is the one #372's committed
 * reads use.
 */
export function safeGitEnv(base: NodeJS.ProcessEnv = process.env, options: { systemConfig?: boolean } = {}): NodeJS.ProcessEnv {
  const env = withoutGitVariables(base)
  env.GIT_NO_LAZY_FETCH = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_LFS_SKIP_SMUDGE = '1'
  env.GIT_EDITOR = 'false'
  env.GIT_SEQUENCE_EDITOR = 'false'
  if (!options.systemConfig) env.GIT_CONFIG_NOSYSTEM = '1'
  return env
}

/**
 * The environment for `gh`, which runs git itself: no `GIT_*` of main's, no prompt, no lazy fetch, and git's own
 * options passed as `GIT_CONFIG_*` (command-line strength) since gh's arguments are not git's: the fixed ones, then
 * `extra` (the repository's drivers emptied, from `neutralizeRepositoryCommands`). Transports stay on, as gh is the
 * person's GitHub panel; `ext::` is never one.
 */
export function ghEnv(base: NodeJS.ProcessEnv = process.env, extra: readonly ConfigPair[] = []): NodeJS.ProcessEnv {
  const env = withoutGitVariables(base)
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_NO_LAZY_FETCH = '1'
  env.GIT_EDITOR = 'false'
  return withConfigPairs(env, [
    ['core.fsmonitor', ''], ['core.hooksPath', NO_HOOKS_PATH], ['diff.external', ''], ['protocol.ext.allow', 'never'],
    // gh pr create may push: never to a local path, whose own hooks would run (SECURITY #387 N1).
    ['core.alternateRefsCommand', ''], ['protocol.file.allow', 'never'], ...extra
  ])
}

// ---- what the repository's own config names ---------------------------------------------------------------

/** Keys whose value git runs as a command, in the scopes they were read from. */
export const COMMAND_KEYS = String.raw`^(filter\..+\.(clean|smudge|process)|diff\..+\.(command|textconv)|merge\..+\.driver|gpg\..*program|gpg\.ssh\.defaultkeycommand|core\.(sshcommand|gitproxy|askpass|alternaterefscommand|editor)|sequence\.editor|credential\..*helper|remote\..+\.(uploadpack|receivepack)|submodule\..+\.update|lfs\.(extension\..+\.(clean|smudge)|customtransfer\..+\.path|standalonetransferagent)|include\.path|includeif\..+\.path)$`

export interface ConfigEntry { scope: string; key: string; value: string }

/** The person's own files and the admin's; every other scope (local, worktree, an include of either) is the repository's. */
export const trustedScope = (scope: string): boolean => scope === 'system' || scope === 'global'
const repositoryScope = (scope: string): boolean => !trustedScope(scope) && scope !== 'command'

/** `git config --null --show-scope --get-regexp`: `scope NUL key LF value NUL`, or `scope NUL key NUL` with no value. */
export function parseConfigEntries(raw: string): ConfigEntry[] {
  const parts = raw.split('\0')
  const out: ConfigEntry[] = []
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const scope = parts[index], pair = parts[index + 1]
    if (!scope || !pair) continue
    const at = pair.indexOf('\n')
    out.push({ scope, key: at < 0 ? pair : pair.slice(0, at), value: at < 0 ? '' : pair.slice(at + 1) })
  }
  return out
}

/** A key a repository chose, safe to show a person: no control or bidi characters, bounded. */
export function displayKey(key: string, max = 80): string {
  const clean = key.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '?')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** The LFS filter as `git lfs install --local` writes it: a fixed program, kept so LFS files do not all show as changed. */
const LFS_VALUES = /^git-lfs (?:(?:clean|smudge)(?: --skip)? -- %f|filter-process(?: --skip)?)$/
const SIGNING_DEFAULTS: Record<string, string> = { 'gpg.program': 'gpg', 'gpg.openpgp.program': 'gpg', 'gpg.ssh.program': 'ssh-keygen', 'gpg.x509.program': 'gpgsm' }

/** Driver names seen per repository this launch (M1): `filter:<name>`, `diff:<name>`, `merge:<name>`. */
const seenDrivers = new Map<string, Set<string>>()
/** Linked worktrees share their main checkout's config, so the names seen in one are emptied in all (git-dir.ts). */
const repoKey = (cwd: string): string => { const path = commonGitDir(cwd); return process.platform === 'win32' ? path.replace(/\\/g, '/').toLowerCase() : path }

function driverPairs(kind: string, name: string): ConfigPair[] {
  if (kind === 'filter') return [[`filter.${name}.clean`, ''], [`filter.${name}.smudge`, ''], [`filter.${name}.process`, ''], [`filter.${name}.required`, 'false']]
  if (kind === 'diff') return [[`diff.${name}.command`, ''], [`diff.${name}.textconv`, '']]
  return [[`merge.${name}.driver`, 'false']]
}

/**
 * Pairs that empty what the repository set: each filter (clean, smudge, process; not required), diff (command,
 * textconv) and merge driver it defines, plus every driver seen before in `cwd`; each signing program back to the
 * person's value or git's default, with signing off when it set a key command; a `submodule.<name>.update` command
 * to `none`.
 */
export function neutralizeRepositoryCommands(entries: readonly ConfigEntry[], cwd?: string): ConfigPair[] {
  const pairs: ConfigPair[] = []
  const drivers = new Set<string>(cwd ? seenDrivers.get(repoKey(cwd)) ?? [] : [])
  let keyCommand = false
  for (const entry of entries) {
    if (!repositoryScope(entry.scope)) continue
    const key = entry.key
    const filter = /^filter\.(.+)\.(clean|smudge|process)$/i.exec(key)
    if (filter) {
      if (!(filter[1] === 'lfs' && LFS_VALUES.test(entry.value.trim()))) drivers.add(`filter:${filter[1]}`)
      continue
    }
    const diff = /^diff\.(.+)\.(command|textconv)$/i.exec(key)
    if (diff) { drivers.add(`diff:${diff[1]}`); continue }
    const merge = /^merge\.(.+)\.driver$/i.exec(key)
    if (merge) { drivers.add(`merge:${merge[1]}`); continue }
    const lower = key.toLowerCase()
    // git-lfs runs an extension's command from inside its own clean and smudge: the LFS filter goes too.
    if (/^lfs\.extension\./.test(lower)) { drivers.add('filter:lfs'); continue }
    if (lower === 'gpg.ssh.defaultkeycommand') { keyCommand = true; continue }
    if (/^gpg\..*program$/.test(lower)) {
      const trusted = entries.filter(other => trustedScope(other.scope) && other.key.toLowerCase() === lower).pop()
      pairs.push([key, trusted?.value ?? SIGNING_DEFAULTS[lower] ?? 'gpg'])
      continue
    }
    if (/^submodule\..+\.update$/.test(lower) && entry.value.trim().startsWith('!')) pairs.push([key, 'none'])
  }
  if (cwd && drivers.size) seenDrivers.set(repoKey(cwd), drivers)
  for (const driver of drivers) {
    const at = driver.indexOf(':')
    pairs.push(...driverPairs(driver.slice(0, at), driver.slice(at + 1)))
  }
  if (keyCommand) pairs.push(['commit.gpgSign', 'false'], ['tag.gpgSign', 'false'])
  return pairs
}

/** Test-only: forget the drivers seen this launch. */
export function __forgetSeenDriversForTests(): void { seenDrivers.clear() }

/**
 * Subcommands that run nothing a repository names (L1: the list is what may skip the config read, not what needs it).
 * `ls-files` and `cat-file` only without the options that compare the work tree or convert content.
 */
const RUNS_NOTHING = new Set(['rev-parse', 'config', 'for-each-ref', 'symbolic-ref', 'show-ref', 'check-ref-format', 'merge-base', 'rev-list', 'ls-tree', 'remote', 'check-ignore', 'var'])
const LS_FILES_COMPARES = /^(-m|-d|-k|--modified|--deleted|--killed|-[a-z]*[mdk][a-z]*)$/
const CAT_FILE_CONVERTS = /^(--filters|--textconv)$/

/** Whether the arguments need the repository's config read first: every command but those above. */
export function needsConfigProbe(args: readonly string[]): boolean {
  const at = subcommandIndex(args)
  if (at < 0) return false
  const sub = args[at], rest = args.slice(at + 1)
  if (RUNS_NOTHING.has(sub)) return false
  if (sub === 'ls-files') return rest.some(arg => LS_FILES_COMPARES.test(arg))
  if (sub === 'cat-file') return rest.some(arg => CAT_FILE_CONVERTS.test(arg))
  if (sub === 'branch') return rest.some(arg => arg === '--edit-description')
  return true
}

/**
 * The whole config with each entry's scope and the file it came from (`--show-origin`): git lists every file it read,
 * nested and conditional includes too, so the cache stamps exactly those (SECURITY #387 re-check 3, F2).
 */
const probeArgs = (prefix: readonly string[]): string[] => [...prefix, 'config', '--null', '--show-scope', '--show-origin', '--list']

/** Whether `args` is safe-git's config read (for a test's fake reader). */
export const isConfigRead = (args: readonly string[]): boolean => {
  const at = args.indexOf('config')
  return at >= 0 && args[at + 1] === '--null' && args.includes('--show-scope')
}

/** Runs the config read; injectable so a caller with its own spawner (GhExec, tests) reads through it. */
export type ConfigReader = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<{ code: number | null; stdout: string }>

export const execConfigReader: ConfigReader = (command, args, cwd, env) => new Promise(resolve => {
  execFile(command, args, { cwd, env, windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout: String(stdout ?? '') })
  })
})

function execSyncReader(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): { code: number | null; stdout: string } {
  try {
    return { code: 0, stdout: execFileSync(command, args, { cwd, env, windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
  } catch (error) {
    const status = (error as { status?: number | null }).status
    return { code: typeof status === 'number' ? status : null, stdout: '' }
  }
}

/** One read of the config: the command-bearing keys, and what the cache needs to know which files to stamp. */
export interface ConfigSnapshot {
  entries: ConfigEntry[]
  /** Every file a repository scope came from, as git printed it (`file:<path>`, maybe relative), and each include. */
  origins: string[]
  includes: Array<{ key: string; value: string; origin: string }>
  refStorage?: string
}

const COMMAND_KEY = new RegExp(COMMAND_KEYS)

/** `git config --null --show-scope --show-origin --list`: `scope NUL origin NUL key LF value NUL`, or no `LF value`. */
export function parseConfigSnapshot(raw: string): ConfigSnapshot {
  const parts = raw.split('\0')
  const entries: ConfigEntry[] = [], origins = new Set<string>(), includes: ConfigSnapshot['includes'] = []
  let refStorage: string | undefined
  for (let index = 0; index + 2 < parts.length; index += 3) {
    const scope = parts[index], origin = parts[index + 1], pair = parts[index + 2]
    if (!scope || !pair) continue
    const at = pair.indexOf('\n')
    const key = at < 0 ? pair : pair.slice(0, at), value = at < 0 ? '' : pair.slice(at + 1)
    if (key === 'extensions.refstorage') refStorage = value.trim().toLowerCase()
    if (repositoryScope(scope)) {
      origins.add(origin)
      if (/^include(if\..+)?\.path$/.test(key)) includes.push({ key, value, origin })
    }
    if (COMMAND_KEY.test(key)) entries.push({ scope, key, value })
  }
  return { entries, origins: [...origins], includes, ...(refStorage ? { refStorage } : {}) }
}

function snapshotOf(code: number | null, stdout: string): ConfigSnapshot {
  if (code === 0) return parseConfigSnapshot(stdout)
  if (code === 1) return { entries: [], origins: [], includes: [] }
  throw new Error('Could not read the repository git config.')
}

/** The config read, with origins. Exit 1 is "none". Throws when git cannot tell. */
export async function readConfigSnapshot(cwd: string, env: NodeJS.ProcessEnv, git = 'git', prefix: readonly string[] = SAFE_GIT_OPTIONS, reader: ConfigReader = execConfigReader): Promise<ConfigSnapshot> {
  const { code, stdout } = await reader(git, probeArgs(prefix), cwd, env)
  return snapshotOf(code, stdout)
}

/** The command-bearing keys every config scope sets, in `cwd`. Exit 1 is "none". Throws when git cannot tell. */
export async function readCommandKeys(cwd: string, env: NodeJS.ProcessEnv, git = 'git', prefix: readonly string[] = SAFE_GIT_OPTIONS, reader: ConfigReader = execConfigReader): Promise<ConfigEntry[]> {
  return (await readConfigSnapshot(cwd, env, git, prefix, reader)).entries
}

// ---- read once per config change ---------------------------------------------------------------------------

/**
 * The files to stamp for a read, from what git said it read, or null when the read must not be kept: a bare
 * repository or a cwd inside a git dir (F3), an origin that is not a file or not found where it should be, an include
 * whose target this cannot name (`%(prefix)`, `~user`), a condition other than `gitdir:`, `gitdir/i:` and `onbranch:`
 * (`hasconfig:` depends on config the stamps do not cover), or `onbranch:` with reftable refs (HEAD is not a file).
 * `gitdir:` depends on the git dir's path, which is in the stamped names; `onbranch:` on HEAD, which is stamped.
 */
export function configFiles(dirs: GitDirs, snapshot: ConfigSnapshot): string[] | null {
  if (!dirs.topLevel) return null
  // Git prints a relative origin from the folder it changed to: the work tree's top.
  const path = (origin: string): string | null => origin.startsWith('file:') ? resolvePath(dirs.topLevel!, origin.slice(5)) : null
  const files = new Set(baseConfigFiles(dirs))
  for (const origin of snapshot.origins) {
    const file = path(origin)
    if (!file || stamp(file) === '-') return null
    files.add(file)
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  for (const include of snapshot.includes) {
    const condition = /^includeif\.(.+)\.path$/.exec(include.key)?.[1]
    if (condition !== undefined) {
      if (!/^(gitdir|gitdir\/i|onbranch):/.test(condition)) return null
      if (condition.startsWith('onbranch:') && snapshot.refStorage && snapshot.refStorage !== 'files') return null
    }
    const from = path(include.origin)
    const value = include.value.trim()
    if (!from) return null
    if (!value) continue
    if (value.startsWith('~/') || value.startsWith('~\\')) { if (!home) return null; files.add(resolvePath(home, value.slice(2))); continue }
    if (value.startsWith('~') || value.startsWith('%(')) return null
    // An empty or missing include target is not in the origins; stamp it here, where git looks for it.
    files.add(isAbsolute(value) ? resolvePath(value) : resolvePath(dirname(from), value))
  }
  return [...files].sort()
}

/**
 * The last read per cwd, valid while the files git read for it keep their stamp (git-dir.ts). Reading costs a git
 * process; stat costs none. `fingerprint`: valid for a cache hit (empty forces a read); `taken`: the stamp of
 * `stamped` taken before this read, which the check after the command compares. One map per reader, so a caller's own
 * spawner (GhExec, a test) keeps its own reads.
 */
interface ConfigRead { dirs: string; fingerprint: string; taken: string; stamped: string[]; files: string[]; entries: ConfigEntry[] }
const dirsKey = (dirs: GitDirs | null): string => dirs ? `${dirs.gitDir}|${dirs.commonDir}|${dirs.topLevel ?? ''}` : ''
const reads = new WeakMap<ConfigReader, Map<string, ConfigRead>>()
const syncReads = new Map<string, ConfigRead>()
const readKey = (cwd: string): string => { const path = resolvePath(cwd); return process.platform === 'win32' ? path.toLowerCase() : path }

interface ReadStep { key: string; dirs: GitDirs | null; stamped: string[]; taken: string; hit?: ConfigRead }

function lookupRead(cache: Map<string, ConfigRead>, cwd: string, dirs: GitDirs | null): ReadStep {
  const key = readKey(cwd)
  const before = cache.get(key)
  // The files the last read named, if it was of these same dirs; else the base set (a new set forces one more read).
  const stamped = !dirs ? [] : before && before.dirs === dirsKey(dirs) ? before.files : baseConfigFiles(dirs)
  // Stamped before the read: a change during it is seen on the next call (M1 stays one run).
  const taken = stampOf(stamped)
  return { key, dirs, stamped, taken, ...(dirs && before?.fingerprint && before.fingerprint === taken ? { hit: before } : {}) }
}

function remember(cache: Map<string, ConfigRead>, step: ReadStep, snapshot: ConfigSnapshot): ConfigRead {
  const files = step.dirs ? configFiles(step.dirs, snapshot) : null
  // Kept only when the files git read are the ones stamped before it read them; null: never kept (read every time).
  const valid = files !== null && sameFiles(files, step.stamped)
  const read = { dirs: dirsKey(step.dirs), fingerprint: valid ? step.taken : '', taken: step.taken, stamped: step.stamped, files: files ?? step.stamped, entries: snapshot.entries }
  cache.set(step.key, read)
  return read
}

const runFor = (reader: ConfigReader, git: string, cwd: string, env: NodeJS.ProcessEnv) => (args: string[]) => reader(git, [...SAFE_GIT_OPTIONS, ...args], cwd, env)

async function readCached(cwd: string, env: NodeJS.ProcessEnv, git: string, reader: ConfigReader): Promise<ConfigRead> {
  let cache = reads.get(reader)
  if (!cache) { cache = new Map(); reads.set(reader, cache) }
  const step = lookupRead(cache, cwd, await gitDirsOf(cwd, env, runFor(reader, git, cwd, env)))
  if (step.hit) return step.hit
  return remember(cache, step, await readConfigSnapshot(cwd, env, git, SAFE_GIT_OPTIONS, reader))
}

function readCachedSync(cwd: string, env: NodeJS.ProcessEnv, git: string): ConfigRead {
  const step = lookupRead(syncReads, cwd, gitDirsOfSync(cwd, env, args => execSyncReader(git, [...SAFE_GIT_OPTIONS, ...args], cwd, env)))
  if (step.hit) return step.hit
  const { code, stdout } = execSyncReader(git, probeArgs(SAFE_GIT_OPTIONS), cwd, env)
  return remember(syncReads, step, snapshotOf(code, stdout))
}

/** Test-only: forget the config reads and the git dirs found. */
export function __forgetConfigReadsForTests(): void { syncReads.clear(); __forgetGitDirsForTests() }

// ---- after the command: did the config change under it? ----------------------------------------------------

const fingerprintOf = (entries: readonly ConfigEntry[]): Set<string> => new Set(entries.filter(entry => repositoryScope(entry.scope)).map(entry => `${entry.key}\n${entry.value}`))

/** Repository command keys present after a command and not before it. Remembers their drivers for the next call. */
function changedKeys(cwd: string, before: readonly ConfigEntry[], after: readonly ConfigEntry[]): string[] {
  const known = fingerprintOf(before)
  const added = after.filter(entry => repositoryScope(entry.scope) && !known.has(`${entry.key}\n${entry.value}`))
  if (!added.length) return []
  neutralizeRepositoryCommands(added, cwd)
  const keys = [...new Set(added.map(entry => displayKey(entry.key)))]
  events.emit('config-changed', { cwd, keys })
  console.warn(`[safe-git] the git config of ${cwd} gained ${keys.join(', ')} while OXESpace ran git there; that result is not trusted`)
  return keys
}

const events = new EventEmitter()
/** A repository's command keys changed while main's git ran there (M1). The listener shows the person. */
export function onRepositoryConfigChanged(listener: (change: { cwd: string; keys: string[] }) => void): () => void {
  events.on('config-changed', listener)
  return () => { events.off('config-changed', listener) }
}

/**
 * After a command that read the config first: if a config file changed meanwhile (stat, no process), read it again
 * and return the keys it gained.
 */
export async function verifyAfter(prepared: PreparedGit, cwd: string, reader: ConfigReader = execConfigReader): Promise<string[]> {
  if (!prepared.probed) return []
  if (prepared.stamped && stampOf(prepared.stamped) === prepared.fingerprint) return []
  try { return changedKeys(cwd, prepared.probed, (await readCached(cwd, prepared.env, prepared.command, reader)).entries) }
  catch { return [] }
}

function verifyAfterSync(prepared: PreparedGit, cwd: string): string[] {
  if (!prepared.probed) return []
  if (prepared.stamped && stampOf(prepared.stamped) === prepared.fingerprint) return []
  try { return changedKeys(cwd, prepared.probed, readCachedSync(cwd, prepared.env, prepared.command).entries) }
  catch { return [] }
}

// ---- running it ---------------------------------------------------------------------------------------------

export interface RunGitOptions {
  timeout?: number
  maxBuffer?: number
  /** Written to stdin, which is otherwise closed. */
  input?: string | Buffer
  encoding?: 'utf8' | 'buffer'
  /** The git executable (a resolved path); `git` from PATH by default. */
  git?: string
  /** Extra variables, layered over the safe environment; `GIT_*` names are refused. */
  env?: NodeJS.ProcessEnv
  /** How the config is read before (and after) a command. */
  readConfig?: ConfigReader
  /**
   * For `rev-parse --git-path hooks` only, which asks where the hooks are and runs none: leaves `core.hooksPath` as
   * the repository has it instead of the null device.
   */
  asksHooksPath?: boolean
}

/** `probed`: what the config read before the command saw, or null when the command skipped it. */
/** `fingerprint`: the stamp of `stamped` (the files git read) taken before `probed` was read. */
export interface PreparedGit { command: string; args: string[]; env: NodeJS.ProcessEnv; probed: ConfigEntry[] | null; fingerprint?: string; stamped?: readonly string[] }

const HOOKS_OFF = `core.hooksPath=${NO_HOOKS_PATH}`
function prefixFor(options: RunGitOptions): readonly string[] {
  if (!options.asksHooksPath) return SAFE_GIT_OPTIONS
  const out: string[] = []
  for (let index = 0; index < SAFE_GIT_OPTIONS.length; index++) {
    if (SAFE_GIT_OPTIONS[index] === '-c' && SAFE_GIT_OPTIONS[index + 1] === HOOKS_OFF) { index++; continue }
    out.push(SAFE_GIT_OPTIONS[index])
  }
  return out
}

/** `base` with `extra` over it; a `GIT_*` name in `extra` is refused (only safe-git sets those). */
export function layeredEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  if (!extra) return base
  for (const name of Object.keys(extra)) if (/^GIT_/i.test(name)) throw new Error(`safe-git: ${name} cannot be set here`)
  return { ...base, ...extra }
}

/** The command, arguments and environment for one local git call, after reading the config when it is needed. */
export async function prepareGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<PreparedGit> {
  const command = options.git ?? 'git'
  const env = layeredEnv(safeGitEnv(process.env, { systemConfig: true }), options.env)
  const read = needsConfigProbe(args) ? await readCached(cwd, env, command, options.readConfig ?? execConfigReader) : null
  const probed = read?.entries ?? null
  return { command, args: safeGitArgs(args, prefixFor(options)), env: withConfigPairs(env, neutralizeRepositoryCommands(probed ?? [], cwd)), probed, ...afterCheck(read) }
}

/**
 * What the check after the command compares: the stamp taken before the read, over the files it covered. When the read
 * named files that were not stamped (a new include), there is nothing to compare and the check reads again.
 */
function afterCheck(read: ConfigRead | null): Pick<PreparedGit, 'fingerprint' | 'stamped'> {
  if (!read) return {}
  return { fingerprint: read.taken, ...(sameFiles(read.files, read.stamped) ? { stamped: read.stamped } : {}) }
}

/** `prepareGit` for the synchronous callers. */
export function prepareGitSync(cwd: string, args: readonly string[], options: RunGitOptions = {}): PreparedGit {
  const command = options.git ?? 'git'
  const env = layeredEnv(safeGitEnv(process.env, { systemConfig: true }), options.env)
  const read = needsConfigProbe(args) ? readCachedSync(cwd, env, command) : null
  const probed = read?.entries ?? null
  return { command, args: safeGitArgs(args, prefixFor(options)), env: withConfigPairs(env, neutralizeRepositoryCommands(probed ?? [], cwd)), probed, ...afterCheck(read) }
}

/** `configChanged`: repository command keys that appeared while the command ran; its output is then not trusted. */
export interface GitResult<T extends string | Buffer = string> { ok: boolean; code: number | null; stdout: T; stderr: string; error?: ExecFileException | Error; configChanged?: string[] }

/** Spawns an already prepared git. Shared with the person path. */
export function spawnPrepared(prepared: PreparedGit, cwd: string, options: RunGitOptions): Promise<{ stdout: string | Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(prepared.command, prepared.args, {
      cwd, env: prepared.env, windowsHide: true, shell: false, timeout: options.timeout ?? 30_000,
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024, encoding: options.encoding === 'buffer' ? 'buffer' : 'utf8'
    }, (error, stdout, stderr) => {
      const err = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '')
      if (error) reject(Object.assign(error, { stdout, stderr: err }))
      else resolve({ stdout, stderr: err })
    })
    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
  })
}

/**
 * Local git, rejecting like a promisified `execFile` (the error carries `code`, `killed`, `stdout` and `stderr`).
 * Use it where a failure is an exception.
 */
export async function execGit(cwd: string, args: readonly string[], options: RunGitOptions & { encoding: 'buffer' }): Promise<{ stdout: Buffer; stderr: string; configChanged?: string[] }>
export async function execGit(cwd: string, args: readonly string[], options?: RunGitOptions): Promise<{ stdout: string; stderr: string; configChanged?: string[] }>
export async function execGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<{ stdout: string | Buffer; stderr: string; configChanged?: string[] }> {
  const prepared = await prepareGit(cwd, args, options)
  try {
    const result = await spawnPrepared(prepared, cwd, options)
    const changed = await verifyAfter(prepared, cwd, options.readConfig)
    return changed.length ? { ...result, configChanged: changed } : result
  } catch (error) {
    const changed = await verifyAfter(prepared, cwd, options.readConfig)
    throw changed.length ? Object.assign(error as object, { configChanged: changed }) : error
  }
}

/** Local git that never throws: `ok` and the exit code say how it went. */
export async function runGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<GitResult> {
  try {
    const { stdout, stderr, configChanged } = await execGit(cwd, args, { ...options, encoding: 'utf8' })
    return { ok: true, code: 0, stdout, stderr, ...(configChanged ? { configChanged } : {}) }
  } catch (error) {
    const failure = error as ExecFileException & { stdout?: string; stderr?: string; configChanged?: string[] }
    return { ok: false, code: typeof failure.code === 'number' ? failure.code : null, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? failure.message ?? ''), error: failure, ...(failure.configChanged ? { configChanged: failure.configChanged } : {}) }
  }
}

/** Local git, synchronously, throwing like `execFileSync` (the error carries `status`, `stdout` and `stderr`). */
export function execGitSync(cwd: string, args: readonly string[], options: Omit<RunGitOptions, 'encoding' | 'readConfig'> & { encoding?: 'utf8' } = {}): string {
  const prepared = prepareGitSync(cwd, args, options)
  try {
    return execFileSync(prepared.command, prepared.args, {
      cwd, env: prepared.env, windowsHide: true, timeout: options.timeout ?? 30_000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      encoding: 'utf8', stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(options.input !== undefined ? { input: options.input } : {})
    })
  } finally {
    verifyAfterSync(prepared, cwd)
  }
}
