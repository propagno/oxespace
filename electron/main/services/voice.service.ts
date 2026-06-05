import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import https from 'node:https'
import { app } from 'electron'
import type {
  VoiceModelProgressEvent,
  VoiceModelSize,
  VoiceModelStatus,
  VoiceTranscribeOptions,
  VoiceTranscribeResult
} from '../../../shared/types/voice'

/**
 * OXEVoice engine — wraps a bundled whisper.cpp CLI binary.
 *
 * No native addon (avoids the better-sqlite3 ABI-rebuild pain): the binary is
 * shipped via electron-builder `extraResources` and spawned as a child
 * process, mirroring how git/gh/powershell are already invoked. Models are
 * downloaded once on first use to <userData>/models and reused thereafter.
 */

const BINARY_NAMES = ['whisper-cli.exe', 'main.exe']
const MODEL_DIR = 'models'
// OXEVoice is Brazilian-Portuguese only. Auto-detect flip-flopped to English
// on accented speech, so we pin the language and seed the decoder with a short
// pt-BR prompt to bias orthography/accents. whisper.cpp exposes a single `pt`
// language code (no pt-BR/pt-PT split at the model level).
const FORCED_LANGUAGE = 'pt'
const PT_BR_PROMPT = 'Transcrição em português do Brasil.'
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const SPAWN_TIMEOUT_MS = 120_000
const STDERR_RING = 20

export interface VoiceServiceDeps {
  /** Emit a model-download progress tick to renderer windows. */
  emitProgress?: (event: VoiceModelProgressEvent) => void
}

function modelFileName(size: VoiceModelSize): string {
  return `ggml-${size}.bin`
}

function modelUrl(size: VoiceModelSize): string {
  return `${HF_BASE}/${modelFileName(size)}`
}

export class VoiceService {
  private readonly emitProgress: (event: VoiceModelProgressEvent) => void
  private binaryPath: string | null = null
  private resolvedBinary = false
  /** Guards against two concurrent downloads of the same model. */
  private readonly inflight = new Map<VoiceModelSize, Promise<VoiceModelStatus>>()

  constructor(deps: VoiceServiceDeps = {}) {
    this.emitProgress = deps.emitProgress ?? (() => undefined)
  }

