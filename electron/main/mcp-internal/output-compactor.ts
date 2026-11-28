import { stripAnsi } from '../utils/strip-ansi'

/** Outputs shorter than this threshold are returned untouched without compaction overhead. */
export const MIN_COMPRESSIBLE_LENGTH = 1024

export interface CompactToolOutputResult {
  text: string
  compacted: boolean
  originalChars: number
  compactedChars: number
  charsSaved: number
  skippedReason?: 'too_short' | 'structured_format' | 'no_reduction'
}

export interface CompactToolOutputOptions {
  minLength?: number
}

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'poetry.lock',
  'composer.lock'
])

const ANSI_ESCAPE_RE = /\x1B[\[\]@-_]/
const GIT_DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/
const RENDER_DIFF_HEADER_RE = /^--- (.+?) \(\+\d+ -\d+\)$/
const CRITICAL_KEYWORD_RE = /\b(error|err!|failed|failure|fatal|exception|panic|assert(?:ion)?|traceback|unhandled|syntaxerror|typeerror|referenceerror|rangeerror)\b/i
const CRITICAL_PREFIX_RE = /^\s*(?:FAIL|ERR!|ERROR|FATAL|×|✗|✖)\b/
const STACK_FRAME_RE = /^\s+(?:at\s+\S|File ".*", line \d+|#\d+\s+0x[0-9a-f]+)/i
const FILE_LINE_DIAG_RE = /(?:^|[\s(])[\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|scala|vue|svelte|json|yaml|yml|toml):\d+(?::\d+)?\b|\(\d+,\d+\):\s*(?:error|warning)\b/i
const EXIT_CODE_RE = /\b(?:exit(?:ed)?\s+(?:with\s+)?code\s+-?\d+|process exited|signal\s+SIG[A-Z0-9]+)\b/i
const TEST_SUMMARY_RE = /^\s*(?:Test Files|Tests|Suites|Snapshots|PASS|FAIL)\s+|\b\d+\s+(?:failed|errors?)\b/i

const NPM_WARN_DEPRECATED_RE = /^\s*npm\s+warn\s+deprecated\b/i
const PROGRESS_BAR_RE = /[█▓▒░■□▪▫━]{6,}|\[\s*[=#>-]{5,}\s*\]\s*\d{1,3}%/
const SPINNER_LINE_RE = /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\-]\s+(?:Loading|Installing|Resolving|Fetching|Building|Compiling|Downloading|Extracting|Bundling|Transforming|Running|Waiting)\b/i
const BUNDLER_PCT_RE = /^\s*\d{1,3}%\s+(?:building|sealing|emitting|compiling|bundling|resolving|fetching|downloading|extracting|chunk\s+graph)\b/i
const PKG_PROGRESS_RE = /^\s*(?:Downloading|Fetching|Resolving|Extracting|Progress:|Packages:|\+\+\+---)\s+.*(?:\d+%|\/s\b|\d+\/\d+|reused\s+\d+|resolved\s+\d+)/i

function isLockfilePath(rawPath: string): boolean {
  const clean = rawPath.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/')
  const base = clean.split('/').pop()?.toLowerCase() ?? ''
  return LOCKFILE_NAMES.has(base)
}

function tryParseJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function isNdjson(lines: string[]): boolean {
  const nonEmpty = lines.filter(line => line.trim().length > 0)
  if (nonEmpty.length < 2) return false
  const sample = nonEmpty.slice(0, 50)
  for (const line of sample) {
    const t = line.trim()
    if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return false
    if (!tryParseJson(t)) return false
  }
  return nonEmpty.every(line => {
    const t = line.trim()
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
  })
}

function isXmlLike(trimmed: string): boolean {
  if (/^<\?xml\b[\s\S]*>$/.test(trimmed)) return true
  if (/^<![Dd][Oo][Cc][Tt][Yy][Pp][Ee]\s+[\s\S]*>$/.test(trimmed)) return true
  if (/^<[A-Za-z_][\w:.-]*(?:\s[^>]*)?\/>$/.test(trimmed)) return true
  const open = /^<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/.exec(trimmed)
  if (!open) return false
  const rootTag = open[1]
  return trimmed.endsWith(`</${rootTag}>`)
}

function countCsvColumns(line: string): number | null {
  let columns = 1
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      columns++
    }
  }
  return inQuotes ? null : columns
}

function isCsvLike(lines: string[]): boolean {
  const nonEmpty = lines.filter(line => line.trim().length > 0)
  if (nonEmpty.length < 3) return false
  const header = nonEmpty[0]
  if (!header.includes(',') || CRITICAL_PREFIX_RE.test(header)) return false
  const expectedCols = countCsvColumns(header)
  if (expectedCols === null || expectedCols < 2) return false
  // Header cells should look like field names, not long log prose.
  const rawHeaderCells = header.split(',')
  if (rawHeaderCells.some(cell => cell.trim().length > 64)) return false
  const sample = nonEmpty.slice(1, 100)
  for (const row of sample) {
    if (countCsvColumns(row) !== expectedCols) return false
  }
  return true
}

function isTomlLike(lines: string[]): boolean {
  const meaningful = lines
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
  if (meaningful.length < 2) return false

  const tableHeaderRe = /^\[\[?[A-Za-z0-9_."'-]+(?:\s*\.\s*[A-Za-z0-9_."'-]+)*\]?\]\s*(?:#.*)?$/
  const kvRe = /^(?:[A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*.+$/
  const typedKvRe = /^(?:[A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*(?:"|'|\[|\{|true\b|false\b|-?\d)/

  let tableHeaders = 0
  let kvCount = 0
  let typedKvCount = 0
  let validLines = 0
  let inMultiline = false

  for (const line of meaningful) {
    if (GIT_DIFF_HEADER_RE.test(line) || STACK_FRAME_RE.test(line)) return false
    if (inMultiline) {
      validLines++
      if (line.includes('"""') || line.includes("'''") || line === ']' || line === '}' || line.endsWith(']') || line.endsWith('}')) {
        inMultiline = false
      }
      continue
    }
    if (tableHeaderRe.test(line)) {
      tableHeaders++
      validLines++
    } else if (kvRe.test(line)) {
      kvCount++
      if (typedKvRe.test(line)) typedKvCount++
      validLines++
      if ((line.endsWith('[') || line.endsWith('{') || line.endsWith('"""') || line.endsWith("'''")) && !line.endsWith('[]') && !line.endsWith('{}')) {
        inMultiline = true
      }
    } else if (/^[\]}],?\s*(?:#.*)?$/.test(line) || /^["'][^"']*["'],?\s*(?:#.*)?$/.test(line)) {
      validLines++
    }
  }

  const ratio = validLines / meaningful.length
  if (ratio < 0.85) return false
  return (tableHeaders >= 1 && kvCount >= 1) || typedKvCount >= 3
}

function isYamlLike(lines: string[]): boolean {
  const nonEmpty = lines.filter(line => {
    const t = line.trim()
    return t.length > 0 && !t.startsWith('#')
  })
  if (nonEmpty.length < 2) return false

  const yamlKeyRe = /^(\s*)(?:[A-Za-z_][A-Za-z0-9_./-]*|"[^"]+"|'[^']+')\s*:(?:\s+.*|\s*)$/
  const yamlSeqRe = /^(\s*)-\s+\S|^(\s*)-$/
  const yamlDocRe = /^(?:---|\.\.\.)\s*$/
  const logColonFalsePositiveRe = /^\s*(?:Error|TypeError|SyntaxError|ReferenceError|Warning|WARN|INFO|DEBUG|TRACE|FAIL|PASS|FATAL)\s*:/i

  let structuralCount = 0
  let validCount = 0
  let blockScalarIndent: number | null = null
  let hasDocMarker = false

  for (const raw of nonEmpty) {
    if (GIT_DIFF_HEADER_RE.test(raw) || /^@@\s+-\d+/.test(raw) || STACK_FRAME_RE.test(raw) || NPM_WARN_DEPRECATED_RE.test(raw)) {
      return false
    }
    if (logColonFalsePositiveRe.test(raw) || FILE_LINE_DIAG_RE.test(raw)) return false

    const indent = raw.length - raw.trimStart().length
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) {
        validCount++
        continue
      }
      blockScalarIndent = null
    }

    const trimmed = raw.trim()
    if (yamlDocRe.test(trimmed)) {
      hasDocMarker = true
      validCount++
      continue
    }

    if (yamlKeyRe.test(raw)) {
      // Exclude URLs like `https://...` and Windows drive paths like `C:\...`
      const keyPart = trimmed.slice(0, trimmed.indexOf(':'))
      if (/^https?$/i.test(keyPart) || /^[A-Za-z]$/.test(keyPart)) return false
      structuralCount++
      validCount++
      if (/:[ \t]*[|>][+-]?\d*\s*$/.test(trimmed)) {
        blockScalarIndent = indent
      }
      continue
    }

    if (yamlSeqRe.test(raw)) {
      structuralCount++
      validCount++
      continue
    }

    // Continuation line inside indented structure (e.g. folded prose or multiline value)
    if (indent >= 2 && structuralCount > 0) {
      validCount++
    }
  }

  const ratio = validCount / nonEmpty.length
  return ratio >= 0.85 && (structuralCount >= 2 || (hasDocMarker && structuralCount >= 1))
}

/**
 * Returns true when `text` is a valid structured machine-readable format (JSON, NDJSON, YAML, TOML, CSV, or XML)
 * that semantic line compaction must NEVER mutate or strip.
 */
export function isProtectedStructuredOutput(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // 1. JSON object or array
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    if (tryParseJson(trimmed)) return true
  }

  // Anything containing raw ANSI escape codes or bare CR overwrite frames is terminal output, not a structured document.
  if (ANSI_ESCAPE_RE.test(trimmed)) return false
  const normalized = trimmed.replace(/\r\n/g, '\n')
  if (normalized.includes('\r')) return false

  // 2. XML / SVG / DOCTYPE document
  if (trimmed.startsWith('<') && isXmlLike(trimmed)) return true

  const lines = normalized.split('\n')

  // 3. NDJSON (JSON Lines)
  if (isNdjson(lines)) return true

  // 4. TOML
  if (isTomlLike(lines)) return true

  // 5. YAML
  if (isYamlLike(lines)) return true

  // 6. CSV
  if (isCsvLike(lines)) return true

  return false
}

/**
 * Identifies error lines, stack traces, file:line diagnostics, test failures, and exit codes
 * that must NEVER be stripped as progress/warning noise.
 */
export function isCriticalDiagnosticLine(line: string): boolean {
  if (!line.trim()) return false
  return (
    CRITICAL_PREFIX_RE.test(line) ||
    CRITICAL_KEYWORD_RE.test(line) ||
    STACK_FRAME_RE.test(line) ||
    FILE_LINE_DIAG_RE.test(line) ||
    EXIT_CODE_RE.test(line) ||
    TEST_SUMMARY_RE.test(line)
  )
}

function resolveCarriageReturnOverwrites(line: string): string {
  if (!line.includes('\r')) return line
  const frames = line.split('\r')
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].trim().length > 0) return frames[i]
  }
  return ''
}

function isNoisyProgressLine(line: string): boolean {
  if (isCriticalDiagnosticLine(line)) return false
  return PROGRESS_BAR_RE.test(line) || SPINNER_LINE_RE.test(line) || BUNDLER_PCT_RE.test(line) || PKG_PROGRESS_RE.test(line)
}

function collapseLockfileDiffs(lines: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const gitMatch = GIT_DIFF_HEADER_RE.exec(line)
    const renderMatch = !gitMatch ? RENDER_DIFF_HEADER_RE.exec(line) : null
    const lockPath = gitMatch ? (isLockfilePath(gitMatch[2]) ? gitMatch[2] : isLockfilePath(gitMatch[1]) ? gitMatch[1] : null)
      : renderMatch && isLockfilePath(renderMatch[1]) ? renderMatch[1] : null

    if (!lockPath) {
      out.push(line)
      i++
      continue
    }

    out.push(line)
    i++
    let changed = 0
    let bodyLines = 0
    while (i < lines.length) {
      const next = lines[i]
      if (GIT_DIFF_HEADER_RE.test(next) || (renderMatch && RENDER_DIFF_HEADER_RE.test(next))) break
      bodyLines++
      if ((next.startsWith('+') && !next.startsWith('+++')) || (next.startsWith('-') && !next.startsWith('---'))) {
        changed++
      }
      i++
    }
    const reported = changed > 0 ? changed : bodyLines
    out.push(`[lockfile diff omitted: ${reported} lines changed]`)
  }
  return out
}

function collapseNoiseAndBoilerplate(lines: string[]): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 1. Collapse consecutive `npm warn deprecated` lines
    if (NPM_WARN_DEPRECATED_RE.test(line) && !isCriticalDiagnosticLine(line)) {
      let count = 0
      while (i < lines.length && NPM_WARN_DEPRECATED_RE.test(lines[i]) && !isCriticalDiagnosticLine(lines[i])) {
        count++
        i++
      }
      if (count >= 2) {
        out.push(`[npm warn deprecated omitted: ${count} lines]`)
      } else {
        out.push(line)
      }
      continue
    }

    // 2. Collapse noisy progress/download bar lines
    if (isNoisyProgressLine(line)) {
      let count = 0
      while (i < lines.length && isNoisyProgressLine(lines[i])) {
        count++
        i++
      }
      if (count >= 2) {
        out.push(`[progress output omitted: ${count} lines]`)
      }
      continue
    }

    // 3. Collapse runs of >= 3 consecutive blank lines into 1 blank line
    if (line.trim() === '') {
      let blanks = 0
      while (i < lines.length && lines[i].trim() === '') {
        blanks++
        i++
      }
      out.push('')
      if (blanks === 2) out.push('')
      continue
    }

    // 4. Deduplicate repeated identical consecutive boilerplate lines
    let run = 1
    while (i + run < lines.length && lines[i + run] === line) {
      run++
    }
    if (run >= 2) {
      const marker = `[repeated ${run} times]`
      const saved = (run - 1) * (line.length + 1) - (marker.length + 1)
      if (run >= 3 || saved > 0) {
        out.push(line)
        out.push(marker)
      } else {
        for (let k = 0; k < run; k++) out.push(line)
      }
      i += run
      continue
    }

    out.push(line)
    i++
  }
  return out
}

