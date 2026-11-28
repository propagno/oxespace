/**
 * Pure, dependency-free shell command risk and protected-config evaluator for inline command edits
 * in OxeChat approval cards. Runs synchronously in the renderer without Node APIs, mirroring the
 * deterministic rubrics in `electron/main/services/conversation/shell-risk.ts`,
 * `electron/main/services/approvals/request-impact.ts`, and `kernel/protected-config.ts`.
 *
 * Security invariants:
 * - Fail closed on unanalysable syntax (substitutions, unbalanced quotes, empty commands).
 * - Never lower risk below the original main-process assessment (use `maxApprovalRisk`).
 * - Always flag protected agent-steering files (`.mcp.json`, `AGENTS.md`, `CLAUDE.md`, hooks, git config, policy).
 */
import { APPROVAL_RISKS, type ApprovalRisk } from './types/approvals'

export interface EditedCommandRisk {
  risk: ApprovalRisk
  reversible: boolean
  guarded: boolean
  unanalysable: boolean
}

const UNANALYSABLE = /\$\(|`|<\(|>\(|\$\{[^}]*\}|\beval\b/

const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])
const NETWORK_REMOTE = new Set([...FETCHERS, 'ssh', 'scp', 'nc', 'ncat'])
const RED_COMMANDS = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'dd', 'mkfs', 'format', 'format-volume', 'clear-disk',
  'shutdown', 'reboot', 'sudo', 'su', 'chown', 'set-acl', 'set-executionpolicy', 'kill', 'killall', 'taskkill',
  'stop-process', 'spps', 'invoke-expression', 'iex', 'eval'
])
const SHELLS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'node', 'ruby', 'perl', 'iex', 'invoke-expression'
])

const GIT_RED = /^git(\s+(-C\s+\S+|--no-pager))*\s+(push\b|reset\s.*--hard\b|clean\s.*-[a-z]*f|checkout\s.*(--\s|\.$)|restore\s|branch\s.*-D\b|rebase\b|filter-branch\b|reflog\s+(expire|delete)\b|gc\s.*--prune|stash\s+(drop|clear)\b)/i
const PUBLISH_OR_PUSH = /^(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate|dist-tag|owner|access|login|adduser|token)\b|^cargo\s+(publish|yank|login|owner)\b|^gh\s+(release\b|pr\s+(merge|create)\b|repo\s+(delete|create)\b|secret\s)|^(docker|podman)\s+(push|image\s+push)\b|^twine\s+upload\b/i
const GLOBAL_INSTALL = /^(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall|rm|link)\b.*(\s-g\b|--global\b)/i
const RECURSIVE_PERMS = /^(chmod|chown)\s+(-[a-zA-Z]*R|--recursive)\b/
const EXTRA_DESTRUCTIVE = /^(sed\s+.*(-[a-zA-Z]*i|--in-place)\b|find\s+.*-delete\b|kubectl\s+delete\b|terraform\s+(apply|destroy)\b|(docker|podman)\s+(rm|rmi|volume\s+rm|(system|volume|container|image)\s+prune|compose\s+.*\bdown\b.*(-v\b|--volumes\b))|docker-compose\s+down\b.*(-v\b|--volumes\b))/i

const READ_ONLY_SINGLE = new Set([
  'cd', 'echo', 'ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'findstr', 'wc', 'tr', 'cut', 'cmp', 'which', 'basename',
  'dirname', 'realpath', 'readlink', 'stat', 'file', 'od', 'du', 'df', 'sleep', 'nl', 'grep', 'rg', 'tree',
  'get-childitem', 'get-content', 'get-date', 'get-random', 'get-location', 'set-location', 'write-host',
  'write-output', 'out-string', 'split-path', 'join-path', 'start-sleep', 'where-object', 'select-object',
  'select-string', 'measure-object', 'compare-object', 'format-list', 'format-table', 'sort-object'
])
const GIT_SAFE_READ = /^git(\s+(-C\s+\S+|--no-pager))*\s+(status|log|show|diff|ls-files|grep|branch)\b/i
const GIT_DANGEROUS_FLAG = /\s(--output\b|-[a-zA-Z]*[dDmM]\b|--delete\b|--force\b|-c\b|--exec-path\b|--upload-pack\b|--receive-pack\b)/
const LOW_RISK_CHECKS = /^(?:(npm|pnpm|yarn|bun)\s+(?:test|t|tst|ls|list|outdated|view|info|show|explain|why|audit|run\s+(?:test|lint|typecheck|check)(?::\S+)?)\b|(?:vitest|jest|pytest|tsc)\b|cargo\s+(?:test|check|clippy)\b|go\s+(?:test|vet)\b)/i

const PROTECTED_FILE_RE = /(?:^|[\\/\s"'`=(])(?:\.mcp\.json|agents\.md|claude(?:\.local)?\.md|gemini\.md|\.cursorrules|\.windsurfrules|copilot-instructions\.md|oxe\.yaml|\.gitconfig|\.claude[\\/]settings(?:\.local)?\.json|\.claude[\\/]hooks[\\/]|\.codex[\\/](?:hooks(?:\.json|[\\/])|config\.toml)|\.gemini[\\/]settings\.json|\.git[\\/](?:hooks[\\/]|config(?:\.worktree)?|info[\\/]attributes)|\.husky[\\/]|\.(?:cursor|vscode)[\\/]mcp\.json|\.cursor[\\/]rules[\\/]|\.github[\\/]copilot-instructions\.md|\.oxespace[\\/]policy\.json)(?:$|[\\/\s"'`;|&<>])/i
const GIT_CONFIG_WRITE_RE = /\bgit(?:\.exe)?\s+(?:-[^\s]+\s+)*config\b(?!.*\s--(?:get|get-all|get-regexp|list)\b)/i
const GIT_REWRITE_TRACKED_RE = /\bgit(?:\.exe)?\s+(?:-[^\s]+\s+)*(?:checkout|switch|restore|apply|merge|rebase|reset|clean|am|cherry-pick|pull|revert)\b/i

const baseName = (token: string): string =>
  token.replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

function splitSubcommands(line: string): string[] | null {
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
    if (ch === '&' && (line[i - 1] === '>' || line[i + 1] === '>')) { current += ch; continue }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '\r') { parts.push(current); current = ''; continue }
    current += ch
  }
  if (quote) return null
  parts.push(current)
  return parts.map(part => part.trim()).filter(Boolean)
}