  /** Locate the whisper binary across packaged / dev-mirror / repo layouts. */
  resolveBinary(): string | null {
    if (this.resolvedBinary) return this.binaryPath
    this.resolvedBinary = true
    const candidates: string[] = []
    for (const name of BINARY_NAMES) {
      // Packaged: process.resourcesPath/whisper/<name>
      if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'whisper', name))
      // Dev mirror: out/main/whisper/<name> (electron.vite copy-whisper plugin).
      // Resolve via app.getAppPath() — the ESM bundle has no __dirname.
      candidates.push(join(app.getAppPath(), 'out', 'main', 'whisper', name))
      // Repo source (dev fallback)
      candidates.push(join(app.getAppPath(), 'resources', 'whisper', 'win-x64', name))
    }
    this.binaryPath = candidates.find((p) => existsSync(p)) ?? null
    return this.binaryPath
  }

  modelPath(size: VoiceModelSize): string {
    return join(app.getPath('userData'), MODEL_DIR, modelFileName(size))
  }

  getModelStatus(size: VoiceModelSize): VoiceModelStatus {
    const path = this.modelPath(size)
    const ready = existsSync(path) && this.isPlausibleModel(path)
    return { size, ready, path, engineReady: this.resolveBinary() !== null }
  }

  /** A truncated download leaves a tiny file — reject anything implausibly small. */
  private isPlausibleModel(path: string): boolean {
    try {
      return statSync(path).size > 1_000_000
    } catch {
      return false
    }
  }

  async ensureModel(size: VoiceModelSize): Promise<VoiceModelStatus> {
    const current = this.getModelStatus(size)
    if (current.ready) return current
    const existing = this.inflight.get(size)
    if (existing) return existing
    const task = this.downloadModel(size).finally(() => this.inflight.delete(size))
    this.inflight.set(size, task)
    return task
  }

  private downloadModel(size: VoiceModelSize): Promise<VoiceModelStatus> {
    const dest = this.modelPath(size)
    const dir = join(app.getPath('userData'), MODEL_DIR)
    mkdirSync(dir, { recursive: true })
    const tmp = `${dest}.${randomUUID()}.part`

    return new Promise<VoiceModelStatus>((resolve, reject) => {
      const cleanup = (): void => { try { unlinkSync(tmp) } catch { /* noop */ } }
      const fail = (err: Error): void => {
        cleanup()
        this.emitProgress({ size, progress: null, receivedBytes: 0, totalBytes: null, done: true, error: err.message })
        reject(err)
      }

      const request = (url: string, redirects: number): void => {
        if (redirects > 5) { fail(new Error('Too many redirects downloading the voice model.')); return }
        https.get(url, (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume()
            request(new URL(res.headers.location, url).toString(), redirects + 1)
            return
          }
          if (status !== 200) {
            res.resume()
            fail(new Error(`Model download failed (HTTP ${status}).`))
            return
          }
          const totalBytes = Number(res.headers['content-length']) || null
          let receivedBytes = 0
          const out = createWriteStream(tmp)
          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length
            this.emitProgress({
              size,
              progress: totalBytes ? receivedBytes / totalBytes : null,
              receivedBytes,
              totalBytes
            })
          })
          res.pipe(out)
          out.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
          out.on('finish', () => {
            out.close(() => {
              if (totalBytes && receivedBytes !== totalBytes) {
                fail(new Error('Model download was truncated.'))
                return
              }
              try {
                renameSync(tmp, dest)
              } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)))
                return
              }
              if (!this.isPlausibleModel(dest)) {
                try { unlinkSync(dest) } catch { /* noop */ }
                fail(new Error('Downloaded model failed validation.'))
                return
              }
              this.emitProgress({ size, progress: 1, receivedBytes, totalBytes, done: true, error: null })
              resolve(this.getModelStatus(size))
            })
          })
        }).on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
      }

      request(modelUrl(size), 0)
    })
  }

  /**
   * Transcribe a WAV clip (16 kHz mono PCM16). Returns the recognised text.
   * Throws with an actionable message when the engine/model is missing.
   */
  async transcribe(wav: Uint8Array, options: VoiceTranscribeOptions = {}): Promise<VoiceTranscribeResult> {
    const size = options.modelSize ?? 'base'
    const binary = this.resolveBinary()
    if (!binary) throw new Error('Voice engine unavailable — whisper binary not found.')
    const model = this.getModelStatus(size)
    if (!model.ready) throw new Error(`Voice model "${size}" not ready. Download it first.`)

    const wavPath = join(tmpdir(), `oxe-voice-${randomUUID()}.wav`)
    writeFileSync(wavPath, wav)
    const startedAt = Date.now()

    try {
      const { stdout } = await this.spawnWhisper(binary, [
        '-m', model.path,
        '-f', wavPath,
        '-l', FORCED_LANGUAGE, // pt — never auto-detect
        '--prompt', PT_BR_PROMPT, // bias the decoder toward Brazilian Portuguese
        '-nt', // no timestamps
        '-np' // no progress/system prints
      ])
      const text = stdout.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ').trim()
      return {
        text,
        language: FORCED_LANGUAGE,
        durationMs: Date.now() - startedAt
      }
    } finally {
      try { unlinkSync(wavPath) } catch { /* temp may be gone */ }
    }
  }

  private spawnWhisper(binary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true })
      let stdout = ''
      const stderrRing: string[] = []
      let settled = false
      let timer: NodeJS.Timeout | undefined

      const finish = (err?: Error): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (err) reject(err)
        else resolve({ stdout, stderr: stderrRing.join('') })
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => { stdout += chunk })
      child.stderr?.on('data', (chunk: string) => {
        stderrRing.push(chunk)
        if (stderrRing.length > STDERR_RING) stderrRing.shift()
      })
      child.on('error', (err) => finish(err))
      child.on('close', (code) => {
        if (code === 0) finish()
        else finish(new Error(stderrRing.join('').trim() || `Voice engine exited with code ${code ?? 'unknown'}.`))
      })

      timer = setTimeout(() => {
        try { child.kill() } catch { /* already exited */ }
        finish(new Error(`Voice transcription exceeded ${SPAWN_TIMEOUT_MS}ms.`))
      }, SPAWN_TIMEOUT_MS)
    })
  }
}
