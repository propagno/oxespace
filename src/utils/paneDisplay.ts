import type { AgentProfile } from '../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { i18n } from '../i18n'

const tc = i18n.getFixedT(null, 'code')

/** 'needs-decision' is an agent stopped on an approval or a question; 'awaiting' is one that finished its turn. */
export type PaneDisplayTone = 'thinking' | 'needs-decision' | 'awaiting' | 'idle' | 'error' | 'exited' | 'starting'

/**
 * Where a pane's status comes from (UX-07): the main process's lifecycle (read from the agent's hooks or
 * its screen), the agent's own hook report, or a guess from output timing. Null when the terminal process
 * itself decides (starting, exited, error).
 */
export type PaneStatusOrigin = 'lifecycle' | 'screen' | 'hook' | 'heuristic'

export interface PaneDisplayTerminalState {
  status: 'idle' | 'starting' | 'running' | 'exited' | 'error'
  error: string | null
  lastActivityAt: number | null
  lastOutput: string | null
  lastIntent: string | null
  lastIntentAt: number | null
  isWorking: boolean
  hasUnread: boolean
  /**
   * Status reported by the agent's own lifecycle hooks (see AgentHookServer).
   * Absent when hooks are not installed or the agent has not reported; the
   * output-timing heuristic then decides.
   */
  hookState?: 'working' | 'waiting' | 'done' | null
  hookAt?: number | null
  /** Lifecycle state from the main process (hooks + screen manifests); outranks hookState and timing. */
  agentState?: import('../../shared/types/agent-state').AgentLifecycleState | null
  /** What the lifecycle state was read from, as the agent-state event names it ('hook', 'screen', ...). */
  agentSource?: string | null
}

export interface PaneDisplayState {
  title: string
  subtitle: string
  meta: string
  statusLabel: string
  statusTone: PaneDisplayTone
  /** Human-facing name for the header chip (e.g. "Codex", "PowerShell"). */
  providerLabel: string
  /** Stable key for CSS (e.g. "codex", "shell", "claude"). */
  providerKey: string
  branchLabel: string | null
  attentionReason: string | null
  statusOrigin: PaneStatusOrigin | null
  /** Plain-language origin for titles and screen readers; null with no origin. */
  originLabel: string | null
  /** A guess rather than a report: drawn weaker so it is not read as certain. */
  statusEstimated: boolean
}

// Patterns that match agent CLI boilerplate or shell echo — never the user's
// actual intent. Anything matched here is dropped during preview sanitization,
// so the sidebar/header doesn't end up titled "Tip: /skills" while the user
// is actually working on something else.
//
// When adding a new pattern, also add a row to paneDisplay.test.ts under
// "sanitizeTerminalPreview drops…" so future contributors don't silently
// reintroduce a leak by tweaking the regex.
const USELESS_PATTERNS = [
  /^copilot v[\d.]+ uses ai\.?$/i,
  /^check for mistakes\.?$/i,
  /^terminal$/i,
  /^shell$/i,
  /^powershell$/i,
  /^cmd$/i,
  /^claude code v[\d.]+/i,
  /^sonnet\s+[\d.]+/i,
  /^opus\s+[\d.]+/i,
  /^haiku\s+[\d.]+/i,
  /^all permissions are now enabled/i,
  /^do you trust the files in this folder\??$/i,
  /^confirm folder trust$/i,
  /^reading untrusted files/i,
  /^executing untrusted code is unsafe/i,
  /^select-object/i,
  /^get-content/i,
  /^cd\s+[a-z]:\\/i,
  // Copilot "Tip:" lines — these are surfaced by the CLI itself, not the user.
  // Catches "Tip: /skills", "Tip: try /commands", "Tip: use Ctrl+/", etc.
  /^tip:\s+/i,
  // Generic "session resumed", "session started" banners.
  /^session\s+(started|resumed|restored)/i,
  // Claude Code idle prompts that print after compaction or context reset.
  /^waiting for your input/i,
  /^how can i help/i,
  // Empty role headers from JSONL replay or copy/paste.
  /^(human|assistant|user|system):\s*$/i,
  // Bare welcome banners ("Welcome to GitHub Copilot CLI", etc).
  /^welcome to /i,
  // PowerShell prompts that slip through when sanitizer didn't strip the line.
  /^ps [a-z]:\\.*>\s*$/i,
  // Common confirmation prompts that aren't intents.
  /^(yes|no|y|n|press enter|continue\??)$/i
]

const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g

export function stripTerminalControl(input: string): string {
  return input
    .replace(/\x1B\[[\x3C-\x3F]*[\d;]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[PX^_][^\x1B]*\x1B\\/g, '')
    .replace(/\x1B[@-_]/g, '')
    .replace(/\x1B[()][AB012]/g, '')
    .replace(/\r/g, '')
    .replace(CONTROL_CHAR_PATTERN, '')
}

export function sanitizeTerminalPreview(raw: string): string | null {
  const stripped = stripTerminalControl(raw)
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\]4;[^\s]+/g, '')

  const candidates = stripped
    .split('\n')
    .map((line) => line.replace(/[│┃┆┇┊┋║]/g, '|').trim())
    .map((line) => line.replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((line) => !isDecorativeLine(line))
    .filter((line) => !isWindowsPathOnly(line))
    .filter((line) => !USELESS_PATTERNS.some((pattern) => pattern.test(line)))

  const useful = candidates.at(-1)
  if (!useful) return null
  return compactPreview(useful)
}

