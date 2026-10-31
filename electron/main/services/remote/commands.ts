import {
  REMOTE_LIMITS, REMOTE_TEXT_LIMITS,
  type RemoteCommand, type RemoteCommandArgs, type RemoteErrorCode, type RemoteRespondRequestArgs, type RemoteThreadSnapshot
} from '../../../../shared/remote/protocol'
import type { RemoteDesktop } from './desktop'
import { isAnswerable, toPendingRequest, toThreadHeader } from './filters'
import { fitPage, numbered, threadItems } from './topics'

/**
 * The M5 commands. Every argument is read strictly (unknown keys, wrong types and sizes are `malformed`); then the
 * command runs against the desktop. `thread.send` and `thread.steer` are applied once per `clientId` within
 * `clientIdDedupeMs`: a resend after reconnecting gets the first outcome back and nothing is sent twice.
 */

export type CommandOutcome = { ok: true; result?: unknown } | { ok: false; code: RemoteErrorCode }

const ID = /^[A-Za-z0-9._:-]{1,200}$/
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/
const ANSWER_KEY = /^[A-Za-z0-9_.:-]{1,120}$/
const HISTORY_EVENTS = 200
const HISTORY_READS = 4

class Malformed extends Error {}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isPlain(value)) throw new Malformed()
  if (Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Malformed()
  if (required.some(key => !(key in value))) throw new Malformed()
  return value
}
const id = (value: unknown): string => { if (typeof value !== 'string' || !ID.test(value)) throw new Malformed(); return value }
const message = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > REMOTE_LIMITS.maxTextLength || value.includes('\0')) throw new Malformed()
  return value
}
const integer = (value: unknown, min: number): number => { if (!Number.isSafeInteger(value) || (value as number) < min) throw new Malformed(); return value as number }

/** Strict reading of a command's args; throws on anything the contract does not allow. */
export function parseCommandArgs<C extends RemoteCommand>(command: C, value: unknown): RemoteCommandArgs[C] {
  switch (command) {
    case 'thread.send': case 'thread.steer': {
      const input = fields(value, ['threadId', 'text', 'clientId'])
      if (typeof input.clientId !== 'string' || !CLIENT_ID.test(input.clientId)) throw new Malformed()
      return { threadId: id(input.threadId), text: message(input.text), clientId: input.clientId } as RemoteCommandArgs[C]
    }
    case 'thread.interrupt':
      return { threadId: id(fields(value, ['threadId']).threadId) } as RemoteCommandArgs[C]
    case 'thread.respondRequest': {
      const input = fields(value, ['threadId', 'requestId', 'generation', 'response'])
      const response = fields(input.response, [], ['decision', 'answers', 'reason'])
      const result: RemoteRespondRequestArgs['response'] = {}
      if (response.decision !== undefined) {
        // Never "accept for the session" from a phone.
        if (response.decision !== 'accept' && response.decision !== 'decline' && response.decision !== 'cancel') throw new Malformed()
        result.decision = response.decision
      }
      if (response.answers !== undefined) {
        if (!isPlain(response.answers) || Object.keys(response.answers).length > 20) throw new Malformed()
        result.answers = {}
        for (const [key, answers] of Object.entries(response.answers)) {
          if (!ANSWER_KEY.test(key) || !Array.isArray(answers) || answers.length > 20 ||
            answers.some(answer => typeof answer !== 'string' || Buffer.byteLength(answer) > 4096 || answer.includes('\0'))) throw new Malformed()
          result.answers[key] = answers as string[]
        }
      }
      if (response.reason !== undefined) {
        if (typeof response.reason !== 'string' || response.reason.length > REMOTE_TEXT_LIMITS.detail || response.reason.includes('\0')) throw new Malformed()
        result.reason = response.reason
      }
      if (result.decision === undefined && result.answers === undefined) throw new Malformed()
      return { threadId: id(input.threadId), requestId: id(input.requestId), generation: integer(input.generation, 0), response: result } as RemoteCommandArgs[C]
    }
    case 'terminal.write': {
      const input = fields(value, ['paneId', 'data'])
      if (typeof input.data !== 'string' || !input.data.length || Buffer.byteLength(input.data) > REMOTE_LIMITS.terminalWriteBytes) throw new Malformed()
      return { paneId: id(input.paneId), data: input.data } as RemoteCommandArgs[C]
    }
    case 'thread.history': {
      const input = fields(value, ['threadId', 'beforeSeq'])
      return { threadId: id(input.threadId), beforeSeq: integer(input.beforeSeq, Number.MIN_SAFE_INTEGER) } as RemoteCommandArgs[C]
    }
    default:
      throw new Malformed()
  }
}

/** A note for the audit trail: the command and what it acted on, never its text or answers. */
export function auditDetail(command: RemoteCommand, args: unknown): string {
  const input = isPlain(args) ? args : {}
  const target = [input.threadId, input.requestId, input.paneId].filter(value => typeof value === 'string' && ID.test(value)).join(' ')
  return target ? `${command} ${target}` : command
}

export interface CommandHost {
  desktop: RemoteDesktop
  now(): number
  phoneWrite(): ReadonlySet<string>
}

export class RemoteCommands {
  private readonly applied = new Map<string, { at: number; outcome: Promise<CommandOutcome> }>()

  constructor(private readonly host: CommandHost) {}

