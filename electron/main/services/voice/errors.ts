/**
 * OxeVoice 1.5 · voice errors. A refusal the window must explain travels as a C3 `VoiceMessage`.
 */
import type { VoiceMessage, VoiceMessageCode } from '../../../../shared/types/ipc/voice'

export class VoiceError extends Error {
  voiceMessage: VoiceMessage

  constructor(voiceMessage: VoiceMessage) {
    super(voiceMessage.code)
    this.name = 'VoiceError'
    this.voiceMessage = voiceMessage
  }
}

export function voiceError(code: VoiceMessageCode, params: Record<string, string | number> = {}): VoiceError {
  return new VoiceError({ code, params })
}
