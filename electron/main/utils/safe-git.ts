/**
 * Every git the main process runs goes through here (guarded by tests/unit/safe-git-guard.test.ts).
 *
 * The vector (SECURITY S4-1): main runs git inside repositories an agent can write, and a repository's own config
 * can name commands git then runs, with no click and with main's environment: a partial clone lazy-fetches a missing
 * object through `core.sshCommand` or an `ext::` URL, and `core.fsmonitor`, hooks, the pager, textconv and external
 * diff drivers, filter drivers (`filter.<name>.clean` runs on a plain `git diff`), signing programs and
 * `credential.helper` do the same. `GIT_*` variables in main's environment redirect all of it.
 *
 * Two paths:
 *  - `runGit` / `execGit` / `execGitSync` (this file): local work, never the network. Every `GIT_*` variable is
 *    dropped, lazy fetch is off, every transport is `never` (named one by one, since a repository's
 *    `protocol.<name>.allow` beats the general key), and the command-bearing keys are emptied on the command line,
 *    which beats the repository's config. Filter drivers and signing programs have names only the config knows, so the
 *    commands that can run them first read the config (`git config`, which runs nothing) and empty the ones a
 *    repository set.
 *  - `runPersonGit` (safe-git-person.ts): fetch, pull, push started by the person, which needs its transports. See
 *    that file.
 *
 * System config stays on for these calls: it is admin-only (`GIT_CONFIG_SYSTEM` is dropped with every `GIT_*`), and
 * Git for Windows keeps `core.autocrlf`, `core.symlinks` and the LFS filter there, without which `git status` reports
 * every CRLF file as changed. `safeGitEnv()` itself turns it off by default, for reads of committed objects only.
 */
import { execFile, execFileSync, type ExecFileException } from 'node:child_process'
import { devNull } from 'node:os'

/** Every transport git knows; each is denied by name. */
export const GIT_TRANSPORTS = ['ext', 'file', 'ssh', 'git', 'http', 'https'] as const

/** A hooks directory that holds nothing: the null device (`\\.\nul` on Windows), never a folder anyone can fill. */
export const NO_HOOKS_PATH = devNull

const config = (pairs: string[]): string[] => pairs.flatMap(pair => ['-c', pair])

/**
 * Options that hold for every main-process git: no pager, no fsmonitor, no hooks, no external diff and no signature
 * check on log. Shared with the person path.
 */
