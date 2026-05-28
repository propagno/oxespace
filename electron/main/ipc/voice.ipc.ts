import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { VoiceModelSize, VoiceTranscribeOptions } from '../../../shared/types/voice'
import { VoiceService } from '../services/voice.service'

/**
 * Renderer-facing IPC for OXEVoice.
 *
 *   - `voice:transcribe`        — WAV bytes in, recognised text out.
 *   - `voice:get-model-status`  — is the model + engine ready on disk?
 *   - `voice:ensure-model`      — download the model on first use.
 *   - `voice:on-model-progress` — push channel broadcasting download progress.
 */
export function registerVoiceIpc(): VoiceService {
  const service = new VoiceService({
    emitProgress: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.voice.onModelProgress, event)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.voice.transcribe, (_e, wav: Uint8Array, options?: VoiceTranscribeOptions) =>
    service.transcribe(wav, options)
  )
  ipcMain.handle(IPC_CHANNELS.voice.getModelStatus, (_e, size?: VoiceModelSize) =>
    service.getModelStatus(size ?? 'base')
  )
  ipcMain.handle(IPC_CHANNELS.voice.ensureModel, (_e, size?: VoiceModelSize) =>
    service.ensureModel(size ?? 'base')
  )

  return service
}
