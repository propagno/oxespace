/**
 * Formulas in an answer's Markdown. The Markdown parser knows nothing of TeX, and would read `a_1 + b_2` as italics
 * before anything could draw it. So, before the text is parsed, each formula is put where the parser reads nothing:
 * an inline one becomes a code span that starts with a mark, a displayed one becomes a fenced block named `math`.
 * The renderer draws both; the text of the message itself is never changed (Copy copies what the agent wrote).
 *
 * What counts as a formula, as the common Markdown readers have it:
 * - `$…$` on one line, when the opening `$` is followed by a non-space and does not follow a letter, a digit or
 *   another `$`, and the closing `$` follows a non-space and is not followed by a digit. "It costs $5 and $10" is
 *   not a formula.
 * - `\(…\)` on one line.
 * - `$$…$$` and `\[…\]`, on one line or opening and closing on lines of their own.
 * Nothing inside a fenced block or a code span is read, and an escaped `\$` is a dollar sign.
 */

/** What an inline formula's code span starts with: an invisible character, so a mark shown by mistake shows nothing. */
export const MATH_MARK = '⁣math⁣'
const MAX_INLINE = 400
const MAX_BLOCK_LINES = 120

/** The TeX of a code span that `protectMath` wrote, or null for any other code span. */
export function mathOf(codeText: string): string | null {
  return codeText.startsWith(MATH_MARK) ? codeText.slice(MATH_MARK.length) : null
}

const span = (tex: string): string => `\`${MATH_MARK}${tex}\``
const usable = (tex: string): boolean => tex.trim().length > 0 && !tex.includes('`')

/** One line outside any fence: its inline formulas become marked code spans. */
function inlineMath(line: string): string {
  if (!line.includes('$') && !line.includes('\\(')) return line
  let out = ''
  for (let i = 0; i < line.length;) {
    const char = line[i]
    if (char === '`') {
      // A code span: copied as it is, through the run of backticks that closes it (or to the end of the line).
      let run = 1
      while (line[i + run] === '`') run++
      const close = line.indexOf('`'.repeat(run), i + run)
      const end = close < 0 ? line.length : close + run
      out += line.slice(i, end); i = end
      continue
    }
    if (char === '\\') {
      if (line[i + 1] === '(') {
        const close = line.indexOf('\\)', i + 2)
        const tex = close < 0 ? '' : line.slice(i + 2, close).trim()
        if (close >= 0 && tex.length <= MAX_INLINE && usable(tex)) { out += span(tex); i = close + 2; continue }
      }
      // An escaped character, `\$` among them: both characters stay.
      out += line.slice(i, i + 2); i += 2
      continue
    }
    if (char === '$') {
      const before = line[i - 1] ?? ''
      const after = line[i + 1] ?? ''
      if (after && after !== '$' && !/\s/.test(after) && !/[A-Za-z0-9$]/.test(before)) {
        let close = -1
        for (let j = i + 1; j < line.length && j - i <= MAX_INLINE + 1; j++) {
          if (line[j] === '\\') { j++; continue }
          if (line[j] === '`') break
          if (line[j] === '$') { if (!/\s/.test(line[j - 1]) && !/[0-9$]/.test(line[j + 1] ?? '')) close = j; break }
        }
        if (close > i + 1) { out += span(line.slice(i + 1, close)); i = close + 1; continue }
      }
    }
    out += char; i++
  }
  return out
}

/** A displayed formula as a fenced block named `math`, at the indent the formula had (inside a list it stays there). */
function fencedMath(indent: string, tex: string[]): string[] {
  return ['', `${indent}\`\`\`math`, ...tex.map(line => `${indent}${line.trim()}`).filter((line, index, all) => line.trim() || (index > 0 && index < all.length - 1)), `${indent}\`\`\``, '']
}

export function protectMath(source: string): string {
  if (!source.includes('$') && !source.includes('\\(') && !source.includes('\\[')) return source
  const lines = source.split('\n')
  const out: string[] = []
  let fence: { char: string; length: number } | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      out.push(line)
      if (mark && mark[0] === fence.char && mark.length >= fence.length && line.trim() === mark) fence = null
      continue
    }
    if (mark) { fence = { char: mark[0], length: mark.length }; out.push(line); continue }

    const indent = /^\s*/.exec(line)![0]
    const text = line.trim()
    const opener = text.startsWith('$$') ? '$$' : text.startsWith('\\[') ? '\\[' : null
    if (opener) {
      const closer = opener === '$$' ? '$$' : '\\]'
      const rest = text.slice(2)
      // Opened and closed on this line.
      if (rest.length > closer.length - 1 && rest.endsWith(closer) && rest.length >= closer.length) {
        const tex = rest.slice(0, -closer.length)
        if (usable(tex) && !tex.includes(closer)) { out.push(...fencedMath(indent, [tex])); continue }
      } else {
        // Opened here, closed on a line further down: taken only when the closing line is there (an answer still
        // arriving shows what it has, as text, until the formula is whole).
        let end = -1
        for (let j = index + 1; j < lines.length && j - index <= MAX_BLOCK_LINES; j++) {
          if (/^ {0,3}(`{3,}|~{3,})/.test(lines[j])) break
          if (lines[j].trim().endsWith(closer)) { end = j; break }
        }
        if (end > index) {
          const last = lines[end].trim().slice(0, -closer.length)
          const tex = [rest, ...lines.slice(index + 1, end), last]
          if (usable(tex.join('\n'))) { out.push(...fencedMath(indent, tex)); index = end; continue }
        }
      }
    }
    out.push(inlineMath(line))
  }
  return out.join('\n')
}