export const GIT_COMMAND_OFF: readonly string[] = ['--no-pager', ...config([
  'core.fsmonitor=', `core.hooksPath=${NO_HOOKS_PATH}`, 'diff.external=', 'log.showSignature=false'
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
 * diffs and `--ignore-submodules=dirty` where it would spawn git inside a submodule. `extra` are further `-c` pairs.
 */
export function safeGitArgs(args: readonly string[], extra: readonly string[] = [], prefix: readonly string[] = SAFE_GIT_OPTIONS): string[] {
  const at = subcommandIndex(args)
  const out = [...prefix, ...extra]
  if (at < 0) return [...out, ...args]
  const sub = args[at]
  const added: string[] = []
  if (DIFFING.has(sub)) added.push('--no-ext-diff', '--no-textconv')
  if (SUBMODULE_STATUS.has(sub) && !args.some(arg => arg.startsWith('--ignore-submodules'))) added.push('--ignore-submodules=dirty')
  return [...out, ...args.slice(0, at + 1), ...added, ...args.slice(at + 1)]
}

/** main's environment without its `GIT_*` variables; `GIT_CEILING_DIRECTORIES` stays, as it only stops git looking up. */
export function withoutGitVariables(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(base).filter(([name]) => !/^GIT_/i.test(name) || name.toUpperCase() === 'GIT_CEILING_DIRECTORIES'))
}

/**
 * main's environment without any `GIT_*` variable, with no lazy fetch, no prompt and no LFS download. `systemConfig`
 * keeps the system config (see the header); without it the environment is the one #372's committed reads use.
 */
export function safeGitEnv(base: NodeJS.ProcessEnv = process.env, options: { systemConfig?: boolean } = {}): NodeJS.ProcessEnv {
  const env = withoutGitVariables(base)
  env.GIT_NO_LAZY_FETCH = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_LFS_SKIP_SMUDGE = '1'
  if (!options.systemConfig) env.GIT_CONFIG_NOSYSTEM = '1'
  return env
}

/**
 * The environment for `gh`, which runs git itself: no `GIT_*` of main's, no prompt, no lazy fetch, and git's own
 * options passed as `GIT_CONFIG_*` (command-line strength) since gh's arguments are not git's. Transports stay on, as
 * gh is the person's GitHub panel; `ext::` is never one.
 */
export function ghEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = withoutGitVariables(base)
  const pairs = ['core.fsmonitor=', `core.hooksPath=${NO_HOOKS_PATH}`, 'diff.external=', 'protocol.ext.allow=never']
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_NO_LAZY_FETCH = '1'
  env.GIT_CONFIG_COUNT = String(pairs.length)
  pairs.forEach((pair, index) => {
    const at = pair.indexOf('=')
    env[`GIT_CONFIG_KEY_${index}`] = pair.slice(0, at)
    env[`GIT_CONFIG_VALUE_${index}`] = pair.slice(at + 1)
  })
  return env
}

// ---- what the repository's own config names ---------------------------------------------------------------

/** Keys whose value git runs as a command, in the scopes they were read from. */
export const COMMAND_KEYS = String.raw`^(filter\..+\.(clean|smudge|process)|gpg\..*program|gpg\.ssh\.defaultkeycommand|core\.(sshcommand|gitproxy|askpass)|credential\..*helper|remote\..+\.(uploadpack|receivepack)|lfs\.(extension\..+\.(clean|smudge)|customtransfer\..+\.path|standalonetransferagent))$`

export interface ConfigEntry { scope: string; key: string; value: string }

/** The person's own files and the admin's; every other scope (local, worktree, an include of either) is the repository's. */
export const trustedScope = (scope: string): boolean => scope === 'system' || scope === 'global'

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

/** The LFS filter as `git lfs install --local` writes it: a fixed program, kept so LFS files do not all show as changed. */
const LFS_VALUES = /^git-lfs (?:(?:clean|smudge)(?: --skip)? -- %f|filter-process(?: --skip)?)$/
const SIGNING_DEFAULTS: Record<string, string> = { 'gpg.program': 'gpg', 'gpg.openpgp.program': 'gpg', 'gpg.ssh.program': 'ssh-keygen', 'gpg.x509.program': 'gpgsm' }

/**
 * `-c` pairs that empty what the repository set: each filter driver it defines (clean, smudge, process; not required),
 * and each signing program back to the person's value or git's default, with signing off when it set a key command.
 */
export function neutralizeRepositoryCommands(entries: readonly ConfigEntry[]): string[] {
  const pairs: string[] = []
  const filters = new Set<string>()
  let keyCommand = false
  for (const entry of entries) {
    if (trustedScope(entry.scope) || entry.scope === 'command') continue
    const key = entry.key
    const filter = /^filter\.(.+)\.(clean|smudge|process)$/i.exec(key)
    if (filter) {
      if (!(filter[1] === 'lfs' && LFS_VALUES.test(entry.value.trim()))) filters.add(filter[1])
      continue
    }
    const lower = key.toLowerCase()
    // git-lfs runs an extension's command from inside its own clean and smudge: the LFS filter goes too.
    if (/^lfs\.extension\./.test(lower)) { filters.add('lfs'); continue }
    if (lower === 'gpg.ssh.defaultkeycommand') { keyCommand = true; continue }
    if (/^gpg\..*program$/.test(lower)) {
      const trusted = entries.filter(other => trustedScope(other.scope) && other.key.toLowerCase() === lower).pop()
      pairs.push(`${key}=${trusted?.value ?? SIGNING_DEFAULTS[lower] ?? 'gpg'}`)
    }
  }
  for (const name of filters) pairs.push(`filter.${name}.clean=`, `filter.${name}.smudge=`, `filter.${name}.process=`, `filter.${name}.required=false`)
  if (keyCommand) pairs.push('commit.gpgSign=false', 'tag.gpgSign=false')
  return pairs.flatMap(pair => ['-c', pair])
}

/** Subcommands that can run a filter driver (worktree content in or out) or a signing program. */
const RUNS_REPOSITORY_COMMANDS = new Set([
  'add', 'am', 'apply', 'checkout', 'checkout-index', 'cherry-pick', 'clone', 'commit', 'commit-tree', 'diff', 'hash-object',
  'merge', 'mv', 'pull', 'push', 'read-tree', 'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'status', 'switch',
  'tag', 'update-index', 'worktree'
])

/** Whether the arguments need the repository's config read first. */
export function needsConfigProbe(args: readonly string[]): boolean {
  const at = subcommandIndex(args)
  if (at < 0) return false
  return RUNS_REPOSITORY_COMMANDS.has(args[at]) || args.includes('--filters')
}

const probeArgs = (prefix: readonly string[]): string[] => [...prefix, 'config', '--null', '--show-scope', '--get-regexp', COMMAND_KEYS]

/** Runs the config read; injectable so a caller with its own spawner (GhExec, tests) reads through it. */
export type ConfigReader = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<{ code: number | null; stdout: string }>

const execConfigReader: ConfigReader = (command, args, cwd, env) => new Promise(resolve => {
  execFile(command, args, { cwd, env, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout: String(stdout ?? '') })
  })
})

