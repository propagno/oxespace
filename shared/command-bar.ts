import { mainMessage, type MainMessage } from './messages'

export const KNOWN_COMMAND_IDS = [
  'pending',
  'deny',
  'steer',
  'stop',
  'new',
  'terminal',
  'theme'
] as const

export type KnownCommandId = (typeof KNOWN_COMMAND_IDS)[number]

export type ParsedCommandLine =
  | { kind: 'agent'; provider: 'claude' | 'codex' | 'antigravity'; text: string }
  | { kind: 'skill'; name: string; args: string }
  | { kind: 'command'; id: KnownCommandId; args: string }
  | { kind: 'open'; query: string }
  | { kind: 'help' }
  | { kind: 'unknown'; text: string }

export interface CommandCatalogEntry {
  id: KnownCommandId | 'skill'
  ipc: string
  fixedArgs?: Readonly<Record<string, unknown>>
  confirm?: boolean
  fallback: string
  shortcut: string | null
}

export const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  { id: 'pending', ipc: 'thread.pendingRequestsAll', fallback: 'Needs you', shortcut: 'Mod+Shift+A' },
  { id: 'deny', ipc: 'thread.respond', fixedArgs: { decision: 'decline' }, fallback: 'Deny on request card', shortcut: null },
  { id: 'steer', ipc: 'thread.steer', fallback: 'Steer in OxeChat', shortcut: null },
  { id: 'stop', ipc: 'thread.interrupt', confirm: true, fallback: 'Stop in OxeChat', shortcut: null },
  { id: 'new', ipc: 'thread.create', fallback: 'New conversation', shortcut: 'Ctrl+Alt+N' },
  { id: 'terminal', ipc: 'workspace.createPane', fallback: 'New terminal', shortcut: 'Mod+Shift+T' },
  { id: 'theme', ipc: 'app.setAppearance', fallback: 'Appearance', shortcut: null },
  { id: 'skill', ipc: 'skill.invoke', fallback: 'Skills', shortcut: null }
]

const DISALLOWED_SLASH_IDS = new Set(['approve', 'allow', 'accept', 'agora'])
const KNOWN_ID_SET = new Set<string>(KNOWN_COMMAND_IDS)
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/

export function parseCommandLine(text: string, skillNames: readonly string[] = []): ParsedCommandLine {
  const startTrimmed = text.replace(/^[ \t]+/, '')
  if (startTrimmed.trim() === '?') return { kind: 'help' }

  const agentMatch = /^@(claude|codex|antigravity)(?:[ \t]+([\s\S]*))?$/i.exec(startTrimmed)
  if (agentMatch) {
    const provider = agentMatch[1].toLowerCase() as 'claude' | 'codex' | 'antigravity'
    return { kind: 'agent', provider, text: (agentMatch[2] ?? '').replace(/[ \t]+$/, '') }
  }

  if (startTrimmed.startsWith('/')) {
    const slashMatch = /^\/([^\s]+)(?:[ \t]+([\s\S]*))?$/.exec(startTrimmed)
    if (!slashMatch) return { kind: 'unknown', text }
    const head = slashMatch[1]
    const headLower = head.toLowerCase()
    const rest = slashMatch[2] ?? ''

    if (DISALLOWED_SLASH_IDS.has(headLower)) return { kind: 'unknown', text }

    if (headLower === 'skill') {
      const skillMatch = /^([^\s]+)(?:[ \t]+([\s\S]*))?$/.exec(rest)
      if (!skillMatch) return { kind: 'unknown', text }
      return { kind: 'skill', name: skillMatch[1], args: skillMatch[2] ?? '' }
    }

    if (KNOWN_ID_SET.has(headLower)) {
      return { kind: 'command', id: headLower as KnownCommandId, args: rest }
    }

    const matchedSkill = skillNames.find(name => name === head) ?? skillNames.find(name => name.toLowerCase() === headLower)
    if (matchedSkill) {
      return { kind: 'skill', name: matchedSkill, args: rest }
    }

    return { kind: 'unknown', text }
  }

  const openMatch = /^open(?:[ \t]+([\s\S]*))?$/i.exec(startTrimmed)
  if (openMatch) {
    return { kind: 'open', query: (openMatch[1] ?? '').replace(/[ \t]+$/, '') }
  }

  return { kind: 'unknown', text }
}

