/**
 * Files that steer an agent: its instructions, its MCP servers and its hooks, and git's configuration, which names
 * commands git runs later (core.sshCommand, core.fsmonitor, aliases, filter drivers).
 *
 * Text an agent reads (a web page, an issue, a file in a cloned repository) can try to make it rewrite
 * these, so that the next session, or another agent, starts under someone else's orders: an injection
 * that outlives the conversation it arrived in. A change to one of them is never approved by a saved
 * rule, by the built-in lists or by "allow for this session"; a person looks at it each time.
 *
 * Pure: it reasons about path and command text only. Changes made outside the app's write path (another program, a
 * script the agent left behind) are B7.4's file watch, not this module.
 */
import { baseName, evaluateShellCommand, splitShellCommand, tokenize } from '../shell-command-rules'
import { mainMessage, type MainMessage } from '../../../../../shared/messages'

export type ProtectedConfigKind = 'instructions' | 'mcp' | 'hooks' | 'git'

export const PROTECTED_CONFIG_LABEL: Record<ProtectedConfigKind, string> = {
  instructions: 'agent instructions',
  mcp: 'MCP server settings',
  hooks: 'agent hooks',
  git: 'git configuration'
}

/** File names that are protected at any depth, lower-cased. Add a name here and it is protected everywhere. */
export const PROTECTED_CONFIG_NAMES: Readonly<Record<string, ProtectedConfigKind>> = {
  'agents.md': 'instructions',
  'claude.md': 'instructions',
  'claude.local.md': 'instructions',
  'gemini.md': 'instructions',
  '.cursorrules': 'instructions',
  '.windsurfrules': 'instructions',
  'copilot-instructions.md': 'instructions',
  '.mcp.json': 'mcp',
  '.gitconfig': 'git'
}

/**
 * Places that are protected, matched against the whole path, lower-cased, with forward slashes. `names` lists the
 * file and folder names a place is spelled with, so a Windows 8.3 short name (`SETTIN~1.JSO`, `CLAUDE~1`) can be read
 * back as one of them. Add a place here, with its names, and every check below covers it.
 */
