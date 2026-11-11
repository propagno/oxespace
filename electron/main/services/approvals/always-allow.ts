/**
 * F7 · A26 / T74 (SECURITY S1–S3, HML 714-1..3): Always allow offer analysis, atomic Claude project rule persistence,
 * database provenance tracking, and Codex session-only allow rules.
 */
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { MessageCode } from '../../../../shared/messages'
import type { ThreadAlwaysAllowOffer, ThreadAlwaysAllowReasonKind, ThreadAlwaysAllowRule, ThreadRequest } from '../../../../shared/types/thread'
import type { AppDatabase } from '../../db'
import { classifyShellRisk } from '../conversation/shell-risk'

export type { ThreadAlwaysAllowOffer as AlwaysAllowOffer, ThreadAlwaysAllowReasonKind as AlwaysAllowReasonKind, ThreadAlwaysAllowRule as AlwaysAllowRule }

export interface StoredAlwaysAllowRule {
  id: string
  provider: 'claude' | 'codex'
  text: string
  scope: 'project' | 'session'
  project?: string
  addedAt: number
}

export type AlwaysAllowApplyResult =
  | { ok: true; rule: ThreadAlwaysAllowRule }
  | { ok: false; reasonKind: ThreadAlwaysAllowReasonKind; code?: undefined }
  | { ok: false; code: MessageCode; reasonKind?: undefined }

export type AlwaysAllowRevokeResult =
  | { ok: true; restore: () => { ok: boolean } }
  | { ok: false; code: MessageCode }

export interface AlwaysAllowDeps {
  projectRoot: () => string
  db: AppDatabase
  now?: () => number
}

interface ProvenanceRow {
  id: string
  provider: string
  rule: string
  file: string
  project: string
  added_at: number
  thread_id: string | null
}

interface CodexRuleEntry {
  id: string
  threadId: string
  text: string
  addedAt: number
}

const ELEVATION_PROGRAMS = new Set(['sudo', 'doas', 'runas', 'su', 'gsudo', 'pkexec'])
const CODE_PROGRAMS = new Set([
  'node', 'nodejs', 'python', 'python3', 'python2', 'py', 'ruby', 'perl', 'php', 'lua',
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd',
  'eval', 'exec', 'source', '.', 'npx', 'bunx', 'dlx', 'deno', 'bun', 'ts-node', 'tsx',
  'make', 'gmake', 'cmake', 'env', 'xargs'
])
const DESTRUCTIVE_PROGRAMS = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'del', 'erase', 'rd', 'remove-item', 'ri', 'format', 'mkfs', 'dd'
])
const NETWORK_PROGRAMS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp',
  'gh', 'az', 'aws', 'gcloud', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod',
  'pip', 'pip3', 'pipx', 'gem', 'brew', 'apt', 'apt-get', 'apk', 'dnf', 'yum', 'pacman', 'choco', 'winget', 'scoop'
])
const SUBCOMMAND_REQUIRED = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'docker', 'podman', 'cargo', 'go', 'kubectl', 'terraform', 'dotnet', 'composer', 'mvn', 'gradle', 'uv', 'twine'
])
const NPM_NETWORK_SUBS = new Set([
  'install', 'i', 'ci', 'add', 'update', 'upgrade', 'up', 'audit', 'login', 'adduser', 'deprecate', 'dist-tag', 'owner', 'access'
])

function normalizeProgramName(raw: string): string {
  return raw.toLowerCase().replace(/\.exe$/i, '')
}

interface ShellScan {
  kind: 'ok' | 'compound' | 'redirect' | 'code'
  tokens: string[]
}

