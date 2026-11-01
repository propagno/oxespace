/**
 * For tests that fake GhExec's spawner: electron/main/utils/safe-git.ts puts its options in front of every git call
 * (and a few after the subcommand) and first reads the config for some. This hands the fake the arguments the service
 * asked for, and answers the config read as "nothing set", so the fake's matching and call counts stay as they were.
 */
import { subcommandIndex } from '../../electron/main/utils/safe-git'

const ADDED_AFTER_SUBCOMMAND = new Set(['--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty'])

/** The arguments a service asked git for, without what safe-git adds. */
export function requestedGitArgs(args: readonly string[]): string[] {
  const at = subcommandIndex(args)
  if (at < 0) return args.filter(arg => arg.startsWith('--version'))
  return [args[at], ...args.slice(at + 1).filter(arg => !ADDED_AFTER_SUBCOMMAND.has(arg))]
}

const isGit = (command: string) => /(^|[\\/])git(\.exe)?$/i.test(command)

type Spawner<R> = (command: string, args: string[], options: { cwd: string } & Record<string, unknown>) => Promise<R>

export function plainGitArgs<R>(spawn: Spawner<R>): Spawner<R> {
  return async (command, args, options) => {
    if (!isGit(command)) return spawn(command, args, options)
    const requested = requestedGitArgs(args)
    if (requested[0] === 'config' && requested.includes('--show-scope')) return { stdout: '', stderr: '', status: 1, error: undefined } as R
    return spawn(command, requested, options)
  }
}