export interface CommandRequestItem {
  workspaceId: string
  threadId: string
  requestId: string
}

export interface CommandContext {
  workspaceId: string
  threadId?: string
  pane?: { id: string; agent: boolean }
  enabledSkills: readonly string[]
  requests: readonly CommandRequestItem[]
}

export type CommandExecutionPlan =
  | { ok: true; ipc: string; args: unknown[]; requestIds?: string[] }
  | { ok: false; refusal: MainMessage }

export function commandRequest(parsed: ParsedCommandLine, context: CommandContext): CommandExecutionPlan {
  if (parsed.kind === 'skill') {
    if (CONTROL_CHAR_RE.test(parsed.name) || CONTROL_CHAR_RE.test(parsed.args)) {
      return { ok: false, refusal: mainMessage('commandBar.args.control', {}) }
    }
    if (!context.enabledSkills.includes(parsed.name)) {
      return { ok: false, refusal: mainMessage('commandBar.skill.notEnabled', { name: parsed.name }) }
    }
    if (!context.pane || !context.pane.agent) {
      return { ok: false, refusal: mainMessage('commandBar.skill.noAgent', {}) }
    }
    return {
      ok: true,
      ipc: 'skill.invoke',
      args: [{ skillName: parsed.name, paneId: context.pane.id, argument: parsed.args }]
    }
  }

  if (parsed.kind === 'command') {
    if (CONTROL_CHAR_RE.test(parsed.args)) {
      return { ok: false, refusal: mainMessage('commandBar.args.control', {}) }
    }
    switch (parsed.id) {
      case 'pending': {
        const requestIds = context.requests
          .filter(request => request.workspaceId === context.workspaceId)
          .map(request => request.requestId)
        return { ok: true, ipc: 'thread.pendingRequestsAll', args: [], requestIds }
      }
      case 'deny': {
        const wanted = parsed.args.trim()
        if (wanted) {
          const found = context.requests.find(request => request.requestId === wanted)
          if (!found) return { ok: false, refusal: mainMessage('commandBar.request.none', {}) }
          if (found.workspaceId !== context.workspaceId) {
            return { ok: false, refusal: mainMessage('commandBar.request.otherWorkspace', {}) }
          }
          return { ok: true, ipc: 'thread.respond', args: [found.threadId, found.requestId, { decision: 'decline' }] }
        }
        const first = context.requests.find(request => request.workspaceId === context.workspaceId)
        if (!first) return { ok: false, refusal: mainMessage('commandBar.request.none', {}) }
        return { ok: true, ipc: 'thread.respond', args: [first.threadId, first.requestId, { decision: 'decline' }] }
      }
      case 'steer': {
        if (!context.threadId) return { ok: false, refusal: mainMessage('commandBar.skill.noAgent', {}) }
        return { ok: true, ipc: 'thread.steer', args: [context.threadId, parsed.args] }
      }
      case 'stop': {
        if (!context.threadId) return { ok: false, refusal: mainMessage('commandBar.skill.noAgent', {}) }
        return { ok: true, ipc: 'thread.interrupt', args: [context.threadId] }
      }
      case 'terminal':
        return { ok: true, ipc: 'workspace.createPane', args: [{ workspaceId: context.workspaceId }] }
      case 'new':
        return { ok: true, ipc: 'thread.create', args: [] }
      case 'theme':
        return { ok: true, ipc: 'app.setAppearance', args: [parsed.args.trim() || 'dark'] }
    }
  }

  if (parsed.kind === 'agent' && CONTROL_CHAR_RE.test(parsed.text)) {
    return { ok: false, refusal: mainMessage('commandBar.args.control', {}) }
  }
  if (parsed.kind === 'open' && CONTROL_CHAR_RE.test(parsed.query)) {
    return { ok: false, refusal: mainMessage('commandBar.args.control', {}) }
  }
  if (parsed.kind === 'unknown' && CONTROL_CHAR_RE.test(parsed.text)) {
    return { ok: false, refusal: mainMessage('commandBar.args.control', {}) }
  }
  return { ok: false, refusal: mainMessage('commandBar.request.none', {}) }
}
