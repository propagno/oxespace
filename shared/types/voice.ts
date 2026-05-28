/**
 * Types for OXEVoice — local Whisper speech-to-text.
 *
 * Audio is captured in the renderer (getUserMedia → WAV), shipped to main as
 * bytes, transcribed by a bundled whisper.cpp binary, and the text returned
 * for insertion into the focused terminal. The model is downloaded once on
 * first use to <userData>/models.
 */

/** Whisper model sizes we offer. Multilingual `ggml-<size>.bin` builds. */
export type VoiceModelSize = 'tiny' | 'base' | 'small'

/** Persisted user preferences (renderer-side, localStorage). */
export interface VoicePreferences {
  /** BCP-47 tag, or 'auto' to let whisper detect. Default 'auto'. */
  language: string
  modelSize: VoiceModelSize
  /** Push-to-talk hotkey, e.g. 'Ctrl+Shift+Space'. */
  pttHotkey: string
  /** Where transcribed text lands. v1: always the focused terminal. */
  insertMode: 'terminal'
}

export interface VoiceTranscribeOptions {
  /** BCP-47 language tag or 'auto'. */
  language?: string
  modelSize?: VoiceModelSize
}

export interface VoiceTranscribeResult {
  text: string
  /** Detected/used language tag, when whisper reports it. */
  language?: string
  /** Wall-clock transcription time, for telemetry/UX. */
  durationMs: number
}

export interface VoiceModelStatus {
  size: VoiceModelSize
  /** Model present + verified on disk. */
  ready: boolean
  /** Absolute path to the model file (whether present or expected). */
  path: string
  /** The whisper binary was resolved on disk. */
  engineReady: boolean
}

/** Broadcast to renderer windows during a model download. */
export interface VoiceModelProgressEvent {
  size: VoiceModelSize
  /** 0..1, or null when the total size is unknown. */
  progress: number | null
  receivedBytes: number
  totalBytes: number | null
  /** Set on the terminal event when the download finished or failed. */
  done?: boolean
  error?: string | null
}
