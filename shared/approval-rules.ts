/**
 * B10 · Pure rules behind the approvals contract (shared/types/approvals.ts), the same in main, the window and tests.
 */
import { APPROVAL_AGENT_TEXT_MAX, APPROVAL_CRITICAL_ALLOW_DELAY_MS, APPROVAL_RISKS, type ApprovalAgentText, type ApprovalIntent, type ApprovalRequest, type ApprovalRisk } from './types/approvals'

// ---- reserved names: in ./reserved-names, re-exported so callers keep one import ------------------------

export { foldName, RESERVED_APP_NAMES, RESERVED_EXACT_NAMES, reservedNameIn, withoutReservedName, type ReservedAppName } from './reserved-names'

// ---- risk ----------------------------------------------------------------------------------

/** The OxeQuery SQL classifier's verdict (`guardSql` in electron/main/services/oxequery/sql-guard.ts). */
export type SqlKind = 'empty' | 'read' | 'write' | 'ddl' | 'destructive'
/** The shell classifier's level (`classifyShellRisk` in electron/main/services/conversation/shell-risk.ts). */
export type ShellLevel = 'green' | 'orange' | 'red'

const SQL_RISK: Record<SqlKind, ApprovalRisk> = { empty: 'low', read: 'low', write: 'medium', ddl: 'high', destructive: 'critical' }
// Red is critical, like a destructive statement and like the OxeChat approval card: the 2 s hold, no allow for the run.
const SHELL_RISK: Record<ShellLevel, ApprovalRisk> = { green: 'low', orange: 'medium', red: 'critical' }

/** One step up, for a production environment. */
export function raiseRisk(risk: ApprovalRisk): ApprovalRisk {
  return APPROVAL_RISKS[Math.min(APPROVAL_RISKS.indexOf(risk) + 1, APPROVAL_RISKS.length - 1)]
}

export function riskFromSql(kind: SqlKind, production = false): ApprovalRisk {
  return production ? raiseRisk(SQL_RISK[kind]) : SQL_RISK[kind]
}

export function riskFromShell(level: ShellLevel): ApprovalRisk {
  return SHELL_RISK[level]
}

// ---- the requester's text ------------------------------------------------------------------

/** Bounds the requester's text for the window. Nothing is rewritten: markdown, bullets and control lines stay literal. */
export function boundAgentText(text: string, max = APPROVAL_AGENT_TEXT_MAX): ApprovalAgentText {
  const chars = [...text]
  return chars.length > max
    ? { text: chars.slice(0, max).join(''), untrusted: true, length: chars.length, truncated: true }
    : { text, untrusted: true, length: chars.length, truncated: false }
}

/**
 * Whether a text of `length` characters may be shown at `risk`: whole up to the cap; above it a change is refused before
 * it is shown, and only a low-risk request is cut and offered deny only.
 */
export function agentTextAdmission(length: number, risk: ApprovalRisk, max = APPROVAL_AGENT_TEXT_MAX): 'show' | 'truncate' | 'refuse' {
  if (length <= max) return 'show'
  return risk === 'low' ? 'truncate' : 'refuse'
}

/** The window-facing pacing for a risk: critical holds Allow back and turns Enter off. */
export function approvalPacing(risk: ApprovalRisk): { allowDelayMs: number; enterDisabled: boolean } {
  return risk === 'critical' ? { allowDelayMs: APPROVAL_CRITICAL_ALLOW_DELAY_MS, enterDisabled: true } : { allowDelayMs: 0, enterDisabled: false }
}

/**
 * Main's own check of the critical delay: an allow is refused before the window acknowledged showing the request
 * visible and focused, or sooner than `allowDelayMs` after that. A deny is never held back.
 */
export function allowTooSoon(request: Pick<ApprovalRequest, 'allowDelayMs'>, intent: ApprovalIntent, displayedAt: number | undefined, now: number): boolean {
  if (intent === 'deny' || request.allowDelayMs <= 0) return false
  return displayedAt === undefined || now - displayedAt < request.allowDelayMs
}

/**
 * What every request main emits must satisfy: unique option ids, a deny option as the default, no allow option when
 * the text was cut (the person must see all of what they approve), "allow for this session" only for low risk, and the
 * critical pacing. Returns the broken rules, empty when the request is sound.
 */
export function approvalRequestProblems(request: ApprovalRequest): string[] {
  const problems: string[] = []
  const ids = request.options.map(option => option.id)
  if (new Set(ids).size !== ids.length) problems.push('duplicate option ids')
  const fallback = request.options.find(option => option.id === request.defaultOptionId)
  if (!fallback || fallback.intent !== 'deny') problems.push('the default option is not a deny option')
  if (!request.options.some(option => option.intent === 'deny')) problems.push('no deny option')
  if (request.agentText.truncated && request.options.some(option => option.intent !== 'deny')) problems.push('allow offered for a cut text')
  if (request.risk !== 'low' && request.options.some(option => option.intent === 'allow-session')) problems.push('allow-session above low risk')
  if (request.agentText.untrusted !== true) problems.push('agent text not marked untrusted')
  if (request.expiresAt <= request.createdAt) problems.push('expires before it is created')
  if (request.risk === 'critical' && (request.allowDelayMs < APPROVAL_CRITICAL_ALLOW_DELAY_MS || !request.enterDisabled)) problems.push('critical without the allow delay and Enter off')
  return problems
}

/** R2 · The one shared list (S2): main and the window read the same module. */
export { HIDDEN_CHARACTERS, hasHiddenCharacters } from './hidden-characters'

// ---- where a request is shown ----------------------------------------------------------------

export interface SurfaceState {
  /** A live, not destroyed, app window exists. */
  hasWindow: boolean
  ackRequired: boolean
  /** The window acknowledged this generation. */
  acked: boolean
  /** The window reported `approvals.unavailable` for this generation. */
  unavailable: boolean
  /** Since the request was sent to the window. */
  elapsedMs: number
  ackTimeoutMs: number
}

/**
 * The fallback rule. `window` keeps the request in the app's modal, `native` asks with `dialog.showMessageBox` (once,
 * for this request only), `wait` keeps waiting for an acknowledgement.
 */
export function approvalSurface(state: SurfaceState): 'window' | 'native' | 'wait' {
  if (!state.hasWindow || state.unavailable) return 'native'
  if (!state.ackRequired || state.acked) return 'window'
  return state.elapsedMs >= state.ackTimeoutMs ? 'native' : 'wait'
}
