import type { AgentProfile } from '../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'

export type PaneDisplayTone = 'thinking' | 'awaiting' | 'idle' | 'error' | 'exited' | 'starting'

export interface PaneDisplayTerminalState {
  status: 'idle' | 'starting' | 'running' | 'exited' | 'error'
  error: string | null
  lastActivityAt: number | null
  lastOutput: string | null
  lastIntent: string | null
  lastIntentAt: number | null
  isWorking: boolean
  hasUnread: boolean
}

export interface PaneDisplayState {
  title: string
  subtitle: string
  meta: string
  statusLabel: string
  statusTone: PaneDisplayTone
  providerLabel: string
  branchLabel: string | null
  attentionReason: string | null
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
}): PaneDisplayState {
  const { pane, workspace, terminal, profile, paneIndex } = input
  const providerLabel = profile?.provider ?? (pane.shellProfileId ? 'Shell' : 'Local')
  const statusTone = deriveStatusTone(terminal)
  const statusLabel = formatPaneStatus(statusTone)
  const branchLabel = extractBranchLabel(pane.rootPath ?? workspace.rootPath)
  const explicitTitle = pane.displayName?.trim() || null
  const intentTitle = terminal.lastIntent?.trim() ? compactPreview(terminal.lastIntent) : null
  const outputTitle = terminal.lastOutput?.trim() ? sanitizeTerminalPreview(terminal.lastOutput) : null
  const fallbackTitle = fallbackForStatus(statusTone, pane, paneIndex)
  const title = explicitTitle ?? intentTitle ?? outputTitle ?? fallbackTitle
  const rootLabel = compactPathLabel(pane.rootPath ?? workspace.rootPath)
  const providerName = pane.agentName ?? profile?.name ?? providerLabel
  const subtitle = `${providerName} · ${statusLabel}`
  const meta = `~/${rootLabel}${branchLabel ? ` · ${branchLabel}` : ''}`
  const attentionReason = terminal.hasUnread
    ? 'Unread output'
    : statusTone === 'awaiting'
      ? 'Awaiting your input'
      : terminal.error
        ? terminal.error
        : null

  return {
    title,
    subtitle,
    meta,
    statusLabel,
    statusTone,
    providerLabel,
    branchLabel,
    attentionReason
  }
}

export function formatPaneStatus(tone: PaneDisplayTone): string {
  if (tone === 'thinking') return 'Thinking'
  if (tone === 'awaiting') return 'Awaiting'
  if (tone === 'starting') return 'Starting'
  if (tone === 'exited') return 'Exited'
  if (tone === 'error') return 'Needs attention'
  return 'Idle'
}

export function deriveStatusTone(entry: PaneDisplayTerminalState): PaneDisplayTone {
  if (entry.status === 'error' || entry.error) return 'error'
  if (entry.status === 'exited') return 'exited'
  if (entry.status === 'starting') return 'starting'
  if (entry.isWorking) return 'thinking'
  if (entry.status === 'running' && entry.lastIntent) {
    const lastTouchMs = Math.max(entry.lastActivityAt ?? 0, entry.lastIntentAt ?? 0)
    if (lastTouchMs && Date.now() - lastTouchMs < 5 * 60_000) return 'awaiting'
  }
  return 'idle'
}

function fallbackForStatus(tone: PaneDisplayTone, pane: WorkspacePane, paneIndex: number): string {
  if (tone === 'thinking') return 'Agent thinking'
  if (tone === 'awaiting') return 'Awaiting input'
  if (tone === 'starting') return 'Starting terminal'
  if (tone === 'error') return 'Needs attention'
  if (tone === 'exited') return 'Resume session'
  return pane.displayName ?? pane.agentName ?? `${pane.type === 'terminal' ? 'Terminal' : pane.type} ${paneIndex + 1}`
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
