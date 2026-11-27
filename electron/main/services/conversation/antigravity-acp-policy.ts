import { posix, win32 } from 'node:path'
import type {
  ThreadConfiguration,
  ThreadPermissionRule,
  ThreadRequest,
  ThreadRequestPolicy,
  ThreadRequestQuestion
} from '../../../../shared/types/thread'
import { BACKGROUND_TRUST_MS } from '../../../../shared/threadBackground'
import { alwaysAllowOffer } from '../approvals/always-allow'
import { evaluatePermission, mcpToolName } from './kernel/permission-policy'
import { commandTouchesProtected, protectedConfigKind } from './kernel/protected-config'
import { checkWorkspacePath } from './path-safety'
import { evaluateShellCommand, suggestRules } from './shell-command-rules'
import { readsOutsideProject } from './shell-reads'
import { classifyShellRisk } from './shell-risk'
import type { ThreadPermissionStore } from './thread-permissions'

export type AntigravityAccess = NonNullable<ThreadConfiguration['access']>
export type AntigravityPermissionStore = Pick<ThreadPermissionStore, 'evaluate' | 'add' | 'rules' | 'audit'>

export interface AntigravityModeConfiguration {
  access?: ThreadConfiguration['access']
  approvalPolicy?: ThreadConfiguration['approvalPolicy'] | 'on-failure' | 'always'
  mode?: ThreadConfiguration['mode'] | 'accept-edits' | 'auto'
}

export interface AntigravityPermissionOption {
  id: string
  kind: string
  name?: string
}

export type AntigravityPermissionDecision =
  | { action: 'approve'; optionId: string; reason: string; viaRule?: boolean }
  | { action: 'reject'; optionId?: string; reason: string }
  | { action: 'ask'; guarded: boolean }

export interface AntigravityPermissionContext {
  rootPath: string
  access: AntigravityAccess
  approvalPolicy: string
  mode: string
  nativeMode: string
  kind: string
  request: ThreadRequest
  options: readonly AntigravityPermissionOption[]
  permissions?: AntigravityPermissionStore
  sessionRules: readonly ThreadPermissionRule[]
  sessionTools: ReadonlySet<string>
}

export const ANTIGRAVITY_WRITE_KINDS = new Set(['edit', 'delete', 'move', 'execute'])
export const ANTIGRAVITY_FILE_KINDS = new Set(['edit', 'delete', 'move'])
const READ_KINDS = new Set(['read', 'search', 'think', 'list'])
const QUESTION_TOOL_RE = /^(?:ask_?question|ask_?user|ask_?user_?question|request_?user_?input)$/i
const BACKGROUND_TOOL_RE = /\b(?:schedule|invoke_subagent|subagent|spawn_agent|swarm)\b/i

const SECRET_FILE_NAMES = new Set([
  '.env', '.npmrc', '.pypirc', '.netrc', '.htpasswd',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials.json'
])
const SECRET_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function normalizeModeKey(value: string): string { return value.trim().toLowerCase().replace(/[_-]/g, '') }

function pickAdvertisedMode(preferred: readonly string[], available?: readonly string[]): string {
  const advertised = (available ?? []).map(item => item.trim()).filter(Boolean)
  if (!advertised.length) return preferred[0]
  for (const candidate of preferred) {
    if (advertised.includes(candidate)) return candidate
  }
  for (const candidate of preferred) {
    const key = normalizeModeKey(candidate)
    const found = advertised.find(item => normalizeModeKey(item) === key)
    if (found) return found
  }
  return advertised.find(item => normalizeModeKey(item) === 'default') ?? advertised[0]
}

/**
 * Maps OXESpace `(mode, access, approvalPolicy)` against the ACP modes the server advertised
 * (`session/new`, `session/resume`, `session/load`). Never falls back to an unadvertised mode id
 * when `availableModes` is non-empty, and never forces `default` for writable autonomous workflows.
 */
