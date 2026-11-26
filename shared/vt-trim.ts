/**
 * VT / ECMA-48 escape-sequence boundary helpers for safe head-truncation of
 * raw PTY streams (OXE-436).
 *
 * When a ring buffer or write scheduler drops leading bytes, slicing blindly
 * can land in the middle of a CSI, OSC, DCS/APC/PM/SOS, or ESC sequence (or a
 * UTF-16 surrogate pair), causing xterm to render trailing parameters as
 * literal garbage text or corrupt synchronized output (DEC 2026).
 */

export type VtTailState =
  | 'ground'
  | 'esc'
  | 'esc_intermediate'
  | 'csi'
  | 'osc'
  | 'osc_esc'
  | 'dcs'
  | 'dcs_esc'

const ESC = 0x1b
const BEL = 0x07
const CAN = 0x18
const SUB = 0x1a
const BACKSLASH = 0x5c
const C1_ST = 0x9c

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export function endsWithHighSurrogate(text: string): boolean {
  if (!text) return false
  const code = text.charCodeAt(text.length - 1)
  return code >= 0xd800 && code <= 0xdbff
}

function transitionAfterEsc(code: number): VtTailState {
  if (code === 0x5b) return 'csi' // [
  if (code === 0x5d) return 'osc' // ]
  if (code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f) return 'dcs' // P, X, ^, _
  if (code >= 0x20 && code <= 0x2f) return 'esc_intermediate'
  if (code === ESC) return 'esc'
  return 'ground'
}

/**
 * Advances a minimal VT parser state across `text[start..end)` to determine
 * whether the discarded prefix ended mid-escape-sequence.
 *
 * Fast-path in `'ground'` uses native `indexOf('\x1b')` so plain-text chunks
 * scan in O(1) JS iterations.
 */
export function scanVtState(
  text: string,
  initialState: VtTailState = 'ground',
  start = 0,
  end = text.length
): VtTailState {
  let state: VtTailState = initialState
  let i = start

  while (i < end) {
    if (state === 'ground') {
      const nextEsc = text.indexOf('\x1b', i)
      if (nextEsc === -1 || nextEsc >= end) return 'ground'
      i = nextEsc + 1
      if (i >= end) return 'esc'
      state = transitionAfterEsc(text.charCodeAt(i))
      i++
      continue
    }

    const c = text.charCodeAt(i)

    if (state === 'esc') {
      state = transitionAfterEsc(c)
      i++
      continue
    }

    if (state === 'esc_intermediate') {
      if (c >= 0x20 && c <= 0x2f) {
        i++
      } else if (c === ESC) {
        state = 'esc'
        i++
      } else {
        // Final byte (0x30..0x7E) or invalid byte ends the sequence.
        state = 'ground'
        i++
      }
      continue
    }

    if (state === 'csi') {
      if (c >= 0x40 && c <= 0x7e) {
        state = 'ground'
        i++
      } else if (c === CAN || c === SUB) {
        state = 'ground'
        i++
      } else if (c === ESC) {
        state = 'esc'
        i++
      } else if ((c >= 0x20 && c <= 0x3f) || c < 0x20) {
        i++
      } else {
        state = 'ground'
        i++
      }
      continue
    }

    if (state === 'osc') {
      if (c === BEL || c === CAN || c === SUB || c === C1_ST) {
        state = 'ground'
        i++
      } else if (c === ESC) {
        state = 'osc_esc'
        i++
      } else {
        i++
      }
      continue
    }

    if (state === 'osc_esc') {
      if (c === BACKSLASH) {
        state = 'ground'
        i++
      } else {
        state = transitionAfterEsc(c)
        i++
      }
      continue
    }

    if (state === 'dcs') {
      if (c === CAN || c === SUB || c === C1_ST) {
        state = 'ground'
        i++
      } else if (c === ESC) {
        state = 'dcs_esc'
        i++
      } else {
        i++
      }
      continue
    }

    // dcs_esc
    if (c === BACKSLASH) {
      state = 'ground'
      i++
    } else {
      state = transitionAfterEsc(c)
      i++
    }
  }

  return state
}

/**
 * Advances `start` past any remaining bytes of an escape sequence that was
 * already open (`initialState !== 'ground'`) when earlier bytes were dropped.
 * Stops cleanly before a new `\x1b` that starts a fresh sequence, and also
 * skips a lone trailing UTF-16 low surrogate at the resulting boundary.
 */
export function skipPartialVtSequence(
  text: string,
  initialState: VtTailState,
  start = 0
): { offset: number; state: VtTailState } {
  const end = text.length
  let state: VtTailState = initialState
  let i = start

  while (i < end && state !== 'ground') {
    const c = text.charCodeAt(i)

    if (state === 'esc') {
      state = transitionAfterEsc(c)
      i++
      continue
    }

    if (state === 'esc_intermediate') {
      if (c >= 0x20 && c <= 0x2f) {
        i++
      } else if (c === ESC) {
        // Fresh ESC starts here; preserve it.
        state = 'ground'
        break
      } else {
        state = 'ground'
        i++
      }
      continue
    }

    if (state === 'csi') {
      if (c >= 0x40 && c <= 0x7e) {
        state = 'ground'
        i++
      } else if (c === CAN || c === SUB) {
        state = 'ground'
        i++
      } else if (c === ESC) {
        // Aborted partial CSI; preserve the new ESC sequence intact.
        state = 'ground'
        break
      } else if ((c >= 0x20 && c <= 0x3f) || c < 0x20) {
        i++
      } else {
        state = 'ground'
        i++
      }
      continue
    }

    if (state === 'osc') {
      if (c === BEL || c === CAN || c === SUB || c === C1_ST) {
        state = 'ground'
        i++
      } else if (c === ESC) {
        if (i + 1 >= end) {
          state = 'osc_esc'
          i++
          break
        }
        if (text.charCodeAt(i + 1) === BACKSLASH) {
          state = 'ground'
          i += 2
        } else {
          // Interrupted by a fresh ESC sequence; preserve it.
          state = 'ground'
          break
        }
      } else {
        i++
      }
      continue
    }

    if (state === 'osc_esc' || state === 'dcs_esc') {
      if (c === BACKSLASH) {
        state = 'ground'
        i++
      } else {
        // The leading ESC was already evicted, so treat this as the continuation
        // of that evicted ESC sequence rather than emitting orphaned bytes.
        state = transitionAfterEsc(c)
        i++
      }
      continue
    }

    // dcs
    if (c === CAN || c === SUB || c === C1_ST) {
      state = 'ground'
      i++
    } else if (c === ESC) {
      if (i + 1 >= end) {
        state = 'dcs_esc'
        i++
        break
      }
      if (text.charCodeAt(i + 1) === BACKSLASH) {
        state = 'ground'
        i += 2
      } else {
        state = 'ground'
        break
      }
    } else {
      i++
    }
  }

  if (state === 'ground' && i < end && isLowSurrogate(text.charCodeAt(i))) {
    i++
  }

  return { offset: i, state }
}

/**
 * Returns the tail of `text` bounded by `maxChars` without starting mid-escape
 * sequence or on a lone UTF-16 low surrogate.
 */
export function trimStringToSafeVtTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const start = text.length - maxChars
  const lastEsc = text.lastIndexOf('\x1b', start - 1)
  const state = lastEsc === -1 ? 'ground' : scanVtState(text, 'ground', lastEsc, start)
  const { offset } = skipPartialVtSequence(text, state, start)
  return text.slice(offset)
}
