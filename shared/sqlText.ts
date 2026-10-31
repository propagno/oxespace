/**
 * Text-level helpers for SQL that both the editor (renderer) and the server side need:
 * where each statement starts and ends, which statement the cursor is in, and which
 * `:name` / `$1` parameters a statement uses. Nothing here parses SQL; it only knows where
 * comments, quoted text and dollar-quoted bodies are, so a `;` or a `:x` inside them is not
 * mistaken for syntax.
 */

export interface StatementSpan {
  /** Offset of the first character of the statement (leading space and comments skipped). */
  start: number
  /** Offset just after the statement's last character (the `;` is not included). */
  end: number
  text: string
}

type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'dollar'

interface Cursor { mode: Mode; blockDepth: number; dollarTag: string; escapes: boolean }

/** Advances over one lexical token boundary: returns the new index and keeps `state` in step. */
function step(sql: string, index: number, state: Cursor): number {
  const char = sql[index]
  const next = sql[index + 1]
  switch (state.mode) {
    case 'line':
      if (char === '\n') state.mode = 'code'
      return index + 1
    case 'block':
      if (char === '/' && next === '*') { state.blockDepth++; return index + 2 }
      if (char === '*' && next === '/') { state.blockDepth--; if (state.blockDepth === 0) state.mode = 'code'; return index + 2 }
      return index + 1
    case 'single':
      if (state.escapes && char === '\\') return index + 2
      if (char === "'") {
        if (next === "'") return index + 2
        state.mode = 'code'
      }
      return index + 1
    case 'double':
      if (char === '"') {
        if (next === '"') return index + 2
        state.mode = 'code'
      }
      return index + 1
    case 'dollar':
      if (char === '$' && sql.startsWith(state.dollarTag, index)) { state.mode = 'code'; return index + state.dollarTag.length }
      return index + 1
    default: {
      if (char === '-' && next === '-') { state.mode = 'line'; return index + 2 }
      if (char === '/' && next === '*') { state.mode = 'block'; state.blockDepth = 1; return index + 2 }
      if (char === "'") {
        // E'...' honours backslash escapes; a plain string does not.
        state.escapes = /[eE]/.test(sql[index - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[index - 2] ?? '')
        state.mode = 'single'
        return index + 1
      }
      if (char === '"') { state.mode = 'double'; return index + 1 }
      if (char === '$') {
        const tag = /^\$[A-Za-z_\u0080-￿]?[A-Za-z0-9_\u0080-￿]*\$/.exec(sql.slice(index, index + 64))
        if (tag && !/[A-Za-z0-9_]/.test(sql[index - 1] ?? '')) { state.mode = 'dollar'; state.dollarTag = tag[0]; return index + tag[0].length }
      }
      return index + 1
    }
  }
}

const newCursor = (): Cursor => ({ mode: 'code', blockDepth: 0, dollarTag: '', escapes: false })

/** Whether the text between two offsets holds anything but whitespace and comments. */
function hasCode(sql: string, from: number, to: number): boolean {
  const state = newCursor()
  for (let index = from; index < to;) {
    const before = state.mode
    const char = sql[index]
    const advanced = step(sql, index, state)
    if (before === 'code' && state.mode === 'code' && !/\s/.test(char)) return true
    if (before === 'code' && (state.mode === 'single' || state.mode === 'double' || state.mode === 'dollar')) return true
    index = advanced
  }
  return false
}

/** The offset of the first character that is neither whitespace nor part of a comment. */
function skipTrivia(sql: string, from: number, to: number): number {
  let index = from
  while (index < to) {
    if (/\s/.test(sql[index])) index++
    else if (sql[index] === '-' && sql[index + 1] === '-') { while (index < to && sql[index] !== '\n') index++ }
    else if (sql[index] === '/' && sql[index + 1] === '*') {
      let depth = 1
      index += 2
      while (index < to && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') { depth++; index += 2 } else if (sql[index] === '*' && sql[index + 1] === '/') { depth--; index += 2 } else index++
      }
    } else break
  }
  return index
}

/** The statements of a script, in order, with their positions. Comment-only fragments are dropped. */
export function splitStatements(sql: string): StatementSpan[] {
  const out: StatementSpan[] = []
  const state = newCursor()
  let from = 0
  const close = (to: number): void => {
    if (!hasCode(sql, from, to)) { from = to + 1; return }
    const start = skipTrivia(sql, from, to)
    let end = to
    while (end > start && /\s/.test(sql[end - 1])) end--
    out.push({ start, end, text: sql.slice(start, end) })
    from = to + 1
  }
  for (let index = 0; index < sql.length;) {
    const wasCode = state.mode === 'code'
    if (wasCode && sql[index] === ';') { close(index); index++; continue }
    index = step(sql, index, state)
  }
  close(sql.length)
  return out
}

/**
 * The statement the cursor belongs to. On whitespace between statements, or right after a `;`,
 * it is the one before (what people expect when they press Run at the end of a line).
 */
export function statementAt(sql: string, offset: number): StatementSpan | null {
  const spans = splitStatements(sql)
  if (spans.length === 0) return null
  const inside = spans.find(span => offset >= span.start && offset <= span.end)
  if (inside) return inside
  const before = [...spans].reverse().find(span => span.end <= offset)
  return before ?? spans[0]
}

export interface ParameterScan {
  /** `named`: `:name`; `positional`: `$1`; a statement uses one kind. */
  kind: 'none' | 'named' | 'positional'
  /** Distinct names (`['id', 'since']`) or numbers as text (`['1', '2']`), in order of first use. */
  names: string[]
}

/** Finds `:name` (not `::cast`) and `$1` outside comments, strings and dollar-quoted bodies. */
export function scanParameters(sql: string): ParameterScan {
  const named: string[] = []
  const positional: string[] = []
  const state = newCursor()
  for (let index = 0; index < sql.length;) {
    if (state.mode === 'code') {
      const char = sql[index]
      if (char === ':' && sql[index + 1] !== ':' && sql[index - 1] !== ':') {
        const match = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(index, index + 80))
        // `a[1:2]` slices and `x ::int` casts are not parameters; a name needs a non-word character before it.
        if (match && !/[A-Za-z0-9_\])]/.test(sql[index - 1] ?? ' ')) { if (!named.includes(match[1])) named.push(match[1]); index += match[0].length; continue }
      }
      if (char === '$' && /[1-9]/.test(sql[index + 1] ?? '') && !/[A-Za-z0-9_$]/.test(sql[index - 1] ?? ' ')) {
        const match = /^\$([1-9][0-9]{0,2})(?![A-Za-z0-9_$])/.exec(sql.slice(index, index + 8))
        if (match) { if (!positional.includes(match[1])) positional.push(match[1]); index += match[0].length; continue }
      }
    }
    index = step(sql, index, state)
  }
  if (positional.length) return { kind: 'positional', names: positional.sort((a, b) => Number(a) - Number(b)) }
  if (named.length) return { kind: 'named', names: named }
  return { kind: 'none', names: [] }
}