export function resolveAntigravityMode(
  configuration: AntigravityModeConfiguration,
  availableModes?: readonly string[]
): string {
  const mode = normalizeModeKey(configuration.mode ?? 'default')
  const policy = (configuration.approvalPolicy ?? 'on-request').trim().toLowerCase()
  const access = configuration.access ?? 'read-only'
  const advertised = (availableModes ?? []).map(item => item.trim()).filter(Boolean)

  if (mode === 'plan') return pickAdvertisedMode(['plan', 'default'], advertised)
  if (access === 'read-only') return pickAdvertisedMode(['default'], advertised)
  if (policy === 'always' || policy === 'untrusted') {
    if (mode === 'acceptedits') return pickAdvertisedMode(['accept-edits', 'acceptEdits', 'default'], advertised)
    return pickAdvertisedMode(['default'], advertised)
  }
  if (access === 'full-access') {
    if (policy === 'never') {
      if (!advertised.length) return 'auto'
      return pickAdvertisedMode(['yolo', 'bypassPermissions', 'bypass-permissions', 'auto', 'accept-edits', 'acceptEdits', 'default'], advertised)
    }
    return pickAdvertisedMode(['auto', 'bypassPermissions', 'bypass-permissions', 'yolo', 'accept-edits', 'acceptEdits', 'default'], advertised)
  }
  if (mode === 'auto') {
    return pickAdvertisedMode(['auto', 'yolo', 'bypassPermissions', 'bypass-permissions', 'accept-edits', 'acceptEdits', 'default'], advertised)
  }
  if (mode === 'acceptedits') {
    return pickAdvertisedMode(['accept-edits', 'acceptEdits', 'auto', 'default'], advertised)
  }
  if (access === 'workspace-write') {
    if (policy === 'never') {
      return pickAdvertisedMode(['auto', 'accept-edits', 'acceptEdits', 'yolo', 'bypassPermissions', 'default'], advertised)
    }
    return pickAdvertisedMode(['accept-edits', 'acceptEdits', 'auto', 'default'], advertised)
  }
  return pickAdvertisedMode(['default'], advertised)
}

/** Sensitive credential/environment files that workspace autonomy must never auto-approve silently. */
export function isSensitiveSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').trim().toLowerCase()
  if (!normalized) return false
  const parts = normalized.split('/').filter(Boolean)
  const base = parts[parts.length - 1] ?? ''
  if (SECRET_FILE_NAMES.has(base) || base.startsWith('.env.')) return true
  if (/\.(?:pem|key|p12|pfx|jks)$/.test(base)) return true
  return parts.some(part => SECRET_SEGMENTS.has(part))
}

function pathCheckOptions(rootPath: string): { windows: boolean } {
  return { windows: rootPath.startsWith('/') ? false : process.platform === 'win32' }
}

function pathsSafeInWorkspace(rootPath: string, paths: readonly string[]): boolean {
  const opts = pathCheckOptions(rootPath)
  for (const candidate of paths) {
    if (!checkWorkspacePath(rootPath, candidate, opts).safe) return false
    if (protectedConfigKind(candidate) !== null) return false
    if (isSensitiveSecretPath(candidate)) return false
  }
  return true
}

function pickOption(options: readonly AntigravityPermissionOption[], ...kinds: string[]): string | undefined {
  for (const kind of kinds) {
    const found = options.find(option => option.kind === kind)
    if (found) return found.id
  }
  return undefined
}

function requestTouchesProtected(request: ThreadRequest): boolean {
  if (request.paths?.some(path => protectedConfigKind(path) !== null)) return true
  if (request.command && commandTouchesProtected(request.command)) return true
  return false
}

/**
 * Evaluates an incoming ACP `session/request_permission` against:
 * 1. Read-only write block
 * 2. Persisted `ThreadPermissionStore` rules (matching command/path/MCP tool)
 * 3. Session-level "Always allow" grants
 * 4. Active workspace autonomy mode (while preserving protected-config, secret, out-of-workspace & destructive guardrails)
 */
