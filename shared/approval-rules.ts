/**
 * B10 · Pure rules behind the approvals contract (shared/types/approvals.ts), the same in main, the window and tests.
 */
import { APPROVAL_AGENT_TEXT_MAX, APPROVAL_RISKS, type ApprovalAgentText, type ApprovalRequest, type ApprovalRisk } from './types/approvals'

// ---- reserved names ------------------------------------------------------------------------

/** Names only the app speaks as. An agent-chosen pane name, label or notification title may not contain one. */
export const RESERVED_APP_NAMES = ['OXESpace', 'OxeChat', 'OxeCode', 'OxeQuery', 'OxePod', 'OxePost'] as const
/** Generic words the app's own notices could be taken for; refused only as the whole name ("filesystem" stays allowed). */
export const RESERVED_EXACT_NAMES = ['System', 'Sistema'] as const
export type ReservedAppName = typeof RESERVED_APP_NAMES[number] | typeof RESERVED_EXACT_NAMES[number]

/** Letters from other scripts and digits that read as a Latin letter (a small UTS #39-style skeleton for these names). */
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', χ: 'x', υ: 'u', ι: 'i', κ: 'k', τ: 't', ν: 'v', η: 'n', μ: 'm', ϲ: 'c',
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '$': 's', '@': 'a', '|': 'l', '!': 'l'
}

/**
 * Folds a name for comparison: NFKC (full-width and styled letters), lower case, accents and invisible format
 * characters removed, look-alike letters mapped, then everything but letters dropped, so "O X E-Spаce" (with a
 * Cyrillic а) and "ＯＸＥＳＰＡＣＥ" fold the same as "OXESpace". `i` and `l` fold together, as do `rn` and `m`.
 */
export function foldName(value: string): string {
  const lowered = value.normalize('NFKC').toLowerCase().normalize('NFD').replace(/[\p{M}\p{Cf}]/gu, '')
  return [...lowered].map(char => CONFUSABLES[char] ?? char).join('')
    .replace(/[^\p{L}]/gu, '').replace(/i/g, 'l').replace(/rn/g, 'm')
}

const FOLDED_RESERVED = RESERVED_APP_NAMES.map(name => [name, foldName(name)] as const)
const FOLDED_EXACT = RESERVED_EXACT_NAMES.map(name => [name, foldName(name)] as const)

/**
 * The reserved name hidden in `value`, if any. Product names by containment, so "OXESpace: security update" is
 * caught; the generic words by equality.
 */
export function reservedNameIn(value: string): ReservedAppName | null {
  const folded = foldName(value)
  return FOLDED_RESERVED.find(([, reserved]) => folded.includes(reserved))?.[0]
    ?? FOLDED_EXACT.find(([, reserved]) => folded === reserved)?.[0] ?? null
}

// ---- risk ----------------------------------------------------------------------------------

/** The OxeQuery SQL classifier's verdict (`guardSql` in electron/main/services/oxequery/sql-guard.ts). */
export type SqlKind = 'empty' | 'read' | 'write' | 'ddl' | 'destructive'
/** The shell classifier's level (`classifyShellRisk` in electron/main/services/conversation/shell-risk.ts). */
export type ShellLevel = 'green' | 'orange' | 'red'

const SQL_RISK: Record<SqlKind, ApprovalRisk> = { empty: 'low', read: 'low', write: 'medium', ddl: 'high', destructive: 'critical' }
const SHELL_RISK: Record<ShellLevel, ApprovalRisk> = { green: 'low', orange: 'medium', red: 'high' }

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
 * What every request main emits must satisfy: unique option ids, a deny option as the default, no allow option when
 * the text was cut (the person must see all of what they approve), and "allow for this session" only for low risk.
 * Returns the broken rules, empty when the request is sound.
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
  return problems
}

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
