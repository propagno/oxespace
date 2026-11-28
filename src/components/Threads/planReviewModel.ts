import type { ThreadRequest } from '../../../shared/types/thread'

export type PlanBlockKind = 'heading' | 'listItem' | 'code' | 'blockquote' | 'paragraph'

export interface PlanSectionBlock {
  /** Stable 0-based index in the parsed plan. */
  index: number
  kind: PlanBlockKind
  /** Markdown slice for this logical block, rendered by ThreadMarkdown. */
  markdown: string
  /** Crisp plain-text single-line excerpt for anchoring comments and feedback. */
  excerpt: string
  /** 1-based inclusive line range in the source plan text. */
  lineRange: { start: number; end: number }
}

export interface PlanInlineComment {
  id: string
  sectionIndex: number
  excerpt: string
  lineRange: { start: number; end: number }
  comment: string
}

const HEADING_RE = /^#{1,6}\s+\S/
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/
const BLOCKQUOTE_RE = /^\s*>\s?/
const HR_RE = /^\s*(?:[-*_]\s*){3,}$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/

const MAX_EXCERPT_LENGTH = 90

/** True when a request is an ExitPlanMode plan approval request. */
export function isPlanReviewRequest(request: ThreadRequest): boolean {
  return request.kind === 'approval' && (request.nativeMethod === 'can_use_tool:ExitPlanMode' || request.toolName === 'ExitPlanMode')
}

/** Extracts the Markdown plan text from an ExitPlanMode approval request (plain or JSON-wrapped). */
export function extractPlanText(request: ThreadRequest): string | undefined {
  if (!isPlanReviewRequest(request)) return undefined
  const raw = request.impact?.text ?? request.command ?? request.detail ?? ''
  if (!raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as { plan?: unknown }
    if (typeof parsed.plan === 'string' && parsed.plan.trim()) return parsed.plan.trim()
  } catch {
    // Plain Markdown plan text
  }
  return raw.trim()
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipExcerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_EXCERPT_LENGTH) return clean
  return `${clean.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…`
}

function buildExcerpt(markdown: string, kind: PlanBlockKind): string {
  const lines = markdown.split('\n')
  if (kind === 'code') {
    const fenceMatch = FENCE_RE.exec(lines[0] ?? '')
    const lang = fenceMatch?.[3]?.trim().split(/\s+/)[0] ?? ''
    const firstCodeLine = lines.slice(1, -1).find(line => line.trim().length > 0)?.trim() ?? ''
    const summary = lang && firstCodeLine ? `${lang}: ${firstCodeLine}` : firstCodeLine || lang || 'Code block'
    return clipExcerpt(summary)
  }
  if (kind === 'heading') {
    return clipExcerpt(stripInlineMarkdown((lines[0] ?? '').replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '')))
  }
  if (kind === 'listItem') {
    const first = (lines[0] ?? '').replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    return clipExcerpt(stripInlineMarkdown(first))
  }
  if (kind === 'blockquote') {
    const first = lines.map(line => line.replace(/^\s*>\s?/, '')).find(line => line.trim().length > 0) ?? ''
    return clipExcerpt(stripInlineMarkdown(first))
  }
  const firstLine = lines.find(line => line.trim().length > 0) ?? ''
  return clipExcerpt(stripInlineMarkdown(firstLine))
}

function isBlockStarter(lines: string[], idx: number): boolean {
  const line = lines[idx]
  if (line === undefined || !line.trim()) return true
  if (HEADING_RE.test(line) || FENCE_RE.test(line) || LIST_ITEM_RE.test(line) || BLOCKQUOTE_RE.test(line) || HR_RE.test(line)) return true
  // Table header + separator row
  if (line.includes('|') && idx + 1 < lines.length && TABLE_SEP_RE.test(lines[idx + 1])) return true
  return false
}

/**
 * Splits a Markdown plan into logical, independently commentable sections/blocks
 * while preserving exact Markdown for rendering via ThreadMarkdown.
 */
