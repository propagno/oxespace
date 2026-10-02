import { createHash } from 'node:crypto'
import type { ThreadArtifact, ThreadEvent, ThreadSnapshot, ThreadTurn } from '../../../../shared/types/thread'

const FORMAT = 'oxespace-thread'
const VERSION = 1
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024
const MAX_EVENTS = 100_000
const MAX_ARTIFACTS = 2_000
const MAX_ARTIFACT_BYTES = 512 * 1024
const EVENT_TYPES = new Set(['session', 'native-signal', 'activity', 'message', 'delta', 'tool', 'turn-diff', 'subagent', 'plan', 'approval', 'approval-resolved', 'request', 'request-resolved', 'queue', 'configuration', 'model-picker', 'cli-command', 'completed', 'failure-details'])

interface PortableConversation {
  title: string
  provider: 'claude' | 'codex'
  configuration: { model?: string; reasoningEffort?: string; access?: 'read-only' | 'workspace-write' | 'full-access'; networkAccess?: boolean; approvalPolicy?: 'untrusted' | 'on-request' | 'never'; mode?: 'default' | 'plan'; hooksEnabled?: boolean }
  events: ThreadEvent[]
  turns: ThreadTurn[]
}

interface PortablePayload {
  format: typeof FORMAT
  version: typeof VERSION
  exportedAt: number
  conversation: PortableConversation
  artifacts: ThreadArtifact[]
}

export interface ThreadPortablePackage extends PortablePayload { checksum: string }