export function evaluateAntigravityPermission(ctx: AntigravityPermissionContext): AntigravityPermissionDecision {
  const { rootPath, access, kind, request, options, permissions, sessionRules, sessionTools } = ctx
  const policy = ctx.approvalPolicy.trim().toLowerCase()
  const mode = normalizeModeKey(ctx.mode)
  const nativeMode = normalizeModeKey(ctx.nativeMode)

  if (access === 'read-only' && ANTIGRAVITY_WRITE_KINDS.has(kind)) {
    return { action: 'reject', optionId: pickOption(options, 'reject_once', 'reject_always'), reason: 'Read-only conversation blocks write operations.' }
  }

  let storeVerdict: ThreadRequestPolicy | undefined
  if (permissions) {
    try { storeVerdict = permissions.evaluate(rootPath, request) } catch { storeVerdict = undefined }
  }
  if (storeVerdict?.decision === 'deny') {
    return { action: 'reject', optionId: pickOption(options, 'reject_once', 'reject_always'), reason: storeVerdict.reasons.join(' ') || 'Blocked by permission rule.' }
  }
  if (storeVerdict?.guarded || requestTouchesProtected(request)) {
    return { action: 'ask', guarded: true }
  }
  if (storeVerdict?.decision === 'allow') {
    if (!storeVerdict.safeList) {
      const optionId = pickOption(options, 'allow_always', 'allow_once')
      if (optionId) return { action: 'approve', optionId, reason: 'Allowed by persisted permission rule.', viaRule: true }
    } else if (policy !== 'always' && policy !== 'untrusted') {
      const optionId = pickOption(options, 'allow_once', 'allow_always')
      if (optionId) return { action: 'approve', optionId, reason: 'Allowed by built-in read-only safe list.' }
    }
  }

  if (sessionRules.length) {
    const sessionVerdict = evaluatePermission(request, rootPath, [...sessionRules], pathCheckOptions(rootPath), { readOnlyList: false })
    if (sessionVerdict?.guarded) return { action: 'ask', guarded: true }
    if (sessionVerdict?.decision === 'allow') {
      const optionId = pickOption(options, 'allow_always', 'allow_once')
      if (optionId) return { action: 'approve', optionId, reason: 'Allowed for this session.', viaRule: true }
    }
  }
  if (!request.command && !request.paths?.length && request.toolName && sessionTools.has(request.toolName)) {
    const optionId = pickOption(options, 'allow_always', 'allow_once')
    if (optionId) return { action: 'approve', optionId, reason: 'Allowed tool for this session.', viaRule: true }
  }

  if (access === 'read-only' || policy === 'always' || policy === 'untrusted') {
    return { action: 'ask', guarded: false }
  }
  if (mode === 'plan' && ANTIGRAVITY_WRITE_KINDS.has(kind)) {
    return { action: 'ask', guarded: false }
  }

  const paths = request.paths ?? []
  const autonomousMode = nativeMode === 'acceptedits' || nativeMode === 'auto' || nativeMode === 'yolo' || nativeMode === 'bypasspermissions'
  const permitsWorkspaceEdits = autonomousMode || access === 'full-access' || access === 'workspace-write' || mode === 'acceptedits' || mode === 'auto'

  if (kind === 'edit' && permitsWorkspaceEdits && paths.length > 0 && pathsSafeInWorkspace(rootPath, paths)) {
    const optionId = pickOption(options, 'allow_once', 'allow_always')
    if (optionId) return { action: 'approve', optionId, reason: 'Auto-approved workspace edit under active autonomy mode.' }
  }

  if (READ_KINDS.has(kind) && (paths.length === 0 || pathsSafeInWorkspace(rootPath, paths))) {
    const optionId = pickOption(options, 'allow_once', 'allow_always')
    if (optionId) return { action: 'approve', optionId, reason: 'Auto-approved read-only workspace operation.' }
  }

  if (kind === 'execute' && request.command) {
    const risk = classifyShellRisk(request.command)
    if (access === 'full-access') {
      if (policy === 'never' || risk.level !== 'red') {
        const optionId = policy === 'never' ? pickOption(options, 'allow_always', 'allow_once') : pickOption(options, 'allow_once', 'allow_always')
        if (optionId) return { action: 'approve', optionId, reason: 'Auto-approved under full-access autonomy.' }
      }
      return { action: 'ask', guarded: false }
    }
    if (access === 'workspace-write' && risk.level !== 'red') {
      const shell = evaluateShellCommand(request.command, { allow: [], deny: [], useDefaults: true })
      const outside = shell.decision === 'allow' && shell.defaultSubcommands?.length
        ? readsOutsideProject(shell.defaultSubcommands, rootPath, pathCheckOptions(rootPath))
        : []
      if (shell.decision === 'allow' && shell.viaDefaults && outside.length === 0) {
        const optionId = pickOption(options, 'allow_once', 'allow_always')
        if (optionId) return { action: 'approve', optionId, reason: 'Auto-approved read-only command in workspace.' }
      }
    }
  }

  if ((kind === 'delete' || kind === 'move') && access === 'full-access' && policy === 'never') {
    const optionId = pickOption(options, 'allow_always', 'allow_once')
    if (optionId) return { action: 'approve', optionId, reason: 'Auto-approved under full-access never-ask policy.' }
  }

  return { action: 'ask', guarded: false }
}

