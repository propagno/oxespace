import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'
import { compactToolOutput, MIN_COMPRESSIBLE_LENGTH } from './output-compactor'

/** Text a tool may return before it is cut, in characters. Every character the agent reads costs tokens. */
export const DEFAULT_TOOL_OUTPUT_LIMIT = 32_000
/** Full outputs saved by a cut are kept for a week. */
export const TOOL_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface ToolResultBoundStats {
  compacted: boolean
  truncated: boolean
  originalChars: number
  compactedChars: number
  finalChars: number
  charsSaved: number
}

const kb = (chars: number): string => `${Math.max(1, Math.round(chars / 1024))} KB`

/** Moves an index off the second half of a surrogate pair, so a cut never splits a character. */
const safeIndex = (text: string, index: number): number => {
  const code = text.charCodeAt(index)
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
}

/**
 * Semantically compacts noisy terminal/diff outputs (>= MIN_COMPRESSIBLE_LENGTH) before applying
 * the 60%/40% head/tail character bound, returning both the bounded result and savings metadata.
 */
export function boundToolResultWithMeta(
  result: InternalMcpToolCallResult,
  limit: number,
  save?: (text: string) => string | null
): { result: InternalMcpToolCallResult; stats: ToolResultBoundStats } {
  const texts = result.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  if (texts.length === 0) {
    return {
      result,
      stats: { compacted: false, truncated: false, originalChars: 0, compactedChars: 0, finalChars: 0, charsSaved: 0 }
    }
  }
  const length = texts.reduce((sum, text) => sum + text.length, 0) + Math.max(0, texts.length - 1)
  if (length < MIN_COMPRESSIBLE_LENGTH && length <= limit) {
    return {
      result,
      stats: { compacted: false, truncated: false, originalChars: length, compactedChars: length, finalChars: length, charsSaved: 0 }
    }
  }

  const full = texts.join('\n')
  const compact = compactToolOutput(full)
  const candidate = compact.compacted ? compact.text : full

  if (candidate.length <= limit) {
    if (!compact.compacted) {
      return {
        result,
        stats: { compacted: false, truncated: false, originalChars: full.length, compactedChars: full.length, finalChars: full.length, charsSaved: 0 }
      }
    }
    return {
      result: {
        ...result,
        content: [{ type: 'text', text: candidate }, ...result.content.filter(block => block.type !== 'text')]
      },
      stats: {
        compacted: true,
        truncated: false,
        originalChars: full.length,
        compactedChars: candidate.length,
        finalChars: candidate.length,
        charsSaved: full.length - candidate.length
      }
    }
  }

  let saved: string | null
  try { saved = save?.(full) ?? null } catch { saved = null }
  const head = candidate.slice(0, safeIndex(candidate, Math.floor(limit * 0.6)))
  const tail = candidate.slice(safeIndex(candidate, candidate.length - Math.floor(limit * 0.4)))
  const omitted = candidate.length - head.length - tail.length
  const where = saved ? `The full output (${kb(full.length)}) is in ${saved}; read the part you need from it.` : 'The full output was not kept.'
  const marker = `\n\n[… ${kb(omitted)} of output omitted. ${where} …]\n\n`
  const finalText = head + marker + tail
  return {
    result: {
      ...result,
      content: [{ type: 'text', text: finalText }, ...result.content.filter(block => block.type !== 'text')]
    },
    stats: {
      compacted: compact.compacted,
      truncated: true,
      originalChars: full.length,
      compactedChars: candidate.length,
      finalChars: finalText.length,
      charsSaved: Math.max(0, full.length - finalText.length)
    }
  }
}

/**
 * Keeps a tool result within `limit` characters of text. A longer result keeps its beginning and end around a
 * marker that says how much was left out and, when `save` keeps the full text, the file that holds it.
 * Image blocks are kept as they are; the text blocks of a cut result become one block.
 */
export function boundToolResult(
  result: InternalMcpToolCallResult,
  limit: number,
  save?: (text: string) => string | null
): InternalMcpToolCallResult {
  return boundToolResultWithMeta(result, limit, save).result
}

/** Saves full outputs as `<root>/<tool>-<time>-<id>.txt`; the name never comes from the caller's arguments. */
export function toolOutputSaver(root: string, tool: string, now = Date.now()): (text: string) => string {
  return text => {
    mkdirSync(root, { recursive: true })
    const file = join(root, `${tool.replace(/[^\w-]/g, '_')}-${now}-${randomUUID().slice(0, 8)}.txt`)
    writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' })
    return file
  }
}

/** Deletes saved outputs older than the retention period. Returns how many were removed. */
export function pruneToolOutputs(root: string, now = Date.now()): number {
  let removed = 0
  let names: string[]
  try { names = readdirSync(root) } catch { return 0 }
  for (const name of names) {
    if (!name.endsWith('.txt')) continue
    const file = join(root, name)
    try {
      const stat = statSync(file)
      if (stat.isFile() && now - stat.mtimeMs > TOOL_OUTPUT_RETENTION_MS) { unlinkSync(file); removed++ }
    } catch { /* already gone */ }
  }
  return removed
}