function tokenize(subcommand: string): string[] {
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

function hasFileRedirect(sub: string): boolean {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < sub.length; i += 1) {
    const ch = sub[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"') i += 1
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '\\') { i += 1; continue }
    if (ch !== '>') continue
    let j = i + 1
    while (sub[j] === '>') j += 1
    if (sub[j] === '&' && /[\d-]/.test(sub[j + 1] ?? '')) { i = j + 1; continue }
    if (sub[j] === '&' || sub[j] === '|') j += 1
    while (sub[j] === ' ' || sub[j] === '\t') j += 1
    let target = ''
    let q: '"' | "'" | null = null
    for (; j < sub.length; j += 1) {
      const c = sub[j]
      if (q) { if (c === q) q = null; else target += c; continue }
      if (c === '"' || c === "'") { q = c; continue }
      if (/\s/.test(c) || c === '>' || c === '<') break
      target += c
    }
    const lower = target.toLowerCase()
    if (!(lower === '/dev/null' || lower === 'nul' || lower === '$null')) return true
    i = j - 1
  }
  return false
}

function pipesDownloadIntoShell(line: string): boolean {
  const parts = line.split(/(?<!\|)\|(?!\|)/).map(part => baseName(tokenize(part.trim())[0] ?? ''))
  return parts.some((head, index) => index > 0 && SHELLS.has(head)) && parts.some(head => FETCHERS.has(head))
}

function isSafeReadSubcommand(head: string, normalised: string, tokens: string[]): boolean {
  if (head === 'rg' && tokens.slice(1).some(t => /^--(pre|hostname-bin)/.test(t))) return false
  if (head === 'tree' && tokens.slice(1).some(t => t === '-o')) return false
  if (READ_ONLY_SINGLE.has(head)) return true
  if (GIT_SAFE_READ.test(normalised) && !GIT_DANGEROUS_FLAG.test(normalised)) return true
  return false
}

function isLowRiskSubcommand(head: string, normalised: string, tokens: string[]): boolean {
  if (isSafeReadSubcommand(head, normalised, tokens)) return true
  if (LOW_RISK_CHECKS.test(normalised) && !/\sfix\b/.test(normalised)) return true
  return false
}

/** Higher of two approval risks; never downgrades. */
export function maxApprovalRisk(a: ApprovalRisk, b: ApprovalRisk): ApprovalRisk {
  return APPROVAL_RISKS.indexOf(a) >= APPROVAL_RISKS.indexOf(b) ? a : b
}

/** Re-evaluates a user-edited shell command synchronously in the renderer. */
export function evaluateEditedShellCommand(command: string): EditedCommandRisk {
  const trimmed = command.trim()
  if (!trimmed) return { risk: 'medium', reversible: false, guarded: false, unanalysable: true }

  const mentionsProtected = PROTECTED_FILE_RE.test(trimmed) || GIT_CONFIG_WRITE_RE.test(trimmed) || GIT_REWRITE_TRACKED_RE.test(trimmed)
  const subcommands = splitSubcommands(trimmed)
  if (!subcommands || subcommands.length === 0) {
    return { risk: 'high', reversible: false, guarded: mentionsProtected, unanalysable: true }
  }

  let risk: ApprovalRisk = 'low'
  let reversible = true
  let allPlainSafeReads = true

  if (pipesDownloadIntoShell(trimmed)) {
    risk = 'critical'
    reversible = false
    allPlainSafeReads = false
  }

  for (const sub of subcommands) {
    const tokens = tokenize(sub)
    if (!tokens.length) continue
    const head = baseName(tokens[0])
    const normalised = [head, ...tokens.slice(1)].join(' ')
    const redirect = hasFileRedirect(sub)
    if (redirect) {
      risk = 'critical'
      reversible = false
      allPlainSafeReads = false
    }
    if (
      RED_COMMANDS.has(head)
      || GIT_RED.test(normalised)
      || PUBLISH_OR_PUSH.test(normalised)
      || GLOBAL_INSTALL.test(normalised)
      || RECURSIVE_PERMS.test(normalised)
      || EXTRA_DESTRUCTIVE.test(normalised)
    ) {
      risk = 'critical'
      reversible = false
      allPlainSafeReads = false
      continue
    }
    if (NETWORK_REMOTE.has(head)) {
      risk = maxApprovalRisk(risk, 'high')
      reversible = false
      allPlainSafeReads = false
      continue
    }
    if (!isSafeReadSubcommand(head, normalised, tokens)) {
      allPlainSafeReads = false
    }
    if (!isLowRiskSubcommand(head, normalised, tokens)) {
      risk = maxApprovalRisk(risk, 'medium')
    }
  }

  const guarded = mentionsProtected && !allPlainSafeReads
  if (guarded && risk === 'low') {
    risk = 'medium'
  }

  return { risk, reversible, guarded, unanalysable: false }
}