export const PROTECTED_CONFIG_PLACES: ReadonlyArray<{ kind: ProtectedConfigKind; pattern: RegExp; names: readonly string[] }> = [
  { kind: 'hooks', pattern: /(^|\/)\.claude\/settings(\.local)?\.json$/, names: ['.claude', 'settings.json', 'settings.local.json'] },
  { kind: 'hooks', pattern: /(^|\/)\.claude\/hooks\//, names: ['.claude', 'hooks'] },
  { kind: 'hooks', pattern: /(^|\/)\.codex\/hooks(\.json|\/)/, names: ['.codex', 'hooks', 'hooks.json'] },
  { kind: 'hooks', pattern: /(^|\/)\.git\/hooks\//, names: ['.git', 'hooks'] },
  { kind: 'hooks', pattern: /(^|\/)\.husky\//, names: ['.husky'] },
  { kind: 'mcp', pattern: /(^|\/)\.(cursor|vscode)\/mcp\.json$/, names: ['.cursor', '.vscode', 'mcp.json'] },
  { kind: 'mcp', pattern: /(^|\/)\.(codex\/config\.toml|gemini\/settings\.json)$/, names: ['.codex', '.gemini', 'config.toml', 'settings.json'] },
  { kind: 'instructions', pattern: /(^|\/)\.cursor\/rules\//, names: ['.cursor', 'rules'] },
  { kind: 'instructions', pattern: /(^|\/)\.github\/copilot-instructions\.md$/, names: ['.github', 'copilot-instructions.md'] },
  // Git's own configuration: global (XDG), the repository's, a worktree's, and the system file of any Git install
  // (/etc/gitconfig, C:/Program Files/Git/etc/gitconfig, a per-user install's etc/gitconfig). The repository's
  // .gitattributes is NOT here: it is an ordinary tracked file agents edit, and the drivers it names live in config.
  { kind: 'git', pattern: /(^|\/)\.config\/git\/(config|attributes|ignore)$/, names: ['.config', 'git', 'config', 'attributes', 'ignore'] },
  { kind: 'git', pattern: /(^|\/)\.git\/config(\.worktree)?$/, names: ['.git', 'config', 'config.worktree'] },
  { kind: 'git', pattern: /(^|\/)\.git\/worktrees\/[^/]+\/config\.worktree$/, names: ['.git', 'worktrees', 'config.worktree'] },
  { kind: 'git', pattern: /(^|\/)\.git\/info\/attributes$/, names: ['.git', 'info', 'attributes'] },
  { kind: 'git', pattern: /(^|\/)etc\/gitconfig$/, names: ['etc', 'gitconfig'] }
]

/** Every name a protected file or folder is spelled with, for reading 8.3 short names back. */
const KNOWN_NAMES = [...new Set([...Object.keys(PROTECTED_CONFIG_NAMES), ...PROTECTED_CONFIG_PLACES.flatMap(place => place.names)])]
/** The letters Windows keeps for a short name: dots and spaces dropped. */
const stem = (name: string): string => name.replace(/[.\s]/g, '')

/**
 * One segment as Windows opens it: trailing dots and spaces dropped (`AGENTS.md.`, `AGENTS.md `), and an alternate
 * data stream removed (`AGENTS.md::$DATA`, `AGENTS.md:hidden`). A drive (`c:`) is kept.
 */
function windowsSegment(segment: string, first: boolean): string {
  if (first && /^[a-z]:$/.test(segment)) return segment
  const colon = segment.indexOf(':')
  const named = colon > 0 || (colon === 0 && segment.length > 1) ? segment.slice(0, colon) : segment
  return named === '.' || named === '..' ? named : named.replace(/[.\s]+$/, '')
}

/** The path's segments, lower-cased, Windows aliases resolved, `.` dropped and `..` applied. */
function segments(path: string): string[] {
  const raw = path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase().trim().split('/')
  const out: string[] = []
  raw.forEach((segment, index) => {
    const value = windowsSegment(segment, index === 0)
    if (value === '' && index > 0) return
    if (value === '.') return
    if (value === '..') { if (out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop(); else out.push('..'); return }
    out.push(value)
  })
  return out
}

/** The kind of the path as written, without reading short names. */
function kindOf(parts: string[]): ProtectedConfigKind | null {
  const normal = parts.join('/')
  if (!normal) return null
  const name = parts[parts.length - 1]
  if (Object.hasOwn(PROTECTED_CONFIG_NAMES, name)) return PROTECTED_CONFIG_NAMES[name]
  return PROTECTED_CONFIG_PLACES.find(place => place.pattern.test(normal))?.kind ?? null
}

/** A Windows 8.3 short name (`AGENTS~1.MD`, `CLAUDE~1`): the letters before `~`, without dots. */
const SHORT = /^([^~]{1,8})~\d+(\.[^.]{0,3})?$/

/**
 * What a path configures for agents, or null for an ordinary file. Any depth, any case, either slash, `.` and `..`
 * resolved, and the Windows spellings of the same file: trailing dots or spaces, `::$DATA` or another stream, and an
 * 8.3 short name that could stand for a protected name or sits inside a protected folder.
 */
export function protectedConfigKind(path: string): ProtectedConfigKind | null {
  const parts = segments(path)
  const direct = kindOf(parts)
  if (direct || !parts.some(part => SHORT.test(part))) return direct
  // A short segment may stand for any known name it is a prefix of; try each (bounded) and the folder it sits in.
  let options: string[][] = [[]]
  for (const part of parts) {
    const match = SHORT.exec(part)
    const readings = match ? [part, ...KNOWN_NAMES.filter(name => stem(name).startsWith(stem(match[1])))] : [part]
    options = options.flatMap(prefix => readings.map(reading => [...prefix, reading])).slice(0, 256)
  }
  for (const option of options) {
    const kind = kindOf(option)
    if (kind) return kind
  }
  // A short file name inside a protected folder (`.git/hooks/PRE-CO~1`) is that folder's file.
  return SHORT.test(parts[parts.length - 1]) ? kindOf([...parts.slice(0, -1), 'x']) : null
}

/** Commands that write or remove the files named in their arguments. */
const WRITERS = new Set([
  'tee', 'cp', 'mv', 'rm', 'ln', 'install', 'truncate', 'touch', 'dd', 'sed', 'perl', 'ex', 'ed',
  'set-content', 'add-content', 'out-file', 'new-item', 'copy-item', 'move-item', 'remove-item', 'rename-item', 'clear-content', 'sc', 'ac'
])

/** The first protected file that a writing command in this line names (the shell's own redirections already ask). */
export function commandWritesProtected(command: string): { path: string; kind: ProtectedConfigKind } | null {
  const gitConfig = commandWritesGitConfig(command)
  if (gitConfig) return gitConfig
  for (const sub of splitShellCommand(command) ?? [command]) {
    const tokens = tokenize(sub)
    if (!tokens.length || !WRITERS.has(baseName(tokens[0]))) continue
    // sed and perl only write with an in-place flag; without it they print.
    if (/^(sed|perl)$/.test(baseName(tokens[0])) && !tokens.slice(1).some(token => /^(-[a-zA-Z]*i|--in-place)/.test(token))) continue
    for (const token of tokens.slice(1)) {
      // `of=AGENTS.md` and `--output=AGENTS.md` carry the path after the equals sign.
      const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token
      const kind = protectedConfigKind(value)
      if (kind) return { path: value, kind }
    }
  }
  return null
}

/** Characters that end a path in command text: blanks, quotes, brackets and the shell's operators. */
const PATH_BREAK = /[\s"'`()[\]{},;|&<>=+*?!]+/
/** `cd`, `pushd` and `Set-Location` targets, so `cd .claude && echo x > settings.json` is read as one path. */
const CHANGE_DIR = /(?:^|[\s;&|(])(?:cd|pushd|set-location|sl|chdir)\s+(?:-path\s+)?("[^"]*"|'[^']*'|[^\s;&|)]+)/gi

/**
 * B16 · The first protected file that the command text names ANYWHERE: an argument, a redirect target (`>`, `>>`,
 * `tee`), a path inside `-c` or `-e` code (`python -c "open('AGENTS.md','w')"`), a nested shell or quote, after a
 * `cd` into a folder, either slash, any case, relative or absolute, or a Windows alias of it. A saved rule never
 * approves it; only a plain read from the built-in safe list stays answered (the policy decides that).
 */
export function commandMentionsProtected(command: string): { path: string; kind: ProtectedConfigKind } | null {
  // An escaped quote (`\"AGENTS.md\"`) leaves a backslash at a token's edge; it is not part of the path.
  const candidates = command.split(PATH_BREAK).map(token => token.replace(/^\\+|\\+$/g, '')).filter(Boolean)
  const folders = [...command.matchAll(CHANGE_DIR)].map(match => match[1].replace(/^["']|["']$/g, ''))
  for (const candidate of candidates) {
    for (const path of [candidate, ...folders.map(folder => `${folder}/${candidate}`)]) {
      const kind = protectedConfigKind(path)
      if (kind) return { path: candidate, kind }
    }
  }
  return null
}

/**
 * A command the built-in read-only list alone approves, whatever rules are saved (`cat AGENTS.md`): reading a
 * protected file changes nothing, so naming one in such a command is not a reason to guard it.
 */
export function isPlainSafeRead(command: string): boolean {
  if (commandWritesProtected(command) || commandRewritesTracked(command)) return false
  const verdict = evaluateShellCommand(command, { allow: [], deny: [], useDefaults: true })
  return verdict.decision === 'allow' && verdict.viaDefaults === true
}

/**
 * B16 · Whether a command can change a protected file: it writes one, names one outside a plain safe read, or rewrites
 * tracked files without naming them. The policy guards it, and no card offers "for the session" for it.
 */
export function commandTouchesProtected(command: string): boolean {
  if (commandWritesProtected(command) || commandRewritesTracked(command)) return true
  return commandMentionsProtected(command) !== null && !isPlainSafeRead(command)
}

/** Git subcommands that rewrite tracked files without naming each one. */
const GIT_REWRITERS = new Set(['checkout', 'switch', 'restore', 'apply', 'merge', 'rebase', 'reset', 'clean', 'am', 'cherry-pick', 'pull', 'revert'])
/** Git options that come before the subcommand and take a value. */
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** The texts a command runs: the line itself and the code inside its quotes (`sh -c '…'`, `powershell -c "…"`), nested. */
function commandTexts(command: string, depth = 0): string[] {
  if (depth > 3) return [command]
  const quoted = [...command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(match => (match[1] ?? match[2] ?? '').replace(/\\"/g, '"')).filter(text => /\s/.test(text))
  return [command, ...quoted.flatMap(text => commandTexts(text, depth + 1))]
}

/** What rewrites tracked files in one tokenized sub-command, or null. */
function rewriterIn(tokens: string[]): string | null {
  const head = baseName(tokens[0] ?? '').toLowerCase()
  if (head === 'git') {
    let index = 1
    while (index < tokens.length && tokens[index].startsWith('-')) index += GIT_VALUE_OPTIONS.has(tokens[index]) ? 2 : 1
    const sub = (tokens[index] ?? '').toLowerCase()
    if (sub === 'stash') return ['pop', 'apply'].includes((tokens[index + 1] ?? '').toLowerCase()) ? `git stash ${tokens[index + 1].toLowerCase()}` : null
    return GIT_REWRITERS.has(sub) ? `git ${sub}` : null
  }
  if (head === 'tar') {
    const first = tokens[1] ?? ''
    const extracts = /^-?[A-Za-z]*x/.test(first) && !/^--/.test(first) || tokens.slice(1).some(token => /^(--extract|--get)$/.test(token) || /^-[A-Za-z]*x[A-Za-z]*$/.test(token))
    return extracts ? 'tar x' : null
  }
  if (head === 'unzip') return tokens.slice(1).some(token => /^-[ltvZ]+$/.test(token)) ? null : 'unzip'
  if (/^7z[ar]?$/.test(head)) return /^[xe]$/i.test(tokens[1] ?? '') ? `${head} x` : null
  if (head === 'expand-archive') return 'Expand-Archive'
  return null
}

/**
 * B16 · A command that rewrites tracked files without naming them: git checkout, switch, restore, apply, merge, rebase,
 * reset, clean, am, cherry-pick, revert, pull, stash pop and stash apply, and archive extraction (tar x, unzip, 7z x,
 * Expand-Archive), alone or inside a nested shell. Any project with a git hooks folder or an instructions file has
 * a protected file it could rewrite, so these are never approved by a saved rule. git commit, push, add, status,
 * diff, log, fetch and branch are not here.
 */
export function commandRewritesTracked(command: string): string | null {
  for (const text of commandTexts(command)) {
    for (const sub of splitShellCommand(text) ?? text.split(/&&|\|\||[;|&\n]/)) {
      const tokens = tokenize(sub.trim())
      const found = rewriterIn(tokens) ?? (/(^|[\s;])expand-archive(\s|$)/i.test(sub) ? 'Expand-Archive' : null)
      if (found) return found
    }
  }
  return null
}

/** `git config` options that write; its other action options read. */
const GIT_CONFIG_WRITES = new Set(['--add', '--unset', '--unset-all', '--replace-all', '--rename-section', '--remove-section', '--edit', '-e'])
const GIT_CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--get-color', '--get-colorbool', '--list', '-l', '--blob'])
/** `git config` options that take the next token as their value. */
const GIT_CONFIG_VALUE_OPTIONS = new Set(['--blob', '--type', '-t', '--default', '--comment', '--value'])
/** The subcommands of git 2.46+ (`git config set`, `git config list`). */
const GIT_CONFIG_WRITE_SUBS = new Set(['set', 'unset', 'rename-section', 'remove-section', 'edit'])
const GIT_CONFIG_READ_SUBS = new Set(['get', 'list', 'get-color', 'get-colorbool'])

/** The file one tokenized `git config` writes, or null when it reads, writes an ordinary file or is not `git config`. */
function gitConfigTarget(tokens: string[]): string | null {
  if (baseName(tokens[0] ?? '').toLowerCase() !== 'git') return null
  let index = 1
  while (index < tokens.length && tokens[index].startsWith('-')) index += GIT_VALUE_OPTIONS.has(tokens[index]) ? 2 : 1
  if ((tokens[index] ?? '').toLowerCase() !== 'config') return null
  let file: string | null = null
  let scope = '.git/config'
  let writes = false
  let reads = false
  const positional: string[] = []
  for (let at = index + 1; at < tokens.length; at++) {
    const token = tokens[at]
    const equals = token.startsWith('--') ? token.indexOf('=') : -1
    const option = equals > 0 ? token.slice(0, equals) : token
    const inline = equals > 0 ? token.slice(equals + 1) : undefined
    if (option === '--global') scope = '~/.gitconfig'
    else if (option === '--system') scope = 'etc/gitconfig'
    else if (option === '--worktree') scope = '.git/config.worktree'
    else if (option === '--local') scope = '.git/config'
    else if (option === '--file' || option === '-f') { file = inline ?? tokens[at + 1] ?? ''; if (inline === undefined) at++ }
    else if (GIT_CONFIG_WRITES.has(option)) writes = true
    else if (GIT_CONFIG_READS.has(option) || GIT_CONFIG_VALUE_OPTIONS.has(option)) {
      if (GIT_CONFIG_READS.has(option)) reads = true
      if (GIT_CONFIG_VALUE_OPTIONS.has(option) && inline === undefined) at++
    } else if (!token.startsWith('-')) positional.push(token)
  }
  const sub = (positional[0] ?? '').toLowerCase()
  if (GIT_CONFIG_WRITE_SUBS.has(sub)) writes = true
  // Without an action or a read subcommand, `git config name value` sets a value and `git config name` reads one.
  else if (!GIT_CONFIG_READ_SUBS.has(sub) && !writes && !reads && positional.length >= 2) writes = true
  if (!writes) return null
  if (file !== null) return protectedConfigKind(file) ? file : null
  return scope
}

/**
 * B16 · A `git config` that writes git's configuration: global, system, the repository's, a worktree's, or a protected
 * file named with --file, alone or inside a nested shell. Setting a value, --add, --unset, --replace-all,
 * --rename-section, --remove-section and --edit write; --get, --list and the other reads do not. `git -c name=value`
 * lasts one command and is left alone.
 */
export function commandWritesGitConfig(command: string): { path: string; kind: 'git' } | null {
  for (const text of commandTexts(command)) {
    for (const sub of splitShellCommand(text) ?? text.split(/&&|\|\||[;|&\n]/)) {
      const path = gitConfigTarget(tokenize(sub.trim()))
      if (path) return { path, kind: 'git' }
    }
  }
  return null
}

/** English, for the audit trail and logs; the person sees `protectedConfigNote` in their language. */
export function protectedConfigReason(path: string, kind: ProtectedConfigKind): string {
  if (kind === 'git') return `"${path}" holds git configuration. Git can run commands named there, so it needs your confirmation each time.`
  return `"${path}" holds ${PROTECTED_CONFIG_LABEL[kind]}. A change there steers every later session, so it needs your confirmation each time.`
}

/** The same reason as a C3 code (`thread.protectedConfig.<kind>`), for the approval card. */
export function protectedConfigNote(path: string, kind: ProtectedConfigKind): MainMessage {
  return mainMessage(`thread.protectedConfig.${kind}`, { path })
}

/** English reason for a command that rewrites tracked files without naming them. */
export function rewritesTrackedReason(command: string): string {
  return `${command} rewrites tracked files without naming them, and agent instructions, MCP settings or hooks may be among them, so it needs your confirmation each time.`
}

export function rewritesTrackedNote(command: string): MainMessage {
  return mainMessage('thread.protectedConfig.rewritesTracked', { command })
}

export const PROTECTED_CONFIG_WARNING = 'Text the agent read (a web page, an issue, a file) may be steering this change. Check that you asked for it.'
export const PROTECTED_CONFIG_WARNING_NOTE: MainMessage = mainMessage('thread.protectedConfig.warning', {})