/**
 * Semantically compacts verbose terminal/command/git outputs before blind head/tail truncation.
 * Strictly skips short outputs (`< minLength`) and protected structured formats (JSON, YAML, TOML, CSV, XML).
 */
export function compactToolOutput(text: string, options: CompactToolOutputOptions = {}): CompactToolOutputResult {
  const originalChars = text.length
  const minLength = options.minLength ?? MIN_COMPRESSIBLE_LENGTH
  if (originalChars < minLength) {
    return { text, compacted: false, originalChars, compactedChars: originalChars, charsSaved: 0, skippedReason: 'too_short' }
  }
  if (isProtectedStructuredOutput(text)) {
    return { text, compacted: false, originalChars, compactedChars: originalChars, charsSaved: 0, skippedReason: 'structured_format' }
  }

  const stripped = stripAnsi(text).replace(/\r\n/g, '\n')
  const rawLines = stripped.split('\n').map(resolveCarriageReturnOverwrites)
  const withoutLockfiles = collapseLockfileDiffs(rawLines)
  const compactedLines = collapseNoiseAndBoilerplate(withoutLockfiles)
  const candidate = compactedLines.join('\n')

  if (candidate.length >= originalChars) {
    return { text, compacted: false, originalChars, compactedChars: originalChars, charsSaved: 0, skippedReason: 'no_reduction' }
  }

  return {
    text: candidate,
    compacted: true,
    originalChars,
    compactedChars: candidate.length,
    charsSaved: originalChars - candidate.length
  }
}