/** The command-bearing keys every config scope sets, in `cwd`. Exit 1 is "none". Throws when git cannot tell. */
export async function readCommandKeys(cwd: string, env: NodeJS.ProcessEnv, git = 'git', prefix: readonly string[] = SAFE_GIT_OPTIONS, reader: ConfigReader = execConfigReader): Promise<ConfigEntry[]> {
  const { code, stdout } = await reader(git, probeArgs(prefix), cwd, env)
  if (code === 0) return parseConfigEntries(stdout)
  if (code === 1) return []
  throw new Error('Could not read the repository git config.')
}

function readCommandKeysSync(cwd: string, env: NodeJS.ProcessEnv, git: string): ConfigEntry[] {
  try {
    return parseConfigEntries(execFileSync(git, probeArgs(SAFE_GIT_OPTIONS), { cwd, env, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch (error) {
    if ((error as { status?: number }).status === 1) return []
    throw Object.assign(new Error('Could not read the repository git config.'), { cause: error })
  }
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
  /** How the config is read before a command that can run a repository's filter or signing program. */
  readConfig?: ConfigReader
  /**
   * For `rev-parse --git-path hooks` only, which asks where the hooks are and runs none: leaves `core.hooksPath` as
   * the repository has it instead of the null device.
   */
  asksHooksPath?: boolean
}

export interface PreparedGit { command: string; args: string[]; env: NodeJS.ProcessEnv }

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

function layeredEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  if (!extra) return base
  for (const name of Object.keys(extra)) if (/^GIT_/i.test(name)) throw new Error(`safe-git: ${name} cannot be set here`)
  return { ...base, ...extra }
}

/** The command, arguments and environment for one local git call, after reading the config when it is needed. */
export async function prepareGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<PreparedGit> {
  const command = options.git ?? 'git'
  const env = layeredEnv(safeGitEnv(process.env, { systemConfig: true }), options.env)
  const extra = needsConfigProbe(args) ? neutralizeRepositoryCommands(await readCommandKeys(cwd, env, command, SAFE_GIT_OPTIONS, options.readConfig)) : []
  return { command, args: safeGitArgs(args, extra, prefixFor(options)), env }
}

/** `prepareGit` for the synchronous callers. */
export function prepareGitSync(cwd: string, args: readonly string[], options: RunGitOptions = {}): PreparedGit {
  const command = options.git ?? 'git'
  const env = layeredEnv(safeGitEnv(process.env, { systemConfig: true }), options.env)
  const extra = needsConfigProbe(args) ? neutralizeRepositoryCommands(readCommandKeysSync(cwd, env, command)) : []
  return { command, args: safeGitArgs(args, extra, prefixFor(options)), env }
}

export interface GitResult<T extends string | Buffer = string> { ok: boolean; code: number | null; stdout: T; stderr: string; error?: ExecFileException | Error }

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
export async function execGit(cwd: string, args: readonly string[], options: RunGitOptions & { encoding: 'buffer' }): Promise<{ stdout: Buffer; stderr: string }>
export async function execGit(cwd: string, args: readonly string[], options?: RunGitOptions): Promise<{ stdout: string; stderr: string }>
export async function execGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<{ stdout: string | Buffer; stderr: string }> {
  return spawnPrepared(await prepareGit(cwd, args, options), cwd, options)
}

/** Local git that never throws: `ok` and the exit code say how it went. */
export async function runGit(cwd: string, args: readonly string[], options: RunGitOptions = {}): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execGit(cwd, args, { ...options, encoding: 'utf8' })
    return { ok: true, code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as ExecFileException & { stdout?: string; stderr?: string }
    return { ok: false, code: typeof failure.code === 'number' ? failure.code : null, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? failure.message ?? ''), error: failure }
  }
}

/** Local git, synchronously, throwing like `execFileSync` (the error carries `status`, `stdout` and `stderr`). */
export function execGitSync(cwd: string, args: readonly string[], options: Omit<RunGitOptions, 'encoding'> & { encoding?: 'utf8' } = {}): string {
  const prepared = prepareGitSync(cwd, args, options)
  return execFileSync(prepared.command, prepared.args, {
    cwd, env: prepared.env, windowsHide: true, timeout: options.timeout ?? 30_000, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    encoding: 'utf8', stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(options.input !== undefined ? { input: options.input } : {})
  })
}
