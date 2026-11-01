/**
 * OxeVoice 1.5 · native voice input contract (one renderer contract for every OS engine).
 *
 * The renderer starts and stops a dictation session; the main process picks an engine through a registry and
 * streams typed events back. The person always knows where audio is processed (`privacy`), an engine that sends
 * audio off the machine (`os-cloud`) needs explicit, revocable consent, and agents never reach any of this (the MCP
 * coverage marks it forbidden). Re-exported by `../ipc`.
 *
 * This file is the frozen contract of OxeVoice F1 (oxe-build plan): change it through a plan, not an implementation.
 */

/** Engines known to the registry. F1 implements `windows-winrt`; F2/F3 add the others. */
export const VOICE_ENGINE_IDS = ['windows-winrt', 'macos-sfspeech', 'offline-sherpa'] as const
export type VoiceEngineId = (typeof VOICE_ENGINE_IDS)[number]

/** Where the audio is processed: on this device, or by the operating system vendor's cloud service. */
export type VoicePrivacy = 'on-device' | 'os-cloud'

/** Why an engine cannot dictate right now. `null` when it can. */
export type VoiceUnavailableReason =
  | 'unsupported-os'
  | 'consent-required'
  | 'os-speech-privacy-off'
  | 'no-language'
  | 'engine-error'

export interface VoiceEngineInfo {
  id: VoiceEngineId
  privacy: VoicePrivacy
  available: boolean
  reason: VoiceUnavailableReason | null
  /** BCP-47 tags the engine can dictate in (e.g. `pt-BR`). */
  languages: string[]
  /** `os-cloud` engines need the person's consent before the first session. */
  consentRequired: boolean
  consented: boolean
}

export interface VoiceStartInput {
  /** Defaults to the registry's choice for this OS. */
  engineId?: VoiceEngineId
  /** BCP-47 tag; defaults to the engine's/system's language. */
  language?: string
}

export interface VoiceStartResult {
  sessionId: string
  engine: VoiceEngineInfo
}

/** A C3 message (see `shared/messages.ts`): the window turns it into words. */
export interface VoiceMessage {
  code: VoiceMessageCode
  params: Record<string, string | number>
}

/** C3 codes the voice domain may send. Added to `MessageParams` when the hot files are touched at the end of F1. */
export const VOICE_MESSAGE_CODES = [
  'voice.consent.required',
  'voice.engine.unavailable',
  'voice.session.busy',
  'voice.session.notFound',
  'voice.os.speechPrivacyOff',
  'voice.os.noMicrophone',
  'voice.engine.crashed',
  'voice.engine.failed'
] as const
export type VoiceMessageCode = (typeof VOICE_MESSAGE_CODES)[number]

/**
 * IPC results carry C3 refusals as data: an Error rejected across Electron IPC loses its fields, so a refusal the
 * window must explain (consent needed, engine unavailable, busy) comes back as `{ ok: false, message }`.
 */
export type VoiceOutcome<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; message: VoiceMessage }

export type VoiceEndReason = 'stopped' | 'cancelled' | 'idle' | 'error'

/** Events of one session, in order: listening → partial* → final* → ended (an error comes right before ended). */
export type VoiceSessionEvent =
  | { sessionId: string; type: 'listening' }
  | { sessionId: string; type: 'partial'; text: string }
  | { sessionId: string; type: 'final'; text: string }
  | { sessionId: string; type: 'error'; message: VoiceMessage }
  | { sessionId: string; type: 'ended'; reason: VoiceEndReason }

export interface VoiceConsentInput {
  engineId: VoiceEngineId
  granted: boolean
}

/** IPC channels of the voice domain (`voice:*`). Every handler requires the application main frame. */
export const VOICE_CHANNELS = {
  getEngines: 'voice:get-engines',
  start: 'voice:start',
  stop: 'voice:stop',
  cancel: 'voice:cancel',
  setConsent: 'voice:set-consent',
  /** Opens the OS speech privacy page (Windows: `ms-settings:privacy-speech`); never changes the OS setting. */
  openSpeechSettings: 'voice:open-speech-settings',
  /** Push channel main → main window: `VoiceSessionEvent`. */
  onEvent: 'voice:on-event'
} as const

/** What the renderer gets on `window.oxe.voice` (the preload bridge implements it with `VOICE_CHANNELS`). */
export interface VoiceRendererApi {
  getEngines(): Promise<VoiceEngineInfo[]>
  start(input?: VoiceStartInput): Promise<VoiceOutcome<VoiceStartResult>>
  stop(sessionId: string): Promise<VoiceOutcome>
  cancel(sessionId: string): Promise<VoiceOutcome>
  setConsent(input: VoiceConsentInput): Promise<VoiceEngineInfo[]>
  openSpeechSettings(): Promise<void>
  /** Returns the unsubscribe function. */
  onEvent(listener: (event: VoiceSessionEvent) => void): () => void
}
