/**
 * OxeVoice 1.5 · main-process engine types. The renderer contract lives in `shared/types/ipc/voice.ts`; these are
 * the shapes an OS engine implements and the registry consumes.
 */
import type {
  VoiceEngineId,
  VoicePrivacy,
  VoiceSessionEvent,
  VoiceUnavailableReason
} from '../../../../shared/types/ipc/voice'

export type { VoiceEngineId, VoicePrivacy, VoiceSessionEvent, VoiceUnavailableReason }

export interface VoiceProbeResult {
  available: boolean
  /** BCP-47 tags the engine can dictate in. */
  languages: string[]
  reason: VoiceUnavailableReason | null
}

export interface VoiceEngineStartOptions {
  sessionId: string
  language?: string
}

export interface VoiceEngineSession {
  stop(): void
  cancel(): void
}

/** A session event as an engine emits it: the registry stamps the `sessionId`. Distributive over the union. */
export type VoiceEngineEvent = VoiceSessionEvent extends infer E
  ? E extends VoiceSessionEvent
    ? Omit<E, 'sessionId'>
    : never
  : never

export interface VoiceEngine {
  id: VoiceEngineId
  privacy: VoicePrivacy
  platforms: NodeJS.Platform[]
  probe(): Promise<VoiceProbeResult>
  start(options: VoiceEngineStartOptions, emit: (event: VoiceEngineEvent) => void): VoiceEngineSession
  dispose?(): void
}
