/**
 * Built-in list of read-only shell commands that Thread approves without asking.
 *
 * Ported from the default auto-approve rules of VS Code's terminal agent tool
 * (microsoft/vscode, MIT licence, Copyright (c) Microsoft Corporation):
 * `terminalChatAgentToolsConfiguration.ts` and `platform/terminal/common/autoApprove/*`.
 *
 * The list is best effort, not a sandbox. It only covers commands whose usual forms read
 * and never write or execute, and each entry names the options that break that promise.
 * A command that matches an `except` pattern is not approved here; it asks instead.
 * `shell-command-rules.ts` still asks for redirects to files and for its own dangerous
 * flags, whatever this list says.
 *
 * Matching runs on the normalised sub-command: the executable's base name (lower-case,
 * no directory or extension) followed by the unquoted arguments.
 */

export interface DefaultShellRule {
  /** Matches the normalised sub-command. */
  match: RegExp
  /** When one of these matches, the command is not approved by default. */
  except?: RegExp[]
}

const bare = (names: string[]): DefaultShellRule[] => names.map((name) => ({ match: new RegExp(`^${name}(\\s|$)`, 'i') }))

/** Options between `git` and its verb that cannot run anything: `-C <dir>` and `--no-pager`. */
const GIT = '^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+'

const SED_SCRIPT_START = String.raw`(?:\s+(?:(?:-l|--line-length)\s+\S+|--line-length=\S+|-\S+))*`
const SED_ADDRESS = String.raw`(?:(?:\d+|\$|\/(?:\\.|[^\/])*\/)(?:\s*,\s*(?:\d+|\$|\/(?:\\.|[^\/])*\/))?)?`

export const DEFAULT_ALLOW: DefaultShellRule[] = [
  // Plain read-only commands.
  ...bare(['cd', 'echo', 'ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'findstr', 'wc', 'tr', 'cut', 'cmp', 'which', 'basename', 'dirname',
    'realpath', 'readlink', 'stat', 'file', 'od', 'du', 'df', 'sleep', 'nl', 'grep']),

  // Read-only git verbs. `--output` writes a file; `grep -O` / `--open-files-in-pager` runs a program.
  { match: new RegExp(`${GIT}status\\b`) },
  { match: new RegExp(`${GIT}log\\b`), except: [/\s--output(=|\s|$)/] },
  { match: new RegExp(`${GIT}show\\b`), except: [/\s--output(=|\s|$)/] },
  { match: new RegExp(`${GIT}diff\\b`), except: [/\s--[^\w\s]*o[^\w\s]*u[^\w\s]*t[^\w\s]*p[^\w\s]*u[^\w\s]*t[^\w\s]*(=|\s|$)/] },
  { match: new RegExp(`${GIT}ls-files\\b`) },
  { match: new RegExp(`${GIT}grep\\b`), except: [/\s-[aIivwhHEGPFnlLqzco]*[^\w\s]*O\S*(\s|$)/, /\s--[^\w\s]*o[^\w\s]*p\S*(\s|$)/] },
  { match: new RegExp(`${GIT}branch\\b`), except: [/\s-(d|D|m|M|-delete|-force)\b/] },

  // docker, read-only verbs.
  { match: /^docker\s+(ps|images|info|version|inspect|logs|top|stats|port|diff|search|events)\b/ },
  { match: /^docker\s+(container|image|network|volume|context|system)\s+(ls|ps|inspect|history|show|df|info)\b/ },
  { match: /^docker\s+compose\s+(ps|ls|top|logs|images|config|version|port|events)\b/ },

  // npm, yarn, pnpm: read-only verbs and lockfile-only installs.
  { match: /^npm\s+(ls|list|outdated|view|info|show|explain|why|root|prefix|bin|search|doctor|fund|repo|bugs|docs|home|help(-search)?)\b/ },
  { match: /^npm\s+config\s+(list|get)\b/ },
  { match: /^npm\s+pkg\s+get\b/ },
  { match: /^npm\s+audit$/ },
  { match: /^npm\s+cache\s+verify\b/ },
  { match: /^npm\s+ci$/ },
  { match: /^yarn\s+(list|outdated|info|why|bin|help|versions)\b/ },
  { match: /^yarn\s+licenses\b/ },
  { match: /^yarn\s+audit\b/, except: [/\bfix\b/] },
  { match: /^yarn\s+config\s+(list|get)\b/ },
  { match: /^yarn\s+cache\s+dir\b/ },
  { match: /^yarn\s+install\s+--frozen-lockfile$/ },
  { match: /^pnpm\s+(ls|list|outdated|why|root|bin|doctor)\b/ },
  { match: /^pnpm\s+licenses\b/ },
  { match: /^pnpm\s+audit\b/, except: [/\bfix\b/] },
  { match: /^pnpm\s+config\s+(list|get)\b/ },
  { match: /^pnpm\s+install\s+--frozen-lockfile$/ },

  // Safe unless an option makes them write or run something.
  { match: /^column\b/, except: [/\s-c\s+[0-9]{4,}/] },
  { match: /^date\b/, except: [/\s(-s|--set)\b/] },
  { match: /^find\b/, except: [/\s-(delete|exec|execdir|fprint|fprintf|fls|ok|okdir)\b/] },
  { match: /^rg\b/, except: [/\s(--pre|--hostname-bin)\b/] },
  { match: /^sort\b/, except: [/\s-(o|S)\b/, /\s--(output|compress-program)\b/] },
  { match: /^tree\b/, except: [/\s-o\b/] },
  // xxd: only flags and one input file, because the output file is a positional argument.
  { match: /^xxd$/ },
  { match: /^xxd(\s+-\S+)*\s+[^-\s]\S*$/ },
  // sed: no script from `-e`/`-f`, and no e/r/R/w/W command, which run programs or touch files.
  {
    match: /^sed\b/,
    except: [
      /\s(-[a-zA-Z]*(e|f)[a-zA-Z]*|--expression|--file)\b/,
      // In-place editing writes the file it reads.
      /\s(-[a-zA-Z]*i|--in-place)/i,
      /s\/.*\/.*\/[ew]/,
      new RegExp(String.raw`^sed\b${SED_SCRIPT_START}\s+(['"])\s*${SED_ADDRESS}\s*!?\s*[erRwW](?:\s|\1)`),
      new RegExp(String.raw`^sed\b${SED_SCRIPT_START}\s+(['"])(?:\\.|(?!\1).)*[;{]\s*${SED_ADDRESS}\s*!?\s*[erRwW](?:\s|\1|[;}])`),
      new RegExp(String.raw`^sed\b${SED_SCRIPT_START}\s+${SED_ADDRESS}\s*!?\s*[erRwW](?:\s|$)`)
    ]
  },

  // PowerShell cmdlets, listed one by one: modules can define any cmdlet with a standard verb.
  ...bare(['get-childitem', 'get-content', 'get-date', 'get-random', 'get-location', 'set-location', 'write-host', 'write-output',
    'out-string', 'split-path', 'join-path', 'start-sleep', 'where-object', 'select-object', 'select-string', 'measure-object',
    'compare-object', 'format-list', 'format-table', 'sort-object'])
]

/**
 * Quoted arguments lose their quotes during tokenizing, so a quoted `;` or `{` in a sed script
 * can look like a separator to the patterns above. That only ever turns an approval into a question.
 */
export function matchesDefaultAllow(normalised: string): boolean {
  return DEFAULT_ALLOW.some((rule) => rule.match.test(normalised) && !(rule.except ?? []).some((pattern) => pattern.test(normalised)))
}
