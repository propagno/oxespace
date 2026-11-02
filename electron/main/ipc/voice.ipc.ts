import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { VoiceModelSize, VoiceTranscribeOptions } from '../../../shared/types/voice'
import type { VoiceService } from '../services/voice.service'
import { parseBytes, parseOneOf } from './ipc-guards'

const MODEL_SIZES: readonly VoiceModelSize[] = ['tiny', 'base', 'small']

function parseTranscribeOptions(value: unknown): VoiceTranscribeOptions | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Voice options must be an object')
  const input = value as Record<string, unknown>
  const options: VoiceTranscribeOptions = {}
  if (input.language !== undefined) {
    if (typeof input.language !== 'string' || !/^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(input.language)) throw new Error('Voice language must be auto or a language tag')
    options.language = input.language
  }
  if (input.modelSize !== undefined) options.modelSize = parseOneOf(input.modelSize, MODEL_SIZES, 'Model size')
  return options
}

/**
 * Renderer-facing IPC for OXEVoice.
 *
 *   - `voice:transcribe`        — WAV bytes in, recognised text out.
 *   - `voice:get-model-status`  — is the model + engine ready on disk?
 *   - `voice:ensure-model`      — download the model on first use.
 *   - `voice:on-model-progress` — push channel broadcasting download progress.
 */
/** The whisper runner loads on the first voice request: most launches never dictate, and the main entry stays lean. */
async function createVoiceService(): Promise<VoiceService> {
  const { VoiceService } = await import('../services/voice.service')
  return new VoiceService({
    emitProgress: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.voice.onModelProgress, event)
      }
    }
  })
}

export function registerVoiceIpc(load: () => Promise<VoiceService> = createVoiceService): void {
  let service: Promise<VoiceService> | null = null
  const voice = (): Promise<VoiceService> => (service ??= load().catch(error => { service = null; throw error }))

  ipcMain.handle(IPC_CHANNELS.voice.transcribe, async (event, wav: unknown, options?: unknown) => {
    // Push-to-talk audio is 16 kHz mono PCM: 32 MB is over 15 minutes, far past any dictation.
    const bytes = parseBytes(wav, 32 * 1024 * 1024, 'Audio')
    const parsed = parseTranscribeOptions(options)
    return (await voice()).transcribe(bytes, parsed)
  })
  ipcMain.handle(IPC_CHANNELS.voice.getModelStatus, async (event, size?: unknown) => {
    const modelSize = size === undefined ? 'base' : parseOneOf(size, MODEL_SIZES, 'Model size')
    return (await voice()).getModelStatus(modelSize)
  })
  ipcMain.handle(IPC_CHANNELS.voice.ensureModel, async (event, size?: unknown) => {
    const modelSize = size === undefined ? 'base' : parseOneOf(size, MODEL_SIZES, 'Model size')
    return (await voice()).ensureModel(modelSize)
  })
}
