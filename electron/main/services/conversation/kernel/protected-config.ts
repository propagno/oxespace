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

export type ProtectedConfigKind = 'instructions' | 'mcp' | 'hooks' | 'git' | 'policy'

export const PROTECTED_CONFIG_LABEL: Record<ProtectedConfigKind, string> = {
  instructions: 'agent instructions',
  mcp: 'MCP server settings',
  hooks: 'agent hooks',
  git: 'git configuration',
  policy: 'the project\'s agent policy and tool groups'
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
  '.gitconfig': 'git',
  // The tool groups a conversation is offered (B7.3).
  'oxe.yaml': 'policy'
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
  // The XDG files: ~/.config/git/…, $XDG_CONFIG_HOME/git/… in its shell spellings, and a config/git/… folder right
  // under a home (~, $HOME, %USERPROFILE%, /home/<user>, C:/Users/<user>, /root). A project's src/config/git/config is not.
  // `$env` is PowerShell's `$env:NAME`, whose `:NAME` the Windows path reading drops as a stream name.
  { kind: 'git', pattern: /(^|\/)(\.config|\$\{?xdg_config_home\}?|%xdg_config_home%|\$env)\/git\/(config|attributes|ignore)$/, names: ['.config', 'git', 'config', 'attributes', 'ignore'] },
  { kind: 'git', pattern: /(^|\/)(~|\$\{?home\}?|%userprofile%|\$env|home\/[^/]+|users\/[^/]+|root)\/config\/git\/(config|attributes|ignore)$/, names: ['config', 'git', 'attributes', 'ignore'] },
  // A submodule's git folder: its config, its worktree config and its attributes.
  { kind: 'git', pattern: /(^|\/)\.git\/modules\/.+\/(config|config\.worktree|info\/attributes)$/, names: ['.git', 'modules', 'config', 'config.worktree', 'info', 'attributes'] },
  { kind: 'git', pattern: /(^|\/)programdata\/git\/config$/, names: ['programdata', 'git', 'config'] },
  { kind: 'git', pattern: /(^|\/)\.git\/config(\.worktree)?$/, names: ['.git', 'config', 'config.worktree'] },
  { kind: 'git', pattern: /(^|\/)\.git\/worktrees\/[^/]+\/config\.worktree$/, names: ['.git', 'worktrees', 'config.worktree'] },
  { kind: 'git', pattern: /(^|\/)\.git\/info\/attributes$/, names: ['.git', 'info', 'attributes'] },
  { kind: 'git', pattern: /(^|\/)etc\/gitconfig$/, names: ['etc', 'gitconfig'] },
  // The project's policy: the MCP tools the person blocked in Settings › Tools (B7.3), which an agent must not lift.
  { kind: 'policy', pattern: /(^|\/)\.oxespace\/policy\.json$/, names: ['.oxespace', 'policy.json'] }
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
  const gitConfig = commandWritesGitConfig(command) ?? commandWritesComputedGitPath(command)
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
export function isPlainSafeRead(command: string, context: CopyContext = {}): boolean {
  if (commandWritesProtected(command) || commandRewritesTracked(command, context)) return false
  const verdict = evaluateShellCommand(command, { allow: [], deny: [], useDefaults: true })
  return verdict.decision === 'allow' && verdict.viaDefaults === true
}

/**
 * B16 · Whether a command can change a protected file: it writes one, names one outside a plain safe read, or rewrites
 * tracked files without naming them. The policy guards it, and no card offers "for the session" for it.
 */
export function commandTouchesProtected(command: string, context: CopyContext = {}): boolean {
  if (commandWritesProtected(command) || commandRewritesTracked(command, context)) return true
  return commandMentionsProtected(command) !== null && !isPlainSafeRead(command, context)
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

/**
 * What a copy or move check may know about the project: its root, to read an absolute destination, and whether a
 * source is a folder (the caller looks; this module never touches the file system).
 */
export interface CopyContext {
  root?: string
  /** Whether `path`, absolute, is an existing folder. */
  isDirectory?: (path: string) => boolean
}

/** A path the shell resolves to the folder it runs in, or one we cannot read without running it (`$PWD`, `%CD%`). */
const CURRENT_FOLDER = /^(\$|%)/
const ABSOLUTE = /^([a-z]:)?[\\/]/i

/**
 * Whether a copy destination is the project's root, or a folder that holds a protected place (`.claude`, `.git`,
 * `.git/hooks`, `.codex`, `.cursor`, `.oxespace`…, as `PROTECTED_CONFIG_PLACES` lists them), so a recursive copy into
 * it can overwrite a protected file without naming it. An ordinary subfolder (`build/`, `dist`) is not: a name that is
 * protected at any depth (`AGENTS.md`) landing there is B7.4's file watch. A destination above the folder (`..`) is
 * always counted, since a `cd` before it may have made it the root; without the root, so is an absolute one.
 */
function copyTargetIsProtected(operand: string, root?: string): boolean {
  const value = operand.replace(/^["']|["']$/g, '')
  if (!value || value.startsWith('~')) return false
  if (CURRENT_FOLDER.test(value)) return true
  if (!ABSOLUTE.test(value) && segments(value)[0] === '..') return true
  let rel: string[]
  if (root) {
    const base = segments(root)
    const full = ABSOLUTE.test(value) ? segments(value) : segments(`${root}/${value}`)
    if (full.length < base.length || base.some((part, index) => full[index] !== part)) return false
    rel = full.slice(base.length)
  } else {
    if (ABSOLUTE.test(value)) return true
    rel = segments(value)
  }
  if (!rel.length) return true
  // A protected place, spelled from the root, under the destination: `<dest>/x`, `<dest>/<name>` or `<dest>/<name>/x`
  // for each known name. Anchored, so `build/` does not count for the `.husky/` a copy could create inside it.
  const base = rel.join('/')
  const probes = [`${base}/x`, ...KNOWN_NAMES.flatMap(name => [`${base}/${name}`, `${base}/${name}/x`])]
  return probes.some(probe => ROOT_PLACES.some(place => place.test(probe)))
}

/** `PROTECTED_CONFIG_PLACES` matched from the project's root only (each pattern starts with `(^|\/)`). */
const ROOT_PLACES = PROTECTED_CONFIG_PLACES.map(place => new RegExp(place.pattern.source.replace(/^\(\^\|\\\/\)/, '^')))

/** Arguments that are not options: `-x` and `--x` (POSIX), `/X` (Windows tools) and `-Name` (PowerShell) are left out. */
const operands = (tokens: string[], windowsOptions: boolean): string[] =>
  tokens.slice(1).filter(token => !(token.startsWith('-') || (windowsOptions && /^\/[A-Za-z]/.test(token))))
const GLOB = /[*?]/

/**
 * Whether a move source is a folder: written as one (`dist/`, `dist\\`, `.`, `..`), or one in the project
 * when the caller can look (`context.isDirectory`, relative to the root).
 */
function isFolder(operand: string, context: CopyContext): boolean {
  const value = operand.replace(/^["']|["']$/g, '')
  if (/[\\/]$/.test(value) || /^\.{1,2}$/.test(value)) return true
  if (!context.root || !context.isDirectory) return false
  const absolute = ABSOLUTE.test(value) ? value : `${context.root.replace(/[\\/]+$/, '')}/${value}`
  try { return context.isDirectory(absolute) } catch { return false }
}

/**
 * A copy or sync that can write many files without naming them (recursive, a glob, or a tool that copies a whole
 * folder) into the project's root or a folder holding a protected place: `rsync -a ./tmp/ ./`, `cp -r src/ ./`,
 * `robocopy src .`, `xcopy /e src .`, `Copy-Item -Recurse src\* .`. The destination is read leniently (every operand
 * after the first, for cp and rsync, in case an option's value comes last), so a misread one asks rather than
 * allows. A plain copy of named files is not here: `commandWritesProtected` reads its names. A move of a glob or a
 * folder (`mv tmp/* .`, `Move-Item dist\ .`) counts the same; moving a named file (`mv a.txt .`) does not.
 */
function copierIn(tokens: string[], head: string, context: CopyContext = {}): string | null {
  const { root } = context
  const flags = tokens.slice(1).filter(token => token.startsWith('-'))
  let label: string | null = null
  let destinations: string[] = []
  if (head === 'cp' || head === 'rsync') {
    const args = operands(tokens, false)
    const recursive = flags.some(flag => /^-[A-Za-z]*[rRa][A-Za-z]*$/.test(flag) || /^--(recursive|archive)$/.test(flag) || /^-rec/i.test(flag))
    if (recursive) label = `${head} ${head === 'rsync' ? '-a' : '-r'}`
    else if (head === 'cp' && args.slice(0, -1).some(arg => GLOB.test(arg))) label = 'cp *'
    destinations = args.slice(1)
  } else if (head === 'robocopy' || head === 'xcopy') {
    // Both copy every file of a folder (and its subfolders with /S or /E); xcopy's one-operand form copies into here.
    const args = operands(tokens, true)
    label = head
    destinations = [args[1] ?? (head === 'xcopy' ? '.' : '')]
  } else if (['copy-item', 'cpi', 'copy'].includes(head)) {
    const recursive = flags.some(flag => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(flag))
    // -Destination (any prefix of it) names the destination; otherwise it is the second operand, or here.
    const named = tokens.findIndex((token, index) => index > 0 && /^-d(e(s(t(i(n(a(t(i(o(n)?)?)?)?)?)?)?)?)?)?$/i.test(token))
    const valueOf = new Set([named + 1, ...tokens.flatMap((token, index) => /^-(path|literalpath|filter|include|exclude)$/i.test(token) ? [index + 1] : [])])
    const args = tokens.filter((token, index) => index > 0 && !token.startsWith('-') && !valueOf.has(index))
    const sources = [...args, ...tokens.filter((_, index) => /^-(path|literalpath)$/i.test(tokens[index - 1] ?? ''))]
    if (recursive || sources.some(arg => GLOB.test(arg))) label = recursive ? 'Copy-Item -Recurse' : 'Copy-Item *'
    destinations = named > 0 ? [tokens[named + 1] ?? ''] : [args[sources.length > args.length ? 0 : 1] ?? '.']
  } else if (['mv', 'move-item', 'move', 'mi'].includes(head)) {
    // PowerShell's -Destination names the destination; otherwise the last operand is (POSIX mv takes several sources).
    const named = tokens.findIndex((token, index) => index > 0 && /^-d(e(s(t(i(n(a(t(i(o(n)?)?)?)?)?)?)?)?)?)?$/i.test(token))
    const args = tokens.filter((token, index) => index > 0 && !token.startsWith('-') && index !== named + 1)
    const target = named > 0 ? tokens[named + 1] ?? '' : args[args.length - 1] ?? ''
    const sources = named > 0 ? args : args.slice(0, -1)
    if (sources.some(source => GLOB.test(source) || isFolder(source, context))) label = head === 'mv' ? 'mv' : 'Move-Item'
    destinations = [target]
  }
  if (!label) return null
  return destinations.some(arg => copyTargetIsProtected(arg, root)) ? label : null
}

/** What rewrites tracked files in one tokenized sub-command, or null. */
function rewriterIn(tokens: string[], context: CopyContext = {}): string | null {
  const head = baseName(tokens[0] ?? '').toLowerCase()
  const copier = copierIn(tokens, head, context)
  if (copier) return copier
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
 * Expand-Archive), and a recursive copy, sync or folder move into the project's root or a protected place (`copierIn`), alone or
 * inside a nested shell. Any project with a git hooks folder or an instructions file has a protected file it could
 * rewrite, so these are never approved by a saved rule. git commit, push, add, status, diff, log, fetch and branch
 * are not here. `context` gives the project folder, to read an absolute destination, and a folder check for sources.
 */
export function commandRewritesTracked(command: string, context: CopyContext = {}): string | null {
  for (const text of commandTexts(command)) {
    for (const sub of splitShellCommand(text) ?? text.split(/&&|\|\||[;|&\n]/)) {
      const tokens = tokenize(sub.trim())
      const found = rewriterIn(tokens, context) ?? (/(^|[\s;])expand-archive(\s|$)/i.test(sub) ? 'Expand-Archive' : null)
      if (found) return found
    }
  }
  return null
}

/** Every long option of `git config`, old and 2.46+ forms: git accepts any unambiguous prefix of one (`--unset-a`). */
const GIT_CONFIG_LONG = [
  '--global', '--system', '--local', '--worktree', '--file', '--blob', '--get', '--get-all', '--get-regexp', '--get-urlmatch',
  '--replace-all', '--add', '--unset', '--unset-all', '--rename-section', '--remove-section', '--list', '--edit', '--get-color',
  '--get-colorbool', '--type', '--bool', '--int', '--bool-or-int', '--bool-or-str', '--path', '--expiry-date', '--null', '--name-only',
  '--includes', '--show-origin', '--show-scope', '--default', '--fixed-value', '--comment', '--value', '--all', '--url', '--regexp'
]
/** `git config` options that write; the reads below do not. */
const GIT_CONFIG_WRITES = new Set(['--add', '--unset', '--unset-all', '--replace-all', '--rename-section', '--remove-section', '--edit'])
const GIT_CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--get-color', '--get-colorbool', '--list', '--blob'])
/** `git config` options that take the next token as their value. */
const GIT_CONFIG_VALUE_OPTIONS = new Set(['--file', '--blob', '--type', '--default', '--comment', '--value', '--url'])
const GIT_CONFIG_SCOPES: Readonly<Record<string, string>> = { '--global': '~/.gitconfig', '--system': 'etc/gitconfig', '--worktree': '.git/config.worktree', '--local': '.git/config' }
/** The subcommands of git 2.46+ (`git config set`, `git config list`). */
const GIT_CONFIG_WRITE_SUBS = new Set(['set', 'unset', 'rename-section', 'remove-section', 'edit'])
const GIT_CONFIG_READ_SUBS = new Set(['get', 'list', 'get-color', 'get-colorbool'])
/** A --file value the shell computes or that points into a .git folder: it may well be the repository's config. */
const COMPUTED_FILE = /[$`%]|git\s+rev-parse|(^|[\\/])\.git[\\/]/i
/** The endings of git's configuration files, for a write target the shell computes (`$(git rev-parse --git-dir)/config`). */
const GIT_CONFIG_SUFFIX = /(^|\/)(config|config\.worktree|info\/attributes|\.gitconfig|git\/ignore|git\/attributes)$/

/** One path the shell computes ($, ${}, %VAR%, a backtick, $(…), git rev-parse) that ends like a git configuration file. */
function isComputedGitPath(target: string): boolean {
  const path = target.replace(/^["']+|["']+$/g, '').replace(/\\/g, '/').toLowerCase().replace(/[.\s]+$/, '')
  return /[$`%]|git\s+rev-parse/.test(path) && GIT_CONFIG_SUFFIX.test(path)
}

/** A write target in command text: quoted, a `$(…)` or backtick substitution with what follows it, or a plain word. */
const TARGET = /"[^"]*"|'[^']*'|\$\([^)]*\)[^\s;&|<>]*|`[^`]*`[^\s;&|<>]*|[^\s;&|<>]+/g
const REDIRECT = /(?:\d|&)?>>?\|?\s*("[^"]*"|'[^']*'|\$\([^)]*\)[^\s;&|<>]*|`[^`]*`[^\s;&|<>]*|[^\s;&|<>]+)/g
/** Commands whose arguments are files they write; for the copying ones only the destination is. */
const TARGET_WRITERS = new Set(['tee', 'set-content', 'add-content', 'out-file', 'sc', 'ac', 'new-item', 'ni', 'truncate', 'touch', 'dd'])
const COPIERS = new Set(['cp', 'mv', 'install', 'ln', 'copy-item', 'move-item', 'copy', 'move', 'cpi', 'mi'])

/**
 * B16 · A write whose target the shell computes and that ends like a git configuration file: a redirect (`>`, `>>`),
 * tee, a cp or mv destination, Set-Content, Add-Content or Out-File (`echo x >> "$(git rev-parse --git-dir)/config"`).
 */
export function commandWritesComputedGitPath(command: string): { path: string; kind: 'git' } | null {
  for (const text of commandTexts(command)) {
    for (const match of text.matchAll(REDIRECT)) if (isComputedGitPath(match[1])) return { path: match[1].replace(/^["']|["']$/g, ''), kind: 'git' }
    for (const sub of text.split(/&&|\|\||[;|\n]/)) {
      const words = [...sub.matchAll(TARGET)].map(match => match[0])
      let head = 0
      while (head < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[head])) head++
      const name = baseName((words[head] ?? '').replace(/^["']|["']$/g, ''))
      const args = words.slice(head + 1)
      let targets: string[] = []
      if (TARGET_WRITERS.has(name)) targets = args.map(arg => arg.replace(/^(of|-path|-filepath|-literalpath)[=:]/i, ''))
      else if (COPIERS.has(name)) {
        const plain = args.filter(arg => !arg.startsWith('-'))
        const named = args.flatMap((arg, at) => /^(-t|--target-directory|-destination)$/i.test(arg) ? [args[at + 1] ?? ''] : /^--target-directory=/i.test(arg) ? [arg.slice(arg.indexOf('=') + 1)] : [])
        targets = [...plain.slice(-1), ...named]
      }
      const found = targets.find(isComputedGitPath)
      if (found) return { path: found.replace(/^["']|["']$/g, ''), kind: 'git' }
    }
  }
  return null
}

/** The long options a spelling stands for: itself, or every option it is a prefix of (git refuses an ambiguous one). */
function longOptions(option: string): string[] {
  if (GIT_CONFIG_LONG.includes(option)) return [option]
  return option.startsWith('--') && !option.startsWith('--no-') && option.length > 2 ? GIT_CONFIG_LONG.filter(long => long.startsWith(option)) : []
}

/** The file the arguments after `git config` write, or null when they read or write an ordinary file. */
function gitConfigArgsTarget(tokens: string[], start: number): string | null {
  let file: string | null = null
  let scope = '.git/config'
  let writes = false
  let reads = false
  const positional: string[] = []
  for (let at = start; at < tokens.length; at++) {
    const token = tokens[at]
    const equals = token.startsWith('--') ? token.indexOf('=') : -1
    const spelled = equals > 0 ? token.slice(0, equals) : token
    const inline = equals > 0 ? token.slice(equals + 1) : undefined
    if (/^-[a-zA-Z]+$/.test(token)) {
      // Short options, alone or clustered: -e edits, -l lists, -f and -t take a value.
      if (token.includes('e')) writes = true
      if (token.includes('l')) reads = true
      if (token.endsWith('f')) { file = tokens[at + 1] ?? ''; at++ } else if (token.endsWith('t')) at++
      continue
    }
    if (!token.startsWith('--')) { positional.push(token); continue }
    const options = longOptions(spelled)
    // An ambiguous spelling that could be a write is counted as one: git would refuse it, so nothing is lost by asking.
    if (options.some(option => GIT_CONFIG_WRITES.has(option))) writes = true
    if (options.length !== 1) continue
    const [option] = options
    if (GIT_CONFIG_SCOPES[option]) scope = GIT_CONFIG_SCOPES[option]
    else if (GIT_CONFIG_READS.has(option)) reads = true
    if (option === '--file') file = inline ?? tokens[at + 1] ?? ''
    if (GIT_CONFIG_VALUE_OPTIONS.has(option) && inline === undefined) at++
  }
  const sub = (positional[0] ?? '').toLowerCase()
  if (GIT_CONFIG_WRITE_SUBS.has(sub)) writes = true
  // Without an action or a read subcommand, `git config name value` sets a value and `git config name` reads one.
  else if (!GIT_CONFIG_READ_SUBS.has(sub) && !writes && !reads && positional.length >= 2) writes = true
  if (!writes) return null
  if (file !== null) return protectedConfigKind(file) || COMPUTED_FILE.test(file) ? file : null
  return scope
}

/** A command name with the backticks and parentheses of a substitution around it dropped (`` `which git` ``, `$(which git)`). */
const commandName = (token: string): string => baseName(token.replace(/^[`(]+|[`)]+$/g, ''))
/** A command name the shell computes: a variable or a substitution (`$GIT`, `${GIT}`, `$(…)`, `` `…` ``). */
const computedName = (token: string): boolean => /^[$@]|[`]|\$\(/.test(token)
/** `-c alias.<name>=…` whose alias runs `git config` or a shell command (`!…`): the next git call writes config with it. */
const CONFIG_ALIAS = /^alias\.[^=]+=\s*(config\b|!)/i
/** Words that run the command after them: `env`, `sudo`, `timeout 5`, `cmd /c`… */
const WRAPPERS = new Set(['env', 'sudo', 'doas', 'command', 'builtin', 'timeout', 'nohup', 'nice', 'ionice', 'xargs', 'exec', 'time', 'stdbuf', 'cmd', 'call'])

/** Where the command of a sub-command starts, past assignments (`X=1`) and wrappers with their options. */
function commandStart(tokens: string[]): number {
  let at = 0
  while (at < tokens.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[at])) { at++; continue }
    if (!WRAPPERS.has(commandName(tokens[at]))) break
    at++
    while (at < tokens.length && (/^[-/]/.test(tokens[at]) || /^\d/.test(tokens[at]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[at]))) at++
  }
  return at
}

/** PowerShell's `Start-Process git -ArgumentList "config …"` (or `'config','a','b'`, or the second positional): git's arguments. */
function startProcessGitArgs(tokens: string[], at: number): string[] | null {
  const rest = tokens.slice(at + 1)
  let file: string | undefined
  let list: string | undefined
  const positional: string[] = []
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]
    if (/^-(filepath|file|f|path)$/i.test(token)) file = rest[++index]
    else if (/^-(arg|args|argumentlist|argu\w*)$/i.test(token)) list = rest[++index]
    else if (token.startsWith('-')) continue
    else positional.push(token)
  }
  file ??= positional.shift()
  list ??= positional.shift()
  if (!file || commandName(file) !== 'git' || !list) return null
  return list.split(/[\s,]+/).map(arg => arg.replace(/^["']|["']$/g, '')).filter(Boolean)
}

/**
 * What one tokenized sub-command writes of git's configuration, or null. The git command is found anywhere in it, so
 * a prefix (`X=1`, env, sudo, command, timeout, nohup, nice, xargs, exec, cmd /c), `git-config`, a substitution or a
 * variable standing for git does not hide it.
 *
 * Left alone on purpose: `git remote add/set-url`, `git branch --set-upstream-to`, `git submodule` and `git worktree
 * add` write .git/config too, but only URLs, refs and paths that git does not run as commands (the ext:: transport is
 * off by default), and agents run them all day. `git -c name=value` lasts one command, except a config-writing alias.
 */
function gitConfigWriteIn(tokens: string[]): string | null {
  const start = commandStart(tokens)
  for (let at = 0; at < tokens.length; at++) {
    const name = commandName(tokens[at])
    if (name === 'git-config') { const target = gitConfigArgsTarget(tokens, at + 1); if (target) return target; continue }
    if (name === 'git-lfs' && tokens[at + 1]?.toLowerCase() === 'install') return lfsInstallTarget(tokens, at + 2)
    if (name === 'gh' && tokens[at + 1]?.toLowerCase() === 'auth' && tokens[at + 2]?.toLowerCase() === 'setup-git') return '~/.gitconfig'
    if (name === 'start-process' || name === 'saps' || name === 'start') {
      const args = startProcessGitArgs(tokens, at)
      const target = args && gitConfigWriteIn(['git', ...args])
      if (target) return target
      continue
    }
    // A variable or substitution counts as git only where the command stands (`$GIT config`), not as an argument
    // of another program (`npm $CMD config`).
    const computed = at === start && computedName(tokens[at])
    if (name !== 'git' && !computed) continue
    let index = at + 1
    while (index < tokens.length && tokens[index].startsWith('-')) {
      if (tokens[index] === '-c' && CONFIG_ALIAS.test(tokens[index + 1] ?? '')) return '.git/config'
      // `--config-env=alias.x=VAR` takes the alias from the environment: what it runs cannot be read here.
      if (/^--config-env=alias\./i.test(tokens[index]) || (tokens[index] === '--config-env' && /^alias\./i.test(tokens[index + 1] ?? ''))) return '.git/config'
      index += GIT_VALUE_OPTIONS.has(tokens[index]) || tokens[index] === '--config-env' ? 2 : 1
    }
    const sub = (tokens[index] ?? '').toLowerCase()
    const next = (tokens[index + 1] ?? '').toLowerCase()
    // A subcommand the shell computes (`git $(…) …`, `git $SUB`, `& git.exe @args`) may be config.
    if (name === 'git' && sub && computedName(sub)) return '.git/config'
    if (sub === 'config') { const target = gitConfigArgsTarget(tokens, index + 1); if (target) return target }
    // `git maintenance register|start` adds the repository to the global config; `gh auth setup-git` and
    // `git lfs install` set credential helpers and filter drivers there (or in the scope they are given).
    else if (sub === 'maintenance' && (next === 'register' || next === 'start')) return '~/.gitconfig'
    else if (sub === 'lfs' && next === 'install') return lfsInstallTarget(tokens, index + 2)
  }
  return null
}

/** The file `git lfs install` writes its filter driver to: the global config unless a scope is given. */
function lfsInstallTarget(tokens: string[], start: number): string {
  const flags = tokens.slice(start).map(token => token.toLowerCase())
  if (flags.includes('--local')) return '.git/config'
  if (flags.includes('--worktree')) return '.git/config.worktree'
  if (flags.includes('--system')) return 'etc/gitconfig'
  const file = flags.findIndex(token => token === '--file' || token.startsWith('--file='))
  if (file >= 0) return flags[file].includes('=') ? tokens[start + file].slice(tokens[start + file].indexOf('=') + 1) : tokens[start + file + 1] ?? '~/.gitconfig'
  return '~/.gitconfig'
}

/**
 * B16 · A command that writes git's configuration: `git config` in any scope (global, system, the repository's, a
 * worktree's) or with --file naming a protected or computed file, alone, behind a prefix or inside a nested shell;
 * setting a value, --add, --unset, --replace-all, --rename-section, --remove-section and --edit, abbreviated or not.
 * Also `git -c alias.x=config …`, `git maintenance register|start`, `git lfs install` and `gh auth setup-git`.
 * --get, --list and the other reads are not writes.
 */
export function commandWritesGitConfig(command: string): { path: string; kind: 'git' } | null {
  for (const text of commandTexts(command)) {
    for (const sub of splitShellCommand(text) ?? text.split(/&&|\|\||[;|&\n]/)) {
      const path = gitConfigWriteIn(tokenize(sub.trim()))
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