/** Rewrites `:name` to `$1`, `$2`… (same name, same number) and returns the order of the names. */
export function namedToPositional(sql: string): { sql: string; names: string[] } {
  const names: string[] = []
  let out = ''
  const state = newCursor()
  for (let index = 0; index < sql.length;) {
    if (state.mode === 'code' && sql[index] === ':' && sql[index + 1] !== ':' && sql[index - 1] !== ':') {
      const match = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(index, index + 80))
      if (match && !/[A-Za-z0-9_\])]/.test(sql[index - 1] ?? ' ')) {
        let position = names.indexOf(match[1])
        if (position < 0) { names.push(match[1]); position = names.length - 1 }
        out += `$${position + 1}`
        index += match[0].length
        continue
      }
    }
    const next = step(sql, index, state)
    out += sql.slice(index, next)
    index = next
  }
  return { sql: out, names }
}

/** Whether the statement has a top-level ORDER BY, so paging it by OFFSET is deterministic. */
export function hasTopLevelOrderBy(sql: string): boolean {
  const state = newCursor()
  let depth = 0
  let word = ''
  let previous = ''
  for (let index = 0; index < sql.length;) {
    const before = state.mode
    const char = sql[index]
    const advanced = step(sql, index, state)
    if (before === 'code' && state.mode === 'code') {
      if (char === '(') depth++
      else if (char === ')') depth = Math.max(0, depth - 1)
      if (/[A-Za-z_]/.test(char)) word += char.toUpperCase()
      else {
        if (word && depth === 0 && previous === 'ORDER' && word === 'BY') return true
        if (word) previous = word
        word = ''
      }
    }
    index = advanced
  }
  return word === 'BY' && previous === 'ORDER' && depth === 0
}
