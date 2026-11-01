/**
 * OxeVoice 1.5 · engine registry. Picks an engine per OS and consent, owns one session at a time and stamps every
 * engine event with the session id.
 */
import { randomUUID } from 'node:crypto'
import type {
  VoiceEngineInfo,
  VoiceSessionEvent,
  VoiceStartInput,
  VoiceStartResult
} from '../../../../shared/types/ipc/voice'
import type { VoiceConsentStore } from './consent'
import { voiceError } from './errors'
import type { VoiceEngine, VoiceEngineEvent, VoiceEngineSession, VoiceProbeResult } from './types'

export interface VoiceRegistryOptions {
  platform: NodeJS.Platform
  engines: VoiceEngine[]
  consent: VoiceConsentStore
}

export interface VoiceRegistry {
  list(): Promise<VoiceEngineInfo[]>
  start(input: VoiceStartInput, emit: (event: VoiceSessionEvent) => void): Promise<VoiceStartResult>
  stop(sessionId: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  dispose(): void
}

interface Probed {
  engine: VoiceEngine
  probe: VoiceProbeResult
}

interface ActiveSession {
  sessionId: string
  session: VoiceEngineSession | null
}

export function createVoiceRegistry(options: VoiceRegistryOptions): VoiceRegistry {
  const { platform, engines, consent } = options
  let active: ActiveSession | null = null

  async function probeAll(): Promise<Probed[]> {
    const local = engines.filter(engine => engine.platforms.includes(platform))
    return Promise.all(
      local.map(async engine => {
        try {
          return { engine, probe: await engine.probe() }
        } catch {
          return { engine, probe: { available: false, languages: [], reason: 'engine-error' as const } }
        }
      })
    )
  }

  function toInfo({ engine, probe }: Probed): VoiceEngineInfo {
    const consentRequired = engine.privacy === 'os-cloud'
    const consented = consentRequired ? consent.isGranted(engine.id) : false
    const blockedByConsent = consentRequired && !consented && probe.available
    return {
      id: engine.id,
      privacy: engine.privacy,
      available: probe.available && !blockedByConsent,
      reason: blockedByConsent ? 'consent-required' : probe.reason,
      languages: probe.languages,
      consentRequired,
      consented
    }
  }

  function find(sessionId: string): ActiveSession {
    if (!active || active.sessionId !== sessionId) throw voiceError('voice.session.notFound')
    return active
  }

  return {
    async list() {
      return (await probeAll()).map(toInfo)
    },

    async start(input, emit) {
      const probed = await probeAll()
      const chosen = input.engineId
        ? probed.find(item => item.engine.id === input.engineId && item.probe.available)
        : probed.find(item => item.probe.available)
      if (!chosen) throw voiceError('voice.engine.unavailable', input.engineId ? { engineId: input.engineId } : {})

      const { engine } = chosen
      if (engine.privacy === 'os-cloud' && !consent.isGranted(engine.id)) {
        throw voiceError('voice.consent.required', { engineId: engine.id })
      }
      if (active) throw voiceError('voice.session.busy')

      const sessionId = randomUUID()
      const state: ActiveSession = { sessionId, session: null }
      active = state

      const stamped = (event: VoiceEngineEvent): void => {
        if (event.type === 'ended' && active === state) active = null
        emit({ ...event, sessionId } as VoiceSessionEvent)
      }

      try {
        state.session = engine.start({ sessionId, language: input.language }, stamped)
      } catch {
        if (active === state) active = null
        throw voiceError('voice.engine.failed', { engineId: engine.id })
      }

      return { sessionId, engine: toInfo(chosen) }
    },

    async stop(sessionId) {
      find(sessionId).session?.stop()
    },

    async cancel(sessionId) {
      find(sessionId).session?.cancel()
    },

    dispose() {
      for (const engine of engines) engine.dispose?.()
    }
  }
}