export function parsePlanSections(markdown: string): PlanSectionBlock[] {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const blocks: PlanSectionBlock[] = []
  let i = 0

  const pushBlock = (kind: PlanBlockKind, startIdx: number, endIdx: number) => {
    const slice = lines.slice(startIdx, endIdx + 1).join('\n')
    if (!slice.trim()) return
    const excerpt = buildExcerpt(slice, kind)
    blocks.push({
      index: blocks.length,
      kind,
      markdown: slice,
      excerpt: excerpt || `Section ${blocks.length + 1}`,
      lineRange: { start: startIdx + 1, end: endIdx + 1 }
    })
  }

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    // Fenced code block
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const markerChar = fence[2][0]
      const markerLen = fence[2].length
      const start = i
      i += 1
      while (i < lines.length) {
        const closeMatch = new RegExp(`^\\s*${markerChar === '~' ? '~' : '`'}{${markerLen},}\\s*$`).test(lines[i])
        if (closeMatch) {
          i += 1
          break
        }
        i += 1
      }
      pushBlock('code', start, i - 1)
      continue
    }

    // ATX heading
    if (HEADING_RE.test(line)) {
      pushBlock('heading', i, i)
      i += 1
      continue
    }

    // Horizontal rule (skip as standalone divider, not a commentable step)
    if (HR_RE.test(line)) {
      i += 1
      continue
    }

    // Blockquote
    if (BLOCKQUOTE_RE.test(line)) {
      const start = i
      i += 1
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) i += 1
      pushBlock('blockquote', start, i - 1)
      continue
    }

    // List item (bullet or numbered step, including indented continuation lines / sub-items)
    const listMatch = LIST_ITEM_RE.exec(line)
    if (listMatch) {
      const baseIndent = listMatch[1].length
      const start = i
      i += 1
      while (i < lines.length) {
        const next = lines[i]
        if (!next.trim()) break
        const nextIndent = (next.match(/^(\s*)/)?.[1].length ?? 0)
        // Sibling list item at same or lesser indent ends this item
        if (LIST_ITEM_RE.test(next) && nextIndent <= baseIndent) break
        if (HEADING_RE.test(next) || FENCE_RE.test(next) || HR_RE.test(next)) break
        i += 1
      }
      pushBlock('listItem', start, i - 1)
      continue
    }

    // Markdown table
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const start = i
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) i += 1
      pushBlock('paragraph', start, i - 1)
      continue
    }

    // Plain paragraph
    const start = i
    i += 1
    while (i < lines.length && !isBlockStarter(lines, i)) i += 1
    pushBlock('paragraph', start, i - 1)
  }

  return blocks
}

/**
 * Formats inline plan review comments and an optional general note into a structured,
 * agent-readable feedback payload for the decline response.
 */
export function formatPlanReviewFeedback(comments: PlanInlineComment[], generalNote: string): string {
  const sorted = [...comments]
    .filter(item => item.comment.trim().length > 0)
    .sort((a, b) => a.sectionIndex - b.sectionIndex)
  const trimmedGeneral = generalNote.trim()
  if (sorted.length === 0 && !trimmedGeneral) return ''

  const lines: string[] = ['Plan review feedback:']
  sorted.forEach((item, idx) => {
    const loc = item.lineRange.start === item.lineRange.end
      ? `L${item.lineRange.start}`
      : `L${item.lineRange.start}-${item.lineRange.end}`
    const safeExcerpt = item.excerpt.replace(/"/g, "'")
    lines.push(`${idx + 1}. Regarding "${safeExcerpt}" (${loc}): ${item.comment.trim()}`)
  })

  if (trimmedGeneral) {
    if (sorted.length > 0) lines.push('')
    lines.push(sorted.length > 0 ? `General note: ${trimmedGeneral}` : trimmedGeneral)
  }

  return lines.join('\n')
}
