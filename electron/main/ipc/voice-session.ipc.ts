/**
 * OxeVoice 1.5 · IPC for native voice input. Every handler serves only the application main frame, validates its
 * input, and returns C3 refusals as data (`{ ok: false, message }`). Session events go only to the main window.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  VOICE_CHANNELS,
  VOICE_ENGINE_IDS,
  type VoiceEngineInfo,
  type VoiceEngineId,
  type VoiceOutcome,
  type VoiceSessionEvent,
  type VoiceStartInput,
  type VoiceStartResult
} from '../../../shared/types/ipc/voice'
import type { VoiceConsentStore } from '../services/voice/consent'
import { VoiceError } from '../services/voice/errors'
import type { VoiceRegistry } from '../services/voice/registry'
import { parseOneOf, parseRecord, parseToken, requireAppFrame } from './ipc-guards'

export interface RegisterVoiceIpcOptions {
  registry: VoiceRegistry
  consent: VoiceConsentStore
  sendToMainWindow: (channel: string, event: VoiceSessionEvent) => void
  openSpeechSettings: () => Promise<void>
}

const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

function parseLanguage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 35 || !BCP47.test(value)) throw new Error('language must be a BCP-47 tag')
  return value
}

function parseStartInput(value: unknown): VoiceStartInput {
  if (value === undefined || value === null) return {}
  const record = parseRecord(value, 'input')
  const input: VoiceStartInput = {}
  if (record.engineId !== undefined) input.engineId = parseOneOf(record.engineId, VOICE_ENGINE_IDS, 'engineId')
  if (record.language !== undefined) input.language = parseLanguage(record.language)
  return input
}

async function asOutcome<T extends object>(run: () => Promise<T | void>): Promise<VoiceOutcome<T>> {
  try {
    const result = await run()
    return { ok: true, ...(result ?? {}) } as VoiceOutcome<T>
  } catch (error) {
    if (error instanceof VoiceError) return { ok: false, message: error.voiceMessage }
    throw error
  }
}

export function registerVoiceIpc(options: RegisterVoiceIpcOptions): () => void {
  const { registry, consent, sendToMainWindow, openSpeechSettings } = options
  const channels: string[] = []
  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    channels.push(channel)
    ipcMain.handle(channel, (event, ...args) => {
      requireAppFrame(event, 'Voice')
      return handler(event, ...args)
    })
  }

  handle(VOICE_CHANNELS.getEngines, (): Promise<VoiceEngineInfo[]> => registry.list())

  handle(VOICE_CHANNELS.start, (_event, raw) => {
    const input = parseStartInput(raw)
    return asOutcome<VoiceStartResult>(() =>
      registry.start(input, sessionEvent => sendToMainWindow(VOICE_CHANNELS.onEvent, sessionEvent))
    )
  })

  handle(VOICE_CHANNELS.stop, (_event, raw) => {
    const sessionId = parseToken(raw, 'sessionId')
    return asOutcome(() => registry.stop(sessionId))
  })

  handle(VOICE_CHANNELS.cancel, (_event, raw) => {
    const sessionId = parseToken(raw, 'sessionId')
    return asOutcome(() => registry.cancel(sessionId))
  })

  handle(VOICE_CHANNELS.setConsent, (_event, raw): Promise<VoiceEngineInfo[]> => {
    const record = parseRecord(raw, 'input')
    const engineId: VoiceEngineId = parseOneOf(record.engineId, VOICE_ENGINE_IDS, 'engineId')
    if (typeof record.granted !== 'boolean') throw new Error('granted must be a boolean')
    if (record.granted) consent.grant(engineId)
    else consent.revoke(engineId)
    return registry.list()
  })

  handle(VOICE_CHANNELS.openSpeechSettings, async () => {
    await openSpeechSettings()
  })

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