function scanShellLine(line: string): ShellScan {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'ok', tokens: [] }
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let i = 0

  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (inSingle) {
      if (ch === '\'') inSingle = false
      else current += ch
      i++
      continue
    }
    if (inDouble) {
      if (ch === '\\' && i + 1 < trimmed.length) {
        const next = trimmed[i + 1]
        if (next === '`' || next === '$') return { kind: 'code', tokens: [] }
        current += next
        i += 2
        continue
      }
      if (ch === '`' || (ch === '$' && trimmed[i + 1] === '(')) return { kind: 'code', tokens: [] }
      if (ch === '"') inDouble = false
      else current += ch
      i++
      continue
    }

    if (ch === '\'') { inSingle = true; i++; continue }
    if (ch === '"') { inDouble = true; i++; continue }
    if (ch === '\\' && i + 1 < trimmed.length) {
      current += trimmed[i + 1]
      i += 2
      continue
    }
    if (ch === '`' || (ch === '$' && trimmed[i + 1] === '(')) return { kind: 'code', tokens: [] }
    if (ch === '\n' || ch === '\r' || ch === ';') return { kind: 'compound', tokens: [] }
    if (ch === '&' && trimmed[i + 1] === '&') return { kind: 'compound', tokens: [] }
    if (ch === '|' && trimmed[i + 1] === '|') return { kind: 'compound', tokens: [] }
    if (ch === '|') return { kind: 'compound', tokens: [] }
    if (ch === '>') return { kind: 'redirect', tokens: [] }
    if ((ch === '1' || ch === '2' || ch === '&') && trimmed[i + 1] === '>' && current === '') {
      return { kind: 'redirect', tokens: [] }
    }
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = '' }
      i++
      continue
    }
    current += ch
    i++
  }

  if (current) tokens.push(current)
  return { kind: 'ok', tokens }
}

function stripLeadingPrefixes(rawTokens: string[]): string[] {
  const tokens = [...rawTokens]
  while (tokens.length > 0) {
    const head = tokens[0]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      tokens.shift()
      continue
    }
    if (head === 'time') {
      tokens.shift()
      while (tokens.length > 0 && tokens[0].startsWith('-')) tokens.shift()
      continue
    }
    if (head === 'timeout') {
      tokens.shift()
      while (tokens.length > 0 && tokens[0].startsWith('-')) {
        const flag = tokens.shift()!
        if ((flag === '-k' || flag === '-s') && tokens.length > 0) tokens.shift()
      }
      if (tokens.length > 0) tokens.shift() // duration token
      continue
    }
    break
  }
  return tokens
}

function firstNonFlag(args: string[]): string | undefined {
  return args.find(arg => !arg.startsWith('-'))
}

function isInsideRoot(realRoot: string, candidateRealPath: string): boolean {
  const rel = relative(realRoot, candidateRealPath)
  if (!rel) return true
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  return true
}