/**
 * Derives narrow, safe `ThreadPermissionStore` rules when a user chooses "Always allow" (`acceptForSession`).
 * Refuses to persist guarded, destructive, network, push, out-of-workspace, or secret-file rules.
 */
export function deriveAntigravityPersistRules(
  rootPath: string,
  request: ThreadRequest
): Array<{ kind: ThreadPermissionRule['kind']; pattern: string }> {
  if (request.kind !== 'approval' || request.policy?.guarded || requestTouchesProtected(request)) return []
  const rules: Array<{ kind: ThreadPermissionRule['kind']; pattern: string }> = []

  if (request.command) {
    if (classifyShellRisk(request.command).level === 'red') return []
    const offer = alwaysAllowOffer(request, 'claude')
    if (!offer.offered) return []
    for (const suggestion of suggestRules(request.command)) {
      if (!rules.some(entry => entry.kind === 'command' && entry.pattern === suggestion.rule)) {
        rules.push({ kind: 'command', pattern: suggestion.rule })
      }
    }
  }

  if (request.paths?.length) {
    if (!pathsSafeInWorkspace(rootPath, request.paths)) return []
    const opts = pathCheckOptions(rootPath)
    const pathImpl = opts.windows ? win32 : posix
    const resolvedRoot = pathImpl.resolve(rootPath)
    for (const candidate of request.paths) {
      const verdict = checkWorkspacePath(rootPath, candidate, opts)
      if (!verdict.safe) return []
      const local = pathImpl.relative(resolvedRoot, verdict.resolved).split(/[\\/]/).join('/')
      if (!local || local === '.' || local.startsWith('..')) continue
      const dir = local.includes('/') ? local.slice(0, local.indexOf('/')) : ''
      const pattern = dir ? `${dir}/**` : local
      if (pattern === '.' || pattern === '**' || pattern === '*') continue
      if (!rules.some(entry => entry.kind === 'path' && entry.pattern === pattern)) {
        rules.push({ kind: 'path', pattern })
      }
    }
  }

  const mcp = mcpToolName(request.toolName)
  if (mcp && !request.command && !request.paths?.length) {
    rules.push({ kind: 'tool', pattern: `${mcp.server}/${mcp.tool}` })
  }

  return rules
}

