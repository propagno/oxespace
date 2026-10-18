/**
 * Which paths a read-only command from the built-in safe list would open, and whether any is outside the project.
 *
 * The safe list approves `cat`, `grep`, `find` and the like without a rule, and those read whatever the
 * user can read: `cat ~/.ssh/id_rsa` is as "read-only" as `cat README.md`. VS Code accepts that risk because
 * network commands ask; here a command that names a place outside the project asks too. Only commands
 * approved by the safe list are checked: a rule the person wrote is the person's decision.
 */
import { baseName, tokenize } from './shell-command-rules'
import { checkWorkspacePath, type PathSafetyOptions } from './path-safety'

/** Commands whose arguments are paths (or patterns next to paths) they will open. */
const READERS = new Set([
  'cat', 'head', 'tail', 'grep', 'rg', 'find', 'ls', 'dir', 'tree', 'du', 'df', 'stat', 'file', 'wc', 'cut', 'sort', 'nl', 'od', 'xxd', 'cmp',
  'readlink', 'realpath', 'basename', 'dirname', 'findstr', 'column', 'cd',
  'get-childitem', 'get-content', 'select-string', 'set-location'
])
/** Git options that point at a directory: `git -C <dir> status`. */
const GIT_DIR_OPTION = /^-C$/

/** True for a word that is plausibly a path rather than a pattern or a flag value. */
const looksLikePath = (token: string): boolean => /[\\/]/.test(token) || /^\.{1,2}$/.test(token) || /^[a-zA-Z]:/.test(token) || token.includes('..')

/**
 * File names that usually hold a secret. Inside the project they are still asked about: an agent that is
 * being steered by text it read has no reason to open them without a person looking.
 */
const SECRET_NAME = /^(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keystore|jks|kdbx)|credentials(\.json)?|secrets?(\.(json|ya?ml|toml))?|service-account.*\.json|.*[-_.]secrets?\.(json|ya?ml|toml))$/i

export interface OutsideRead { command: string; path: string; why: string }

function judge(token: string, rootPath: string, options: PathSafetyOptions): string | null {
  const name = token.replace(/\\/g, '/').split('/').pop() ?? ''
  if (SECRET_NAME.test(name)) return 'looks like it holds a secret'
  // A variable, home shorthand or substitution decides the path at run time: it cannot be checked now.
  if (/[$`]/.test(token) || token.startsWith('~')) return 'is expanded by the shell, so where it points cannot be checked'
  const bare = !looksLikePath(token)
  const verdict = checkWorkspacePath(rootPath, token, options)
  if (verdict.safe) return null
  // A plain word may be a search pattern ("TODO."), so it only counts when it really leaves the project (a link).
  if (bare && verdict.reason !== 'outside-workspace') return null
  return verdict.reason === 'outside-workspace' ? 'is outside the project' : 'is not a path the project can safely contain'
}

/** Paths named by the sub-commands the safe list approved that fall outside `rootPath`. */
export function readsOutsideProject(subcommands: readonly string[], rootPath: string, options: PathSafetyOptions = {}): OutsideRead[] {
  const found: OutsideRead[] = []
  for (const sub of subcommands) {
    const tokens = tokenize(sub)
    if (tokens.length === 0) continue
    const head = baseName(tokens[0])
    const gitDir = head === 'git'
    if (!READERS.has(head) && !gitDir) continue
    for (let i = 1; i < tokens.length; i += 1) {
      let token = tokens[i]
      if (gitDir) {
        // Only the directory option matters for git; its other arguments are refs and pathspecs inside the repository.
        if (!GIT_DIR_OPTION.test(token) || !tokens[i + 1]) continue
        token = tokens[i + 1]; i += 1
      } else if (token.startsWith('-')) {
        // `--file=/etc/passwd` and `-f/etc/passwd` carry a path inside the option.
        const attached = token.includes('=') ? token.slice(token.indexOf('=') + 1) : /^-[a-zA-Z](.+)$/.exec(token)?.[1] ?? ''
        if (!attached || !(looksLikePath(attached) || /[$`~]/.test(attached))) continue
        token = attached
      }
      if (!token) continue
      const why = judge(token, rootPath, options)
      if (why) found.push({ command: head, path: token, why })
    }
  }
  return found
}