export function alwaysAllowOffer(request: ThreadRequest, provider: 'claude' | 'codex'): ThreadAlwaysAllowOffer {
  if (/powershell|pwsh/i.test(request.toolName ?? '')) {
    return { offered: false, reasonKind: 'code' }
  }
  const rawCommand = request.command ?? ''
  const scan = scanShellLine(rawCommand)
  if (scan.kind === 'compound') return { offered: false, reasonKind: 'compound' }
  if (scan.kind === 'redirect') return { offered: false, reasonKind: 'redirect' }
  if (scan.kind === 'code') return { offered: false, reasonKind: 'code' }

  const tokens = stripLeadingPrefixes(scan.tokens)
  if (tokens.length === 0) return { offered: false, reasonKind: 'broad' }

  const rawProg = tokens[0]
  const prog = normalizeProgramName(rawProg)
  const args = tokens.slice(1)
  const lowerArgs = args.map(a => a.toLowerCase())
  const sub = firstNonFlag(args)?.toLowerCase()

  // 1. Elevation
  if (ELEVATION_PROGRAMS.has(prog)) return { offered: false, reasonKind: 'elevation' }
  if (prog === 'start-process' && lowerArgs.some((a, idx) => (a === '-verb' && lowerArgs[idx + 1] === 'runas') || a === '-verbrunas')) {
    return { offered: false, reasonKind: 'elevation' }
  }

  // 2. Code / interpreters / launchers / scripts
  if (
    rawProg.startsWith('./') || rawProg.startsWith('../') || rawProg.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(rawProg) || rawProg.includes('/') || rawProg.includes('\\') ||
    /\.(?:sh|bash|zsh|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl)$/i.test(rawProg)
  ) {
    return { offered: false, reasonKind: 'code' }
  }
  if (CODE_PROGRAMS.has(prog)) return { offered: false, reasonKind: 'code' }
  if ((prog === 'pnpm' || prog === 'yarn') && sub === 'dlx') return { offered: false, reasonKind: 'code' }
  if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn') && (sub === 'exec' || sub === 'x')) return { offered: false, reasonKind: 'code' }
  if ((prog === 'docker' || prog === 'podman') && (sub === 'run' || sub === 'exec')) return { offered: false, reasonKind: 'code' }

  // 3. Push / publish (checked before network so gh pr create/merge & gh release classify as push)
  if (prog === 'git' && sub === 'push') return { offered: false, reasonKind: 'push' }
  if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn' || prog === 'cargo') && sub === 'publish') return { offered: false, reasonKind: 'push' }
  if ((prog === 'docker' || prog === 'podman') && sub === 'push') return { offered: false, reasonKind: 'push' }
  if (prog === 'twine' && sub === 'upload') return { offered: false, reasonKind: 'push' }
  if (prog === 'gh') {
    const ghTarget = lowerArgs[0]
    const ghAction = lowerArgs[1]
    if ((ghTarget === 'pr' && (ghAction === 'create' || ghAction === 'merge')) || ghTarget === 'release') {
      return { offered: false, reasonKind: 'push' }
    }
  }

  // 4. Destructive
  if (DESTRUCTIVE_PROGRAMS.has(prog)) return { offered: false, reasonKind: 'destructive' }
  if (prog === 'git') {
    if (sub === 'clean' || sub === 'restore') return { offered: false, reasonKind: 'destructive' }
    if (sub === 'reset' && lowerArgs.some(a => a === '--hard' || a === '--merge')) return { offered: false, reasonKind: 'destructive' }
    if (sub === 'checkout' && (args.includes('--') || args.includes('.') || lowerArgs.includes('-f') || lowerArgs.includes('--force'))) {
      return { offered: false, reasonKind: 'destructive' }
    }
    if (sub === 'stash' && (lowerArgs.includes('drop') || lowerArgs.includes('clear'))) return { offered: false, reasonKind: 'destructive' }
    if (sub === 'branch' && (args.includes('-D') || (lowerArgs.includes('-d') && lowerArgs.includes('--force')))) return { offered: false, reasonKind: 'destructive' }
  }
  if (prog === 'sed' && args.some(a => a === '-i' || a.startsWith('-i') || a.startsWith('--in-place'))) {
    return { offered: false, reasonKind: 'destructive' }
  }
  if (prog === 'find' && lowerArgs.some(a => a === '-delete' || a === '-exec' || a === '-execdir')) {
    return { offered: false, reasonKind: 'destructive' }
  }
  if (prog === 'docker' || prog === 'podman') {
    if (sub === 'compose' && (lowerArgs.includes('down') || lowerArgs.includes('rm'))) return { offered: false, reasonKind: 'destructive' }
    if (lowerArgs.includes('prune') || sub === 'rm' || sub === 'rmi') return { offered: false, reasonKind: 'destructive' }
  }
  if (prog === 'terraform' && (sub === 'apply' || sub === 'destroy')) return { offered: false, reasonKind: 'destructive' }
  if (prog === 'kubectl' && (sub === 'delete' || sub === 'apply' || sub === 'drain')) return { offered: false, reasonKind: 'destructive' }

  // 5. Network
  if (NETWORK_PROGRAMS.has(prog)) return { offered: false, reasonKind: 'network' }
  if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn') && sub && NPM_NETWORK_SUBS.has(sub)) {
    return { offered: false, reasonKind: 'network' }
  }
  if (prog === 'uv' && (lowerArgs.includes('install') || lowerArgs.includes('sync') || sub === 'add')) {
    return { offered: false, reasonKind: 'network' }
  }
  if (prog === 'cargo' && (sub === 'install' || sub === 'login' || sub === 'search' || sub === 'update' || sub === 'fetch')) {
    return { offered: false, reasonKind: 'network' }
  }
  if (prog === 'go' && (sub === 'install' || sub === 'get')) return { offered: false, reasonKind: 'network' }
  if (prog === 'git' && (sub === 'fetch' || sub === 'pull' || sub === 'clone' || sub === 'ls-remote' || sub === 'submodule')) {
    return { offered: false, reasonKind: 'network' }
  }
  if ((prog === 'docker' || prog === 'podman') && (sub === 'pull' || sub === 'login' || sub === 'build')) {
    return { offered: false, reasonKind: 'network' }
  }

  // 6. Broad (bare tool with no subcommand)
  if (SUBCOMMAND_REQUIRED.has(prog) && !sub) {
    return { offered: false, reasonKind: 'broad' }
  }
  if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn') && sub === 'run') {
    const runIdx = args.findIndex(a => a.toLowerCase() === 'run')
    const scriptName = args.slice(runIdx + 1).find(a => a !== '--' && !a.startsWith('-'))
    if (!scriptName) return { offered: false, reasonKind: 'broad' }
  }

  // Fallback shell risk red guard
  if (classifyShellRisk(tokens.join(' ')).level === 'red') {
    return { offered: false, reasonKind: 'destructive' }
  }

  // Build exact prefix
  let prefix: string
  let isScriptRunner = false
  if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn') && sub === 'run') {
    const runIdx = args.findIndex(a => a.toLowerCase() === 'run')
    const scriptName = args.slice(runIdx + 1).find(a => a !== '--' && !a.startsWith('-'))!
    prefix = `${rawProg} run ${scriptName}`
    isScriptRunner = true
  } else if (sub) {
    const exactSub = args.find(a => !a.startsWith('-'))!
    prefix = `${rawProg} ${exactSub}`
    if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn') && (sub === 'test' || sub === 'start' || sub === 'build')) {
      isScriptRunner = true
    }
  } else {
    prefix = rawProg
  }

  const rule: ThreadAlwaysAllowRule = provider === 'claude'
    ? { provider: 'claude', text: `Bash(${prefix}:*)`, scope: 'project' }
    : { provider: 'codex', text: prefix, scope: 'session' }

  return isScriptRunner
    ? { offered: true, rule, runsProjectCode: true, definedIn: 'package.json' }
    : { offered: true, rule }
}

