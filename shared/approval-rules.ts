/**
 * B10 · Pure rules behind the approvals contract (shared/types/approvals.ts), the same in main, the window and tests.
 */
import { APPROVAL_AGENT_TEXT_MAX, APPROVAL_CRITICAL_ALLOW_DELAY_MS, APPROVAL_RISKS, type ApprovalAgentText, type ApprovalIntent, type ApprovalRequest, type ApprovalRisk } from './types/approvals'

// ---- reserved names ------------------------------------------------------------------------

/** Names only the app speaks as. An agent-chosen pane name, label or notification title may not contain one. */
export const RESERVED_APP_NAMES = ['OXESpace', 'OxeChat', 'OxeCode', 'OxeQuery', 'OxePod', 'OxePost'] as const
/** Generic words the app's own notices could be taken for; refused only as the whole name ("filesystem" stays allowed). */
export const RESERVED_EXACT_NAMES = ['System', 'Sistema', 'App', 'Aplicativo', 'Application'] as const
export type ReservedAppName = typeof RESERVED_APP_NAMES[number] | typeof RESERVED_EXACT_NAMES[number]

/** Letters from other scripts that read as a Latin letter (a small UTS #39-style skeleton for these names). */
const CONFUSABLE_LETTERS: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
  α: 'a', ε: 'e', ο: 'o', ρ: 'p', χ: 'x', υ: 'u', ι: 'i', κ: 'k', τ: 't', ν: 'v', η: 'n', μ: 'm', ϲ: 'c'
}
/** Digits and symbols that can stand for a letter ("0XESPACE", "$ystem"). */
const CONFUSABLE_SYMBOLS: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '$': 's', '@': 'a', '|': 'l', '!': 'l' }

const lowerPlain = (value: string): string => value.normalize('NFKC').toLowerCase().normalize('NFD').replace(/[\p{M}\p{Cf}]/gu, '')
const skeleton = (letters: string): string =>
  [...letters].map(char => CONFUSABLE_LETTERS[char] ?? char).join('').replace(/i/g, 'l').replace(/rn/g, 'm')

/**
 * Folds a name for comparison: NFKC (full-width and styled letters), lower case, accents and invisible format
 * characters removed, everything but letters dropped, then look-alike letters mapped, so "O X E-Spаce!" (with a
 * Cyrillic а) and "ＯＸＥＳＰＡＣＥ" fold the same as "OXESpace". `i` and `l` fold together, as do `rn` and `m`.
 * Never longer than the letters it was given, and folding twice changes nothing.
 */
export function foldName(value: string): string {
  return skeleton(lowerPlain(value).replace(/[^\p{L}]/gu, ''))
}

/** The same fold, reading digits and symbols as the letters they imitate first ("0XESPACE", "$ystem"). */
function foldNameWithSymbols(value: string): string {
  return skeleton([...lowerPlain(value)].map(char => CONFUSABLE_SYMBOLS[char] ?? char).join('').replace(/[^\p{L}]/gu, ''))
}

const FOLDED_RESERVED = RESERVED_APP_NAMES.map(name => [name, foldName(name)] as const)
const FOLDED_EXACT = RESERVED_EXACT_NAMES.map(name => [name, foldName(name)] as const)

/**
 * The reserved name hidden in `value`, if any. Product names by containment, so "OXESpace: security update" is
 * caught; the generic words by equality. Both folds are checked: with symbols dropped ("System!" is "system") and
 * with symbols read as letters ("$ystem" is "system").
 */
export function reservedNameIn(value: string): ReservedAppName | null {
  for (const folded of [foldName(value), foldNameWithSymbols(value)]) {
    const found = FOLDED_RESERVED.find(([, reserved]) => folded.includes(reserved))?.[0]
      ?? FOLDED_EXACT.find(([, reserved]) => folded === reserved)?.[0]
    if (found) return found
  }
  return null
}

/**
 * For notices the app composes around agent-supplied text (a pane name, a conversation title, an error): the text, or
 * `fallback` when it carries a reserved name. The app's own fixed words around it are not checked.
 */
export function withoutReservedName(text: string, fallback: string): string {
  return reservedNameIn(text) ? fallback : text
}

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

/**
 * R2 · Bidi controls and invisible characters that make shown text differ from what runs: U+202A–202E, U+2066–2069,
 * U+200B–200F, U+2060–2064, U+FEFF, U+00AD, U+061C and U+180E. The text stays verbatim; the window makes them visible.
 */
export const HIDDEN_CHARACTERS = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u061C\u180E]/u

export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN_CHARACTERS.test(text)
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
