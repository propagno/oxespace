import { REMOTE_LIMITS, type RemoteThreadItem } from '../../../../shared/remote/protocol'
import { cut } from './text'

/**
 * Keeps every frame under `REMOTE_LIMITS.maxFrameBytes`: lists are split into pages by their encoded size, terminal
 * text by characters and then by bytes, and a single item that would not fit is cut further. The envelope (type,
 * subscription, seq, cursor, page) gets a fixed allowance.
 */

export const FRAME_BUDGET = REMOTE_LIMITS.maxFrameBytes - 1024

export const byteSize = (value: unknown): number => Buffer.byteLength(JSON.stringify(value))

/** `wrap(chunk)` for each page; always at least one page, so an empty list is still sent. */
export function pageList<T>(items: readonly T[], wrap: (chunk: T[]) => unknown, budget = FRAME_BUDGET): unknown[] {
  const base = byteSize(wrap([]))
  const pages: unknown[] = []
  let chunk: T[] = [], size = base
  for (const item of items) {
    const itemSize = byteSize(item) + 1
    if (chunk.length && size + itemSize > budget) { pages.push(wrap(chunk)); chunk = []; size = base }
    chunk.push(item); size += itemSize
  }
  pages.push(wrap(chunk))
  return pages
}

/** Text in pieces of at most `chars` characters whose JSON form fits `budget` bytes; never a split surrogate pair. */
export function splitText(text: string, chars: number, budget = FRAME_BUDGET - 256): string[] {
  const pieces: string[] = []
  let rest = text
  while (rest.length) {
    let piece = cut(rest, chars).text
    while (piece.length > 1 && byteSize(piece) > budget) piece = cut(piece, Math.ceil(piece.length / 2)).text
    if (!piece.length) piece = rest.slice(0, 2) // a lone pair that `cut` refused to split
    pieces.push(piece)
    rest = rest.slice(piece.length)
  }
  return pieces
}

/** A timeline item that fits a frame on its own: its longest text is halved until it does. */
export function fitItem(item: RemoteThreadItem, budget = FRAME_BUDGET - 2048): RemoteThreadItem {
  let value = item
  for (let round = 0; round < 24 && byteSize(value) > budget; round += 1) {
    if ((value.type === 'message' || value.type === 'reasoning') && value.text.length) value = { ...value, text: cut(value.text, Math.floor(value.text.length / 2)).text, truncated: true }
    else if (value.type === 'tool' && (value.output?.length ?? 0) > value.detail.length) value = { ...value, output: cut(value.output!, Math.floor(value.output!.length / 2)).text, outputTruncated: true }
    else if (value.type === 'tool' && value.detail.length) value = { ...value, detail: cut(value.detail, Math.floor(value.detail.length / 2)).text }
    else if (value.type === 'plan' && value.steps.length) value = { ...value, steps: value.steps.slice(0, Math.floor(value.steps.length / 2)) }
    else break
  }
  return value
}