export class AlwaysAllow {
  private readonly codexRules = new Map<string, CodexRuleEntry>()

  constructor(private readonly deps: AlwaysAllowDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  apply(request: ThreadRequest, provider: 'claude' | 'codex', options?: { threadId?: string; projectRoot?: string }): AlwaysAllowApplyResult {
    const offer = alwaysAllowOffer(request, provider)
    if (!offer.offered) {
      return { ok: false, reasonKind: offer.reasonKind }
    }

    if (provider === 'codex') {
      const threadId = options?.threadId ?? ''
      const exists = [...this.codexRules.values()].some(entry => entry.threadId === threadId && entry.text === offer.rule.text)
      if (!exists) {
        const id = randomUUID()
        this.codexRules.set(id, { id, threadId, text: offer.rule.text, addedAt: this.now() })
      }
      return { ok: true, rule: offer.rule }
    }

    const rawRoot = options?.projectRoot ?? this.deps.projectRoot()
    const checked = this.inspectClaudeSettings(rawRoot)
    if (!checked.ok) return { ok: false, code: checked.code }

    const { realRoot, claudeDir, settingsFile, doc, allowList } = checked
    if (allowList.includes(offer.rule.text)) {
      return { ok: true, rule: offer.rule }
    }

    const writeErr = this.writeClaudeAllowList(realRoot, claudeDir, settingsFile, doc, [...allowList, offer.rule.text])
    if (writeErr) return { ok: false, code: writeErr }

    this.deps.db.prepare(
      'INSERT INTO always_allow_rules (id, provider, rule, file, project, added_at, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), 'claude', offer.rule.text, settingsFile, realRoot, this.now(), options?.threadId ?? null)

    return { ok: true, rule: offer.rule }
  }

  list(): StoredAlwaysAllowRule[] {
    const rows = this.deps.db.prepare(
      'SELECT id, provider, rule, file, project, added_at, thread_id FROM always_allow_rules ORDER BY added_at ASC, rowid ASC'
    ).all() as ProvenanceRow[]

    const claude = rows.map((row): StoredAlwaysAllowRule => ({
      id: row.id,
      provider: 'claude',
      text: row.rule,
      scope: 'project',
      project: row.project,
      addedAt: row.added_at
    }))

    const codex = [...this.codexRules.values()].map((entry): StoredAlwaysAllowRule => ({
      id: entry.id,
      provider: 'codex',
      text: entry.text,
      scope: 'session',
      addedAt: entry.addedAt
    }))

    return [...claude, ...codex]
  }

  revoke(id: string): AlwaysAllowRevokeResult {
    const codex = this.codexRules.get(id)
    if (codex) {
      this.codexRules.delete(id)
      return {
        ok: true,
        restore: () => {
          this.codexRules.set(codex.id, codex)
          return { ok: true }
        }
      }
    }

    const row = this.deps.db.prepare(
      'SELECT id, provider, rule, file, project, added_at, thread_id FROM always_allow_rules WHERE id = ?'
    ).get(id) as ProvenanceRow | undefined
    if (!row) return { ok: false, code: 'approvals.refused.notPending' }

    const checked = this.inspectClaudeSettings(row.project)
    if (!checked.ok) return { ok: false, code: checked.code }

    const idx = checked.allowList.indexOf(row.rule)
    if (idx !== -1) {
      const nextAllow = [...checked.allowList.slice(0, idx), ...checked.allowList.slice(idx + 1)]
      const writeErr = this.writeClaudeAllowList(checked.realRoot, checked.claudeDir, checked.settingsFile, checked.doc, nextAllow)
      if (writeErr) return { ok: false, code: writeErr }
    }

    this.deps.db.prepare('DELETE FROM always_allow_rules WHERE id = ?').run(row.id)

    return {
      ok: true,
      restore: () => this.restoreClaudeRule(row)
    }
  }

  sessionAllows(threadId: string, commandText: string): boolean {
    if (!threadId) return false
    const fakeRequest = {
      id: '',
      nativeId: '',
      nativeMethod: 'item/commandExecution/requestApproval',
      kind: 'approval' as const,
      title: commandText,
      toolName: 'Bash',
      command: commandText,
      generation: 1,
      createdAt: 0,
      state: 'pending' as const
    }
    const offer = alwaysAllowOffer(fakeRequest, 'codex')
    if (!offer.offered) return false
    return [...this.codexRules.values()].some(entry => entry.threadId === threadId && entry.text === offer.rule.text)
  }

  endSession(threadId: string): void {
    for (const [id, entry] of this.codexRules) {
      if (entry.threadId === threadId) this.codexRules.delete(id)
    }
  }

  private restoreClaudeRule(row: ProvenanceRow): { ok: boolean } {
    const checked = this.inspectClaudeSettings(row.project)
    if (!checked.ok) return { ok: false }
    if (!checked.allowList.includes(row.rule)) {
      const writeErr = this.writeClaudeAllowList(checked.realRoot, checked.claudeDir, checked.settingsFile, checked.doc, [...checked.allowList, row.rule])
      if (writeErr) return { ok: false }
    }
    this.deps.db.prepare(
      'INSERT OR IGNORE INTO always_allow_rules (id, provider, rule, file, project, added_at, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.provider, row.rule, row.file, row.project, row.added_at, row.thread_id)
    return { ok: true }
  }

  private inspectClaudeSettings(rawRoot: string):
    | { ok: true; realRoot: string; claudeDir: string; settingsFile: string; doc: Record<string, unknown>; allowList: string[] }
    | { ok: false; code: MessageCode } {
    let realRoot: string
    try {
      realRoot = realpathSync.native(rawRoot)
    } catch {
      return { ok: false, code: 'approvals.alwaysAllow.outsideProject' }
    }

    const claudeDir = join(realRoot, '.claude')
    try {
      const dirStat = lstatSync(claudeDir)
      if (dirStat.isSymbolicLink()) return { ok: false, code: 'approvals.alwaysAllow.outsideProject' }
      if (!dirStat.isDirectory()) return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
      const realClaude = realpathSync.native(claudeDir)
      if (!isInsideRoot(realRoot, realClaude)) return { ok: false, code: 'approvals.alwaysAllow.outsideProject' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, code: 'approvals.alwaysAllow.outsideProject' }
      }
    }

    const settingsFile = join(claudeDir, 'settings.local.json')
    let doc: Record<string, unknown> = {}
    try {
      const fileStat = lstatSync(settingsFile)
      if (fileStat.isSymbolicLink()) return { ok: false, code: 'approvals.alwaysAllow.outsideProject' }
      if (!fileStat.isFile()) return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
      const realSettings = realpathSync.native(settingsFile)
      if (!isInsideRoot(realRoot, realSettings)) return { ok: false, code: 'approvals.alwaysAllow.outsideProject' }
      const raw = readFileSync(settingsFile, 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
      }
      doc = parsed as Record<string, unknown>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
      }
    }

    const permissions = doc.permissions
    if (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions))) {
      return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
    }
    const rawAllow = (permissions as Record<string, unknown> | undefined)?.allow
    if (rawAllow !== undefined && (!Array.isArray(rawAllow) || rawAllow.some(item => typeof item !== 'string'))) {
      return { ok: false, code: 'approvals.alwaysAllow.invalidSettings' }
    }

