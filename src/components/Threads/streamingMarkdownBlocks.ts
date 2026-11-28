export interface StreamingMarkdownSplit {
  /** Immutable, closed top-level Markdown blocks that will not change as new tokens append. */
  stableBlocks: string[]
  /** The active tail currently still streaming (parsed synchronously on the main thread). */
  activeTail: string
}

interface FenceState {
  char: '`' | '~'
  length: number
}

const FENCE_OPEN_TOP_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_OPEN_INDENTED_RE = /^\s*(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_TOP_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const FENCE_CLOSE_INDENTED_RE = /^\s*(`{3,}|~{3,})[ \t]*$/
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/
const LIST_CONTINUATION_RE = /^(?: {2,}|\t)/
const INDENTED_CODE_RE = /^(?: {4}|\t)/
const REF_DEF_RE = /^ {0,3}\[[^\]]+\]:(?:\s|$)/

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function parseFenceOpen(raw: string, allowIndented = false): FenceState | null {
  const match = (allowIndented ? FENCE_OPEN_INDENTED_RE : FENCE_OPEN_TOP_RE).exec(raw)
  if (!match) return null
  const marker = match[1]
  const rest = match[2] ?? ''
  const char = marker[0] as '`' | '~'
  // CommonMark §4.5: backtick code fence info strings cannot contain backticks (prevents misreading ```inline```).
  if (char === '`' && rest.includes('`')) return null
  return { char, length: marker.length }
}

function isFenceClose(raw: string, fence: FenceState, allowIndented = false): boolean {
  const match = (allowIndented ? FENCE_CLOSE_INDENTED_RE : FENCE_CLOSE_TOP_RE).exec(raw)
  if (!match) return false
  const marker = match[1]
  return marker[0] === fence.char && marker.length >= fence.length
}

/**
 * Returns the closing delimiter (`$$` or `\]`) when `trimmed` opens a multi-line display math block
 * that is not closed on the same line; returns `null` for single-line math or non-math lines.
 */
function parseDisplayMathOpen(trimmed: string): '$$' | '\\]' | null {
  const opener = trimmed.startsWith('$$') ? '$$' : trimmed.startsWith('\\[') ? '\\[' : null
  if (!opener) return null
  const closer = opener === '$$' ? '$$' : '\\]'
  const rest = trimmed.slice(2)
  if (rest.length >= closer.length && rest.endsWith(closer)) return null
  return closer
}

/**
 * True when any non-fenced line contains a Markdown reference link or footnote definition (`[id]: url`).
 * Reference definitions can affect earlier blocks, so we fall back to parsing as a single tail block.
 */
function hasReferenceDefinitions(lines: string[]): boolean {
  let fence: FenceState | null = null
  for (const line of lines) {
    const raw = stripCarriageReturn(line)
    if (fence) {
      if (isFenceClose(raw, fence, true)) fence = null
      continue
    }
    const opened = parseFenceOpen(raw, false)
    if (opened) {
      fence = opened
      continue
    }
    if (REF_DEF_RE.test(raw)) return true
  }
  return false
}

function findNextNonBlankLine(lines: string[], fromIndex: number): number {
  for (let index = fromIndex; index < lines.length; index++) {
    if (stripCarriageReturn(lines[index]).trim() !== '') return index
  }
  return -1
}

/**
 * Splits streaming Markdown into immutable completed top-level blocks (`stableBlocks`) plus the
 * trailing block still receiving tokens (`activeTail`).
 *
 * Guarantees it never splits inside:
 * - open fenced code blocks (``` or ~~~),
 * - open display math blocks (`$$ ... $$` or `\[ ... \]`),
 * - Markdown tables (consecutive `|...|` lines),
 * - blockquotes and GitHub Alerts (`> ...`),
 * - contiguous or loose list blocks (`- `, `* `, `1. `, and indented continuations),
 * - documents containing reference link / footnote definitions (`[id]: ...`).
 */
export function splitStreamingMarkdownBlocks(text: string): StreamingMarkdownSplit {
  if (!text || text.trim() === '') {
    return { stableBlocks: [], activeTail: text }
  }

  const lines = text.split('\n')
  if (hasReferenceDefinitions(lines)) {
    return { stableBlocks: [], activeTail: text }
  }

  const stableBlocks: string[] = []
  let blockStart = -1
  let lastNonBlank = -1
  let fence: FenceState | null = null
  let mathCloser: '$$' | '\\]' | null = null
  let isListBlock = false
  let isIndentedCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const raw = stripCarriageReturn(lines[i])
    const trimmed = raw.trim()

    if (fence) {
      if (isFenceClose(raw, fence, isListBlock)) {
        fence = null
      }
      lastNonBlank = i
      continue
    }

    if (mathCloser) {
      // Match protectMath: a fence opener aborts an unclosed display math scan.
      const fenceOpen = parseFenceOpen(raw, isListBlock)
      if (fenceOpen) {
        mathCloser = null
        fence = fenceOpen
      } else if (trimmed.endsWith(mathCloser)) {
        mathCloser = null
      }
      lastNonBlank = i
      continue
    }

    if (blockStart === -1) {
      if (trimmed === '') continue
      blockStart = i
      lastNonBlank = i
      const fenceOpen = parseFenceOpen(raw, false)
      if (fenceOpen) {
        fence = fenceOpen
        continue
      }
      const openMath = parseDisplayMathOpen(trimmed)
      if (openMath) {
        mathCloser = openMath
        continue
      }
      isListBlock = LIST_ITEM_RE.test(raw)
      isIndentedCodeBlock = !isListBlock && INDENTED_CODE_RE.test(raw)
      continue
    }

    // A blank line only completes a block when followed by a newline (`i < lines.length - 1`);
    // a single trailing `\n` at EOF leaves `lines[lines.length - 1] === ''` and is NOT a blank line.
    if (trimmed === '') {
      if (i === lines.length - 1) continue

      if (isListBlock) {
        const nextIdx = findNextNonBlankLine(lines, i + 1)
        if (nextIdx === -1) break
        const nextRaw = stripCarriageReturn(lines[nextIdx])
        if (LIST_ITEM_RE.test(nextRaw) || LIST_CONTINUATION_RE.test(nextRaw)) {
          i = nextIdx - 1
          continue
        }
      } else if (isIndentedCodeBlock) {
        const nextIdx = findNextNonBlankLine(lines, i + 1)
        if (nextIdx === -1) break
        const nextRaw = stripCarriageReturn(lines[nextIdx])
        if (INDENTED_CODE_RE.test(nextRaw)) {
          i = nextIdx - 1
          continue
        }
      }

      stableBlocks.push(lines.slice(blockStart, lastNonBlank + 1).join('\n'))
      blockStart = -1
      lastNonBlank = -1
      isListBlock = false
      isIndentedCodeBlock = false
      continue
    }

    lastNonBlank = i
    const fenceOpen = parseFenceOpen(raw, isListBlock)
    if (fenceOpen) {
      fence = fenceOpen
      continue
    }
    const openMath = parseDisplayMathOpen(trimmed)
    if (openMath) {
      mathCloser = openMath
      continue
    }
    if (!isListBlock && LIST_ITEM_RE.test(raw)) {
      isListBlock = true
      isIndentedCodeBlock = false
    }
  }

  const activeTail = blockStart === -1 ? '' : lines.slice(blockStart).join('\n')
  return { stableBlocks, activeTail }
}
