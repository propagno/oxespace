/**
 * OxeVoice helper protocol: JSON lines on the helper's stdout.
 * Main trusts nothing the helper says. Every line is size-capped and parsed against a closed schema; the result is a
 * freshly built object holding only known fields. Failures are returned as reasons, never thrown.
 */

export const MAX_HELPER_LINE_BYTES = 64 * 1024

export type HelperMessage =
  | { type: 'probe'; available: boolean; languages: string[]; systemLanguage?: string }
  | { type: 'listening' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; hresult: string }
  | { type: 'ended' }

export type HelperParseError = 'invalid_json' | 'invalid_message' | 'unknown_type' | 'invalid_field' | 'line_too_long'

export type HelperParseResult = { ok: true; message: HelperMessage } | { ok: false; error: HelperParseError }

const HRESULT_RE = /^0x[0-9a-fA-F]{8}$/

function fail(error: HelperParseError): HelperParseResult {
  return { ok: false, error }
}

function succeed(message: HelperMessage): HelperParseResult {
  return { ok: true, message }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function parseHelperLine(line: string): HelperParseResult {
  if (Buffer.byteLength(line, 'utf8') > MAX_HELPER_LINE_BYTES) return fail('line_too_long')

  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return fail('invalid_json')
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_message')
  const obj = raw as Record<string, unknown>
  const type = obj.type
  if (typeof type !== 'string') return fail('invalid_message')

  switch (type) {
    case 'probe': {
      if (typeof obj.available !== 'boolean') return fail('invalid_field')
      if (!isStringArray(obj.languages)) return fail('invalid_field')
      const message: HelperMessage = { type: 'probe', available: obj.available, languages: [...obj.languages] }
      if (obj.systemLanguage !== undefined) {
        if (typeof obj.systemLanguage !== 'string') return fail('invalid_field')
        message.systemLanguage = obj.systemLanguage
      }
      return succeed(message)
    }
    case 'listening':
      return succeed({ type: 'listening' })
    case 'ended':
      return succeed({ type: 'ended' })
    case 'partial':
    case 'final': {
      if (typeof obj.text !== 'string') return fail('invalid_field')
      return succeed({ type, text: obj.text })
    }
    case 'error': {
      if (typeof obj.hresult !== 'string' || !HRESULT_RE.test(obj.hresult)) return fail('invalid_field')
      return succeed({ type: 'error', hresult: obj.hresult })
    }
    default:
      return fail('unknown_type')
  }
}

export interface LineSplitter {
  push(chunk: string): void
  flush(): void
}

/**
 * Splits stdout chunks into lines (\n or \r\n). A pending buffer with no newline that grows past
 * MAX_HELPER_LINE_BYTES is dropped, and the rest of that runaway line is skipped until the next newline,
 * so the stream recovers on the following line.
 */
export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let buffer = ''
  let discarding = false

  const emit = (raw: string): void => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.length > 0) onLine(line)
  }

  return {
    push(chunk: string): void {
      let rest = chunk
      for (;;) {
        const idx = rest.indexOf('\n')
        if (idx === -1) break
        const head = rest.slice(0, idx)
        rest = rest.slice(idx + 1)
        if (discarding) {
          discarding = false
          buffer = ''
        } else {
          const full = buffer + head
          buffer = ''
          emit(full)
        }
      }
      if (discarding) return
      buffer += rest
      if (Buffer.byteLength(buffer, 'utf8') > MAX_HELPER_LINE_BYTES) {
        buffer = ''
        discarding = true
      }
    },
    flush(): void {
      const pending = buffer
      buffer = ''
      const wasDiscarding = discarding
      discarding = false
      if (!wasDiscarding && pending.length > 0) emit(pending)
    },
  }
}