export function compactPathLabel(path: string | null | undefined): string {
  if (!path) return 'workspace'
  const parts = path.split(/[\\/]/).filter(Boolean)
  const tail = parts.at(-1) ?? 'workspace'
  return tail.length > 24 ? `${tail.slice(0, 21)}...` : tail
}

export function derivePaneDisplayState(input: {
  pane: WorkspacePane
  workspace: Pick<Workspace, 'name' | 'rootPath'>
  terminal: PaneDisplayTerminalState
  profile: AgentProfile | null
  paneIndex: number
  /** Resolved shell profile display name (from workspace.shellProfiles). */
  shellProfileName?: string | null
}): PaneDisplayState {
  const { pane, workspace, terminal, profile, paneIndex, shellProfileName } = input
  const identity = resolvePaneIdentity({ pane, profile, shellProfileName })
  const statusTone = deriveStatusTone(terminal)
  const statusLabel = formatPaneStatus(statusTone)
  const branchLabel = extractBranchLabel(pane.rootPath ?? workspace.rootPath)
  const explicitTitle = pane.displayName?.trim() || null
  const intentTitle = terminal.lastIntent?.trim() ? compactPreview(terminal.lastIntent) : null
  const outputTitle = terminal.lastOutput?.trim() ? sanitizeTerminalPreview(terminal.lastOutput) : null
  const fallbackTitle = fallbackForStatus(statusTone, pane, paneIndex)
  const title = explicitTitle ?? intentTitle ?? outputTitle ?? fallbackTitle
  const rootLabel = compactPathLabel(pane.rootPath ?? workspace.rootPath)
  const subtitle = `${identity.label} · ${statusLabel}`
  const meta = `~/${rootLabel}${branchLabel ? ` · ${branchLabel}` : ''}`
  const statusOrigin = deriveStatusOrigin(terminal)
  const attentionReason = statusTone === 'needs-decision'
    ? tc('pane.attention.blocked')
    : terminal.status === 'running' && terminal.agentState === 'done'
      ? tc('pane.attention.done')
      : terminal.hasUnread
    ? tc('sidebar.session.unread')
    : statusTone === 'awaiting'
      ? tc('pane.attention.awaiting')
      : terminal.error
        ? terminal.error
        : null

  return {
    title,
    subtitle,
    meta,
    statusLabel,
    statusTone,
    providerLabel: identity.label,
    providerKey: identity.key,
    branchLabel,
    attentionReason,
    statusOrigin,
    // An idle shell guessed idle has nothing to explain; every other status says where it comes from.
    originLabel: statusOrigin && !(statusOrigin === 'heuristic' && statusTone === 'idle') ? tc(`pane.origin.${statusOrigin}`) : null,
    statusEstimated: statusOrigin === 'heuristic' && (statusTone === 'thinking' || statusTone === 'awaiting')
  }
}

/**
 * What runs in this pane for header chips: bound agent first, else shell.
 * Never prefer shell profile over agentProfileId/agentName.
 */
export function resolvePaneIdentity(input: {
  pane: WorkspacePane
  profile: AgentProfile | null
  shellProfileName?: string | null
}): { label: string; key: string } {
  const { pane, profile, shellProfileName } = input
  if (profile) {
    return {
      label: profile.name?.trim() || titleCase(profile.provider),
      key: profile.provider
    }
  }
  if (pane.agentName?.trim()) {
    return { label: pane.agentName.trim(), key: 'custom' }
  }

  const shellId = (pane.shellProfileId ?? '').toLowerCase()
  const shellName = shellProfileName?.trim() ?? ''

  // Agent-launcher shell profiles (workspace default often builtin-claude)
  if (shellId.includes('claude') || /^claude$/i.test(shellName)) {
    return { label: shellName || 'Claude', key: 'claude' }
  }
  if (shellId.includes('copilot') || /copilot/i.test(shellName)) {
    return { label: shellName || 'Copilot', key: 'copilot' }
  }
  if (shellId.includes('codex') || /codex/i.test(shellName)) {
    return { label: shellName || 'Codex', key: 'codex' }
  }
  if (shellId.includes('cursor') || /cursor/i.test(shellName)) {
    return { label: shellName || 'Cursor', key: 'cursor' }
  }
  if (shellId.includes('grok') || /grok/i.test(shellName)) {
    return { label: shellName || 'Grok', key: 'grok' }
  }
  if (shellId.includes('antigravity') || shellId.includes('agy') || /antigravity|agy/i.test(shellName)) {
    return { label: shellName || 'Antigravity', key: 'antigravity' }
  }

  if (shellId.includes('powershell') || shellId.includes('pwsh') || /powershell|pwsh/i.test(shellName)) {
    return { label: shellName || 'PowerShell', key: 'shell' }
  }
  if (shellId.includes('bash') || /bash|git bash/i.test(shellName)) {
    return { label: shellName || 'Bash', key: 'shell' }
  }
  if (shellId.includes('cmd') || /^cmd$/i.test(shellName)) {
    return { label: shellName || 'CMD', key: 'shell' }
  }

  if (shellName) return { label: shellName, key: 'shell' }
  if (pane.shellProfileId) return { label: tc('newWorkspace.shell'), key: 'shell' }
  return { label: tc('pane.local'), key: 'shell' }
}