function digest(value: PortablePayload): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
      : input
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Invalid ${label}`)
  return value as Record<string, unknown>
}

function safeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw Error(`Invalid ${label}`)
  return value
}

/** Versioned, inert conversation package. Parsing never invokes a provider or filesystem path from the package. */
export class ThreadPortableService {
  serialize(snapshot: ThreadSnapshot, artifacts: ThreadArtifact[], exportedAt = Date.now()): string {
    const conversation: PortableConversation = {
      title: snapshot.thread.title.slice(0, 120), provider: snapshot.thread.provider,
      configuration: {
        ...(snapshot.thread.model ? { model: snapshot.thread.model } : {}),
        ...(snapshot.thread.reasoningEffort ? { reasoningEffort: snapshot.thread.reasoningEffort } : {}),
        access: snapshot.thread.access ?? 'read-only', networkAccess: snapshot.thread.networkAccess ?? false,
        approvalPolicy: snapshot.thread.approvalPolicy ?? 'on-request', mode: snapshot.thread.mode ?? 'default', hooksEnabled: snapshot.thread.hooksEnabled ?? false
      },
      // Native session identity belongs to the source installation and cannot
      // be resumed safely by an imported local conversation.
      events: snapshot.events.filter(event => event.type !== 'session'),
      turns: (snapshot.turns ?? []).map(({ operationId: _operationId, ...turn }) => turn)
    }
    const payload: PortablePayload = { format: FORMAT, version: VERSION, exportedAt, conversation, artifacts }
    const output = JSON.stringify({ ...payload, checksum: digest(payload) }, null, 2)
    if (Buffer.byteLength(output) > MAX_PACKAGE_BYTES) throw Error('Conversation package exceeds 64 MiB')
    return output
  }

  parse(input: string): { conversation: PortableConversation; artifacts: ThreadArtifact[] } {
    if (Buffer.byteLength(input) > MAX_PACKAGE_BYTES) throw Error('Conversation package exceeds 64 MiB')
    let parsed: unknown
    try { parsed = JSON.parse(input) } catch { throw Error('Conversation package is not valid JSON') }
    const source = record(parsed, 'conversation package')
    if (source.format !== FORMAT || source.version !== VERSION || !Number.isSafeInteger(source.exportedAt)) throw Error('Unsupported conversation package')
    const checksum = safeText(source.checksum, 'package checksum', 64)
    const conversationSource = record(source.conversation, 'conversation')
    const provider = conversationSource.provider
    if (provider !== 'claude' && provider !== 'codex') throw Error('Invalid conversation provider')
    const title = safeText(conversationSource.title, 'conversation title', 120)
    if (!Array.isArray(conversationSource.events) || conversationSource.events.length > MAX_EVENTS) throw Error('Invalid conversation events')
    const events = conversationSource.events.map((value, index) => {
      const event = record(value, `event ${index}`)
      if (!EVENT_TYPES.has(String(event.type)) || Buffer.byteLength(JSON.stringify(event)) > 1024 * 1024) throw Error(`Invalid event ${index}`)
      return event as unknown as ThreadEvent
    })
    if (!Array.isArray(conversationSource.turns) || conversationSource.turns.length > MAX_EVENTS) throw Error('Invalid conversation turns')
    const turns = conversationSource.turns.map((value, index) => {
      const turn = record(value, `turn ${index}`)
      safeText(turn.id, `turn ${index} id`, 200)
      if (!Number.isSafeInteger(turn.sequence) || !['running', 'completed', 'failed', 'interrupted'].includes(String(turn.status))) throw Error(`Invalid turn ${index}`)
      const { operationId: _operationId, ...portableTurn } = turn
      return portableTurn as unknown as ThreadTurn
    })
    const configurationSource = record(conversationSource.configuration, 'conversation configuration')
    const allowedConfiguration = new Set(['model', 'reasoningEffort', 'access', 'networkAccess', 'approvalPolicy', 'mode', 'hooksEnabled'])
    if (Object.keys(configurationSource).some(key => !allowedConfiguration.has(key))) throw Error('Unknown conversation configuration field')
    const configuration: PortableConversation['configuration'] = {}
    if (configurationSource.model !== undefined) configuration.model = safeText(configurationSource.model, 'model', 200)
    if (configurationSource.reasoningEffort !== undefined) configuration.reasoningEffort = safeText(configurationSource.reasoningEffort, 'reasoning effort', 30)
    if (configurationSource.access !== undefined) {
      if (!['read-only', 'workspace-write', 'full-access'].includes(String(configurationSource.access))) throw Error('Invalid access mode')
      configuration.access = configurationSource.access as NonNullable<PortableConversation['configuration']['access']>
    }
    if (configurationSource.approvalPolicy !== undefined) {
      if (!['untrusted', 'on-request', 'never'].includes(String(configurationSource.approvalPolicy))) throw Error('Invalid approval policy')
      configuration.approvalPolicy = configurationSource.approvalPolicy as NonNullable<PortableConversation['configuration']['approvalPolicy']>
    }
    if (configurationSource.mode !== undefined) {
      if (!['default', 'plan'].includes(String(configurationSource.mode))) throw Error('Invalid collaboration mode')
      configuration.mode = configurationSource.mode as NonNullable<PortableConversation['configuration']['mode']>
    }
    for (const key of ['networkAccess', 'hooksEnabled'] as const) {
      if (configurationSource[key] !== undefined && typeof configurationSource[key] !== 'boolean') throw Error(`Invalid ${key}`)
      if (typeof configurationSource[key] === 'boolean') configuration[key] = configurationSource[key]
    }
    if (!Array.isArray(source.artifacts) || source.artifacts.length > MAX_ARTIFACTS) throw Error('Invalid conversation artifacts')
    let artifactBytes = 0
    const artifacts = source.artifacts.map((value, index) => {
      const artifact = record(value, `artifact ${index}`)
      const id = safeText(artifact.id, `artifact ${index} id`, 300), content = safeText(artifact.content, `artifact ${index} content`, MAX_ARTIFACT_BYTES)
      const hash = safeText(artifact.hash, `artifact ${index} hash`, 64)
      if (createHash('sha256').update(content).digest('hex') !== hash) throw Error(`Artifact ${index} checksum mismatch`)
      const bytes = Buffer.byteLength(content); artifactBytes += bytes
      if (bytes > MAX_ARTIFACT_BYTES || artifactBytes > MAX_PACKAGE_BYTES) throw Error('Conversation artifacts exceed the size limit')
      if (artifact.bytes !== bytes || typeof artifact.truncated !== 'boolean' || !['native-patch', 'tool-input', 'working-tree-observation'].includes(String(artifact.source))) throw Error(`Invalid artifact ${index}`)
      return { id, content, hash, bytes, truncated: artifact.truncated, source: artifact.source } as ThreadArtifact
    })
    const payload: PortablePayload = { format: FORMAT, version: VERSION, exportedAt: source.exportedAt as number, conversation: { title, provider, configuration, events, turns }, artifacts }
    if (digest(payload) !== checksum) throw Error('Conversation package checksum mismatch')
    return { conversation: payload.conversation, artifacts }
  }
}
