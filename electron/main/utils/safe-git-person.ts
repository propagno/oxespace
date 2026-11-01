/**
 * The one git path that reaches the network: fetch, pull and push the person starts, and the checkouts the person
 * starts (switch, worktree add), where git-lfs downloads content. Callers: the Git and Worktree panels, a Linear issue's
 * worktree, a delegation the person created with "Fetch remote", and an agent's fetch, pull, push or checkout after
 * the person approved it. Loaded with the services that use it, never by the entry.
 *
 * What stays the same as the local path (safe-git.ts): no `GIT_*` of main's, no prompt, no pager, no editor, no
 * fsmonitor, no external diff, no `core.alternateRefsCommand`, the drivers and signing programs the repository set are
 * emptied (through `GIT_CONFIG_*`), and hooks are off. Hooks stay off here too, pre-push included: the hooks directory
 * and `core.hooksPath` are files an agent can write, and a hook the person never saw would run with a click that meant
 * "push". The person's terminal still runs them.
 *
 * A push never goes to a local path (`protocol.file.allow=never` for push): git clears our options before it starts
 * the target's receive-pack, so the target repository's own hooks would run (SECURITY #387 H3). That holds whatever
 * `pushurl` or `pushInsteadOf` the repository set, since git checks the resolved URL.
 *
 * What differs: transports are on (`ext::` never), lazy fetch is allowed and system config is read, so the person's
 * credential manager works. Keys a repository can set that git runs as a command on that network path
 * (`core.sshCommand`, `core.gitProxy`, `core.askPass`, `core.alternateRefsCommand`, a `credential.*helper`,
 * `remote.*.uploadpack|receivepack`, git-lfs transfer agents) are refused, not overridden: the call fails with
 * `PersonGitRefused` naming them, and the person runs it from a terminal. Only repository scopes refuse; the person's
 * global and system config never do.
 *
 * Every call names a `reason`; nothing reaches this file without one, and no agent or MCP call passes one unless a
 * person approved that call (see the callers).
 */
import { mainMessage, type MainMessage } from '../../../shared/messages'
import {
  displayKey, GIT_COMMAND_OFF, neutralizeRepositoryCommands, readCommandKeys, safeGitArgs, spawnPrepared, subcommandIndex, trustedScope,
  withConfigPairs, withoutGitVariables, type ConfigEntry, type ConfigReader, type GitResult, type PreparedGit, type RunGitOptions
} from './safe-git'

/** Who asked, in the caller's words: `git-panel:push`, `mcp-approved:fetch`. Appears in errors. */
export type PersonGitReason = `${'git-panel' | 'worktree-panel' | 'linear' | 'delegation-dialog' | 'mcp-approved'}:${string}`

export interface PersonGit { reason: PersonGitReason }

/**
 * A sentence for logs and older windows, and its C3 code on a second line (`#c3 {json}`), which the window translates
 * (the first line is what humanizeError shows).
 */
export function codedMessage(text: string, message: MainMessage): string {
  return `${text}\n#c3 ${JSON.stringify(message)}`
}

export class PersonGitRefused extends Error {
  readonly keys: string[]
  readonly messageCode: MainMessage
  constructor(keys: string[], readonly reason: string) {
    const shown = [...new Set(keys.map(key => displayKey(key)))].slice(0, 8)
    const message = mainMessage('git.person.refused', { keys: shown })
    super(codedMessage(`OXESpace won't run network Git in this repository because its own settings (.git/config) set ${shown.map(key => `\`${key}\``).join(', ')}. Run the command in the terminal instead.`, message))
    this.name = 'PersonGitRefused'
    this.keys = shown
    this.messageCode = message
  }
}

const PERSON_OPTIONS: readonly string[] = [...GIT_COMMAND_OFF, '-c', 'protocol.ext.allow=never']
const PUSH_OPTIONS: readonly string[] = [...PERSON_OPTIONS, '-c', 'protocol.file.allow=never']
const NETWORK_COMMAND = /^(core\.(sshcommand|gitproxy|askpass|alternaterefscommand)|credential\..*helper|remote\..+\.(uploadpack|receivepack)|lfs\.(customtransfer\..+\.path|standalonetransferagent))$/i

/** The repository-set keys that refuse a person call. */
export function refusedKeys(entries: readonly ConfigEntry[]): string[] {
  return [...new Set(entries.filter(entry => !trustedScope(entry.scope) && entry.scope !== 'command' && NETWORK_COMMAND.test(entry.key)).map(entry => entry.key))]
}

/** main's environment for the person path: no `GIT_*`, no prompt, no editor; system config and lazy fetch as git has them. */
export function personGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = withoutGitVariables(base)
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_EDITOR = 'false'
  env.GIT_SEQUENCE_EDITOR = 'false'
  return env
}

export async function preparePersonGit(cwd: string, args: readonly string[], person: PersonGit, options: RunGitOptions & { readConfig?: ConfigReader } = {}): Promise<PreparedGit> {
  if (!person || typeof person.reason !== 'string' || !/^[a-z-]+:\S+/.test(person.reason)) throw new Error('safe-git: a person git call needs its reason')
  const command = options.git ?? 'git'
  const env = personGitEnv()
  const entries = await readCommandKeys(cwd, env, command, PERSON_OPTIONS, options.readConfig)
  const refused = refusedKeys(entries)
  if (refused.length) throw new PersonGitRefused(refused, person.reason)
  const at = subcommandIndex(args)
  const prefix = at >= 0 && args[at] === 'push' ? PUSH_OPTIONS : PERSON_OPTIONS
  return { command, env: withConfigPairs(env, neutralizeRepositoryCommands(entries, cwd)), args: safeGitArgs(args, prefix), probed: entries }
}

/** Person-started network git; rejects like a promisified `execFile`, or with `PersonGitRefused`. */
export async function execPersonGit(cwd: string, args: readonly string[], person: PersonGit, options: RunGitOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await spawnPrepared(await preparePersonGit(cwd, args, person, options), cwd, { ...options, encoding: 'utf8' })
  return { stdout: String(stdout), stderr }
}

/** `execPersonGit` that never throws. */
export async function runPersonGit(cwd: string, args: readonly string[], person: PersonGit, options: RunGitOptions = {}): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execPersonGit(cwd, args, person, options)
    return { ok: true, code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as Error & { code?: unknown; stdout?: string; stderr?: string }
    return { ok: false, code: typeof failure.code === 'number' ? failure.code : null, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? failure.message), error: failure }
  }
}