    return {
      ok: true,
      realRoot,
      claudeDir,
      settingsFile,
      doc,
      allowList: rawAllow ? [...(rawAllow as string[])] : []
    }
  }

  private writeClaudeAllowList(
    realRoot: string,
    claudeDir: string,
    settingsFile: string,
    doc: Record<string, unknown>,
    allowList: string[]
  ): MessageCode | null {
    mkdirSync(claudeDir, { recursive: true })
    try {
      const dirStat = lstatSync(claudeDir)
      if (dirStat.isSymbolicLink() || !isInsideRoot(realRoot, realpathSync.native(claudeDir))) {
        return 'approvals.alwaysAllow.outsideProject'
      }
    } catch {
      return 'approvals.alwaysAllow.outsideProject'
    }

    const prevPermissions = (doc.permissions && typeof doc.permissions === 'object' && !Array.isArray(doc.permissions))
      ? (doc.permissions as Record<string, unknown>)
      : {}
    const nextDoc = {
      ...doc,
      permissions: {
        ...prevPermissions,
        allow: allowList
      }
    }
    const tempFile = join(claudeDir, `.settings.local.${randomUUID()}.tmp`)
    try {
      writeFileSync(tempFile, `${JSON.stringify(nextDoc, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(tempFile, settingsFile)
      return null
    } catch {
      try { unlinkSync(tempFile) } catch { /* ignore */ }
      return 'approvals.alwaysAllow.invalidSettings'
    }
  }
}