  async run(deviceId: string, command: RemoteCommand, value: unknown): Promise<CommandOutcome> {
    let args: RemoteCommandArgs[RemoteCommand]
    try { args = parseCommandArgs(command, value) } catch { return { ok: false, code: 'malformed' } }
    try {
      switch (command) {
        case 'thread.send': case 'thread.steer': return await this.once(deviceId, command, args as RemoteCommandArgs['thread.send'])
        case 'thread.interrupt': return await this.interrupt(args as RemoteCommandArgs['thread.interrupt'])
        case 'thread.respondRequest': return await this.respond(args as RemoteCommandArgs['thread.respondRequest'])
        case 'terminal.write': return await this.write(args as RemoteCommandArgs['terminal.write'])
        case 'thread.history': return await this.history(args as RemoteCommandArgs['thread.history'])
      }
    } catch (error) {
      return { ok: false, code: /not found/i.test(error instanceof Error ? error.message : '') ? 'not-found' : 'internal' }
    }
    return { ok: false, code: 'unknown-command' }
  }

  /** Forgets what the device sent: it was revoked. */
  forget(deviceId: string): void {
    for (const key of this.applied.keys()) if (key.startsWith(`${deviceId}\n`)) this.applied.delete(key)
  }

  private once(deviceId: string, command: 'thread.send' | 'thread.steer', args: RemoteCommandArgs['thread.send']): Promise<CommandOutcome> {
    const now = this.host.now()
    for (const [key, entry] of this.applied) if (now - entry.at >= REMOTE_LIMITS.clientIdDedupeMs) this.applied.delete(key)
    const key = `${deviceId}\n${args.clientId}`
    const seen = this.applied.get(key)
    if (seen) return seen.outcome
    const outcome = this.deliver(command, args)
    this.applied.set(key, { at: now, outcome })
    return outcome
  }

  private async deliver(command: 'thread.send' | 'thread.steer', args: RemoteCommandArgs['thread.send']): Promise<CommandOutcome> {
    const { desktop } = this.host
    try {
      const thread = desktop.readThread(args.threadId)
      if (thread.archived) return { ok: false, code: 'forbidden' }
      if (command === 'thread.steer') {
        const header = toThreadHeader(thread, 0, [])
        if (thread.status !== 'running' || !header.canSteer) return { ok: false, code: 'forbidden' }
        await desktop.steer(args.threadId, args.text)
      } else await desktop.send(args.threadId, args.text)
      return { ok: true }
    } catch (error) {
      return { ok: false, code: /not found/i.test(error instanceof Error ? error.message : '') ? 'not-found' : 'internal' }
    }
  }

  private async interrupt(args: RemoteCommandArgs['thread.interrupt']): Promise<CommandOutcome> {
    const thread = this.host.desktop.readThread(args.threadId)
    if (thread.status !== 'running' && thread.status !== 'approval') return { ok: false, code: 'not-pending' }
    await this.host.desktop.interrupt(args.threadId)
    return { ok: true }
  }

  private async respond(args: RemoteCommandArgs['thread.respondRequest']): Promise<CommandOutcome> {
    const { desktop } = this.host
    desktop.readThread(args.threadId)
    const listed = desktop.pendingRequests().find(row => row.thread.id === args.threadId && row.request.id === args.requestId)
    if (!listed) return { ok: false, code: 'not-pending' }
    const request = listed.request
    if (!isAnswerable(request)) return { ok: false, code: 'forbidden' }
    if (request.generation !== args.generation) return { ok: false, code: 'stale-generation' }
    const { decision, answers } = args.response
    // The decisions the phone was offered, so an accept on a request it saw cut is refused here too.
    const offered = toPendingRequest(listed, desktop.roots()).decisions
    if (decision !== undefined && !offered.includes(decision)) return { ok: false, code: 'forbidden' }
    if (request.kind === 'approval' && (answers !== undefined || decision === undefined)) return { ok: false, code: 'malformed' }
    if (answers !== undefined) {
      // Only the questions the phone was shown, which are never secret.
      const open = new Set((request.questions ?? []).filter(question => !question.secret).map(question => question.id))
      if (Object.keys(answers).some(key => !open.has(key))) return { ok: false, code: 'forbidden' }
    }
    const outcome = await desktop.respond(args.threadId, args.requestId, args.generation, args.response)
    if (outcome.ok) return { ok: true, result: { resolution: outcome.resolution } }
    if (outcome.refusal === 'staleGeneration') return { ok: false, code: 'stale-generation' }
    if (outcome.refusal === 'unanswered') return { ok: false, code: 'malformed' }
    return { ok: false, code: 'not-pending' }
  }

  private async write(args: RemoteCommandArgs['terminal.write']): Promise<CommandOutcome> {
    if (!this.host.phoneWrite().has(args.paneId)) return { ok: false, code: 'pane-not-shared' }
    return await this.host.desktop.writeTerminal(args.paneId, args.data) ? { ok: true } : { ok: false, code: 'not-found' }
  }

  private async history(args: RemoteCommandArgs['thread.history']): Promise<CommandOutcome> {
    const { desktop } = this.host
    const thread = desktop.readThread(args.threadId)
    const roots = [thread.rootPath, ...desktop.roots()]
    const header = toThreadHeader(thread, desktop.pendingRequests().filter(row => row.thread.id === thread.id).length, roots)
    const collected: ReturnType<typeof threadItems> = []
    let before = args.beforeSeq, more = true
    for (let read = 0; read < HISTORY_READS && more && collected.length < REMOTE_TEXT_LIMITS.threadPage; read += 1) {
      let page
      try { page = await desktop.threadPage(args.threadId, before, HISTORY_EVENTS) } catch (error) {
        if (/not found/i.test(error instanceof Error ? error.message : '')) throw error
        more = false // A cursor before the start: nothing older.
        break
      }
      collected.unshift(...threadItems(numbered(page.events, before), roots))
      more = page.hasMore && page.events.length > 0
      before -= page.events.length
    }
    const result: RemoteThreadSnapshot = fitPage(header, collected, more)
    return { ok: true, result }
  }
}
