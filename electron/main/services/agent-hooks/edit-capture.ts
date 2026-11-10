import { redactSecrets } from '../../../../shared/secrets'

export interface EditSummary {
  tool: string
  path: string
  line: number | null
  added: number
  removed: number
}

interface StructuredHunk {
  oldStart?: number
  oldLines?: number
  newStart?: number
  newLines?: number
  lines?: unknown[]
}

function countLines(content: unknown): number {
  if (typeof content !== 'string' || content.length === 0) return 0
  const normalized = content.endsWith('\r\n')
    ? content.slice(0, -2)
    : content.endsWith('\n')
      ? content.slice(0, -1)
      : content
  if (normalized.length === 0) return 1
  return normalized.split(/\r?\n/).length
}

function diffStringCounts(oldStr: string, newStr: string): { added: number; removed: number } {
  const oldLines = oldStr ? oldStr.split(/\r?\n/) : []
  const newLines = newStr ? newStr.split(/\r?\n/) : []
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < (oldLines.length - prefix) &&
    suffix < (newLines.length - prefix) &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++
  }
  const removed = oldLines.length - prefix - suffix
  const added = newLines.length - prefix - suffix
  return { added, removed }
}

function parseStructuredPatch(structuredPatch: unknown[]): { line: number | null; added: number; removed: number } {
  let added = 0
  let removed = 0
  let firstLine: number | null = null

  for (const hunk of structuredPatch) {
    if (!hunk || typeof hunk !== 'object') continue
    const sh = hunk as StructuredHunk
    const newStart = typeof sh.newStart === 'number' ? sh.newStart : 1
    const lines = Array.isArray(sh.lines) ? sh.lines : []
    let leadingContext = 0
    let hasLeadingContext = true
    let hunkAdded = 0
    let hunkRemoved = 0

    for (const rawLine of lines) {
      if (typeof rawLine !== 'string') continue
      if (rawLine.startsWith('+')) {
        hunkAdded++
        hasLeadingContext = false
      } else if (rawLine.startsWith('-')) {
        hunkRemoved++
        hasLeadingContext = false
      } else {
        if (hasLeadingContext) {
          leadingContext++
        }
      }
    }

    if (hunkAdded > 0 || hunkRemoved > 0) {
      const changedLine = newStart + leadingContext
      if (firstLine === null || changedLine < firstLine) {
        firstLine = changedLine
      }
    }
    added += hunkAdded
    removed += hunkRemoved
  }

  return { line: firstLine, added, removed }
}

function cleanPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return redactSecrets(trimmed).slice(0, 1024)
}

export function summarizeEdits(record: unknown): EditSummary[] {
  if (!record || typeof record !== 'object') return []
  const rec = record as Record<string, unknown>
  const event = rec.hook_event_name
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return []

  const tool = typeof rec.tool_name === 'string' ? rec.tool_name : ''
  const input = rec.tool_input && typeof rec.tool_input === 'object' ? (rec.tool_input as Record<string, unknown>) : {}
  const response = rec.tool_response && typeof rec.tool_response === 'object' ? (rec.tool_response as Record<string, unknown>) : {}

  if (tool === 'Edit') {
    const rawPath = input.file_path ?? input.filePath ?? response.filePath ?? response.file_path
    const path = cleanPath(rawPath)
    if (!path) return []

    const patch = Array.isArray(response.structuredPatch)
      ? response.structuredPatch
      : Array.isArray(input.structuredPatch)
        ? input.structuredPatch
        : null

    if (patch) {
      const { line, added, removed } = parseStructuredPatch(patch)
      return [{ tool: 'Edit', path, line, added, removed }]
    }

    const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
    const newStr = typeof input.new_string === 'string' ? input.new_string : ''
    const counts = diffStringCounts(oldStr, newStr)
    return [{ tool: 'Edit', path, line: null, added: counts.added, removed: counts.removed }]
  }

  if (tool === 'MultiEdit') {
    const rawPath = input.file_path ?? input.filePath ?? response.filePath ?? response.file_path
    const path = cleanPath(rawPath)
    if (!path) return []

    const patch = Array.isArray(response.structuredPatch)
      ? response.structuredPatch
      : Array.isArray(input.structuredPatch)
        ? input.structuredPatch
        : null

    if (patch) {
      const { line, added, removed } = parseStructuredPatch(patch)
      return [{ tool: 'MultiEdit', path, line, added, removed }]
    }

    if (Array.isArray(input.edits)) {
      let added = 0
      let removed = 0
      for (const edit of input.edits) {
        if (!edit || typeof edit !== 'object') continue
        const e = edit as Record<string, unknown>
        const oldStr = typeof e.old_string === 'string' ? e.old_string : ''
        const newStr = typeof e.new_string === 'string' ? e.new_string : ''
        const counts = diffStringCounts(oldStr, newStr)
        added += counts.added
        removed += counts.removed
      }
      return [{ tool: 'MultiEdit', path, line: null, added, removed }]
    }

    return [{ tool: 'MultiEdit', path, line: null, added: 0, removed: 0 }]
  }

  if (tool === 'Write') {
    const rawPath = input.file_path ?? input.filePath ?? response.filePath ?? response.file_path
    const path = cleanPath(rawPath)
    if (!path) return []

    const patch = Array.isArray(response.structuredPatch)
      ? response.structuredPatch
      : Array.isArray(input.structuredPatch)
        ? input.structuredPatch
        : null

    if (patch) {
      const { line, added, removed } = parseStructuredPatch(patch)
      return [{ tool: 'Write', path, line, added, removed }]
    }

    const content = input.content
    const added = countLines(content)
    return [{ tool: 'Write', path, line: 1, added, removed: 0 }]
  }

  if (tool === 'apply_patch') {
    const patch = typeof input.patch === 'string' ? input.patch : ''
    if (!patch) return []

    const lines = patch.split(/\r?\n/)
    const results: EditSummary[] = []
    let current: { path: string; added: number; removed: number } | null = null

    const flush = () => {
      if (current) {
        results.push({
          tool: 'apply_patch',
          path: current.path,
          line: null,
          added: current.added,
          removed: current.removed
        })
        current = null
      }
    }

    for (const line of lines) {
      const fileMatch = line.match(/^\*\*\*\s+(?:Update|Add|Delete|Create|Modify)?\s*File:\s*(.+)$/i)
      if (fileMatch) {
        flush()
        const cleaned = cleanPath(fileMatch[1])
        if (cleaned) {
          current = { path: cleaned, added: 0, removed: 0 }
        }
        continue
      }
      if (line.startsWith('***')) {
        if (/^\*\*\*\s+End Patch/i.test(line)) {
          flush()
        }
        continue
      }
      if (current) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          current.added++
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          current.removed++
        }
      }
    }
    flush()
    return results
  }

  return []
}