function titleCase(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatPaneStatus(tone: PaneDisplayTone): string {
  return tc(`pane.status.${tone}`)
}

const HOOK_WAITING_FRESH_MS = 30 * 60_000
const HOOK_DONE_FRESH_MS = 5 * 60_000
// A `working` report only holds while the pane is still alive. Claude redraws
// its spinner continuously, so output going quiet this long means the agent was
// killed without a Stop/SessionEnd hook — fall back to the heuristic rather than
// show a stuck "thinking" dot.
const HOOK_WORKING_LIVENESS_MS = 3 * 60_000

/** Tone from an agent's own hook report, or null to defer to the heuristic. */
function deriveHookTone(entry: PaneDisplayTerminalState, now: number): PaneDisplayTone | null {
  if (entry.status !== 'running' || !entry.hookState || !entry.hookAt) return null
  const age = now - entry.hookAt
  // Claude's hooks report 'waiting' on a permission prompt or a question: a decision, as main reads it too.
  if (entry.hookState === 'waiting') return age < HOOK_WAITING_FRESH_MS ? 'needs-decision' : null
  if (entry.hookState === 'done') return age < HOOK_DONE_FRESH_MS ? 'awaiting' : 'idle'
  const lastSign = Math.max(entry.hookAt, entry.lastActivityAt ?? 0)
  return now - lastSign < HOOK_WORKING_LIVENESS_MS ? 'thinking' : null
}

export function deriveStatusTone(entry: PaneDisplayTerminalState): PaneDisplayTone {
  if (entry.status === 'error' || entry.error) return 'error'
  if (entry.status === 'exited') return 'exited'
  if (entry.status === 'starting') return 'starting'
  if (entry.status === 'running' && entry.agentState && entry.agentState !== 'unknown') {
    if (entry.agentState === 'blocked') return 'needs-decision'
    return entry.agentState === 'working' ? 'thinking' : entry.agentState === 'idle' ? 'idle' : 'awaiting'
  }
  const hookTone = deriveHookTone(entry, Date.now())
  if (hookTone) return hookTone
  if (entry.isWorking) return 'thinking'
  if (entry.status === 'running' && entry.lastIntent) {
    const lastTouchMs = Math.max(entry.lastActivityAt ?? 0, entry.lastIntentAt ?? 0)
    if (lastTouchMs && Date.now() - lastTouchMs < 5 * 60_000) return 'awaiting'
  }
  return 'idle'
}

/** Which source `deriveStatusTone` used for this entry; kept beside it so the two cannot disagree. */
export function deriveStatusOrigin(entry: PaneDisplayTerminalState): PaneStatusOrigin | null {
  if (entry.status === 'error' || entry.error || entry.status === 'exited' || entry.status === 'starting') return null
  if (entry.status === 'running' && entry.agentState && entry.agentState !== 'unknown') {
    if (entry.agentSource === 'screen') return 'screen'
    if (entry.agentSource === 'hook') return 'hook'
    if (entry.agentSource === 'heuristic') return 'heuristic'
    return 'lifecycle'
  }
  if (deriveHookTone(entry, Date.now())) return 'hook'
  return 'heuristic'
}

function fallbackForStatus(tone: PaneDisplayTone, pane: WorkspacePane, paneIndex: number): string {
  if (tone !== 'idle') return tc(`pane.fallback.${tone}`)
  return pane.displayName ?? `${pane.type === 'terminal' ? tc('panels.terminal') : pane.type} ${paneIndex + 1}`
}

function compactPreview(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > 92 ? `${singleLine.slice(0, 89)}...` : singleLine
}

function isDecorativeLine(line: string): boolean {
  return /^[\s\-_=|+~`*#.:]+$/.test(line) || /^[┌┐└┘├┤┬┴┼─│╭╮╰╯═║╔╗╚╝╠╣╦╩╬ ]+$/.test(line)
}

function isWindowsPathOnly(line: string): boolean {
  return /^[a-z]:\\[^ ]+$/i.test(line) || /^~[\\/][^ ]+$/i.test(line)
}

function extractBranchLabel(path: string): string | null {
  const match = path.match(/[\\/]worktrees[\\/]([^\\/]+)/i)
  if (match?.[1]) return match[1]
  return null
}