/** Extracts structured multi-choice questions from ACP question requests or `ask_question` tool payloads. */
export function extractAntigravityQuestions(
  method: string,
  call: Record<string, unknown>,
  params: Record<string, unknown>
): ThreadRequestQuestion[] {
  const input = record(call.rawInput)
  const directMethod = method === 'session/request_user_input' || method === 'session/ask_question'
  const toolTitle = text(call.title) || text(input.tool) || text(input.name)
  const kind = text(call.kind)
  const rawQuestions = directMethod
    ? list(params.questions ?? input.questions)
    : list(input.questions ?? params.questions)

  const looksLikeQuestion = directMethod
    || kind === 'question'
    || QUESTION_TOOL_RE.test(toolTitle.trim())
    || rawQuestions.length > 0

  if (!looksLikeQuestion) return []

  const items = rawQuestions.length
    ? rawQuestions
    : text(input.question || params.question)
      ? [{ question: text(input.question || params.question), options: input.options ?? params.options, is_multi_select: input.is_multi_select ?? input.multiSelect }]
      : []

  const questions: ThreadRequestQuestion[] = []
  items.slice(0, 20).forEach((entry, index) => {
    const item = record(entry)
    const prompt = text(item.question || item.prompt || item.text).trim().slice(0, 2000)
    if (!prompt) return
    const id = text(item.id).trim() || `q-${index}`
    const header = text(item.header || item.title).trim().slice(0, 80) || undefined
    const multiple = item.is_multi_select === true || item.multiSelect === true || item.multiple === true
    const rawOptions = list(item.options).slice(0, 20)
    const options = rawOptions.flatMap(rawOpt => {
      if (typeof rawOpt === 'string') {
        const label = rawOpt.trim().slice(0, 200)
        return label ? [{ label, value: label }] : []
      }
      const opt = record(rawOpt)
      const label = text(opt.label || opt.name || opt.value).trim().slice(0, 200)
      const value = text(opt.value || opt.id || opt.label || opt.name).trim().slice(0, 200)
      const description = text(opt.description).trim().slice(0, 500) || undefined
      return label ? [{ label, value: value || label, ...(description ? { description } : {}) }] : []
    })
    questions.push({ id, ...(header ? { header } : {}), question: prompt, ...(multiple ? { multiple: true } : {}), ...(options.length ? { options } : {}) })
  })
  return questions
}

/**
 * Returns how long (in ms) the session should stay protected from idle suspension after observing
 * a background-scheduling tool call (`schedule`, `invoke_subagent`, background `run_command`, `swarm`).
 */
export function detectAntigravityBackgroundHoldMs(update: Record<string, unknown>): number {
  const title = text(update.title)
  const kind = text(update.kind)
  const input = record(update.rawInput)
  const durationSeconds = typeof input.DurationSeconds === 'number' && Number.isFinite(input.DurationSeconds) && input.DurationSeconds > 0
    ? input.DurationSeconds
    : typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
      ? input.durationSeconds
      : undefined
  if (durationSeconds !== undefined) {
    return Math.min(Math.round(durationSeconds * 1000) + 120_000, BACKGROUND_TRUST_MS)
  }
  if (text(input.CronExpression) || text(input.cronExpression)) return BACKGROUND_TRUST_MS
  if (input.IsDaemon === true || input.isDaemon === true || input.background === true) return BACKGROUND_TRUST_MS
  if (typeof input.NotificationTimeoutSeconds === 'number' && input.NotificationTimeoutSeconds > 0) {
    return Math.min(Math.round(input.NotificationTimeoutSeconds * 1000) + 120_000, BACKGROUND_TRUST_MS)
  }
  if (BACKGROUND_TOOL_RE.test(title) || BACKGROUND_TOOL_RE.test(kind) || BACKGROUND_TOOL_RE.test(text(input.tool) || text(input.name))) {
    return BACKGROUND_TRUST_MS
  }
  return 0
}
