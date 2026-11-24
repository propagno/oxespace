// OXE-372 (#1031, the UI part left): in DelegationCreateDialog the Select and the inputs keep the Field primitive's own
// padding (the Select's room for its chevron), only the textareas pad themselves, and the context row's four fields sit
// in four columns, two by two at 750 px and one under the other at 520 px.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(process.cwd(), 'src/components/Delegation/DelegationCreateDialog.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const TSX = readFileSync(join(process.cwd(), 'src/components/Delegation/DelegationCreateDialog.tsx'), 'utf8')

type Rule = { selector: string; body: string; media: string | null }
/** Plain rules, each with the @media it sits in (the @layer wrapper is not a condition). */
function rules(css: string): Rule[] {
  const out: Rule[] = []
  const walk = (text: string, media: string | null): void => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) return
      const head = text.slice(i, open).trim()
      let depth = 1, j = open + 1
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++ }
      const inner = text.slice(open + 1, j - 1)
      if (head.startsWith('@media')) walk(inner, head)
      else if (head.startsWith('@layer')) walk(inner, media)
      else out.push({ selector: head.split(/\n/).pop()!.trim(), body: inner, media })
      i = j
    }
  }
  walk(css, null)
  return out
}
const all = rules(CSS)
const columns = (body: string): string | undefined => /grid-template-columns:\s*([^;]+);?/.exec(body)?.[1]?.trim()
const count = (value: string | undefined): number => {
  if (!value) return 0
  const repeat = /^repeat\((\d+),/.exec(value)
  return repeat ? Number(repeat[1]) : (value.match(/minmax\(/g) ?? []).length
}

describe('OXE-372 · DelegationCreateDialog fields and context row', () => {
  it('CA-1: no rule of the dialog pads an input or a select, so the Field primitive keeps the Select clear of its chevron', () => {
    const padded = all.filter(rule => /\b(?:input|select)\b/.test(rule.selector) && !/:focus|::placeholder/.test(rule.selector) && /(^|[\s;])padding(-[a-z]+)?\s*:/.test(rule.body))
      .filter(rule => !/\.delegation-(?:session-list|strategies|options|memory-option)\b/.test(rule.selector))
    expect(padded.map(rule => rule.selector)).toEqual([])
    const textarea = all.filter(rule => /\.delegation-form-body textarea$/.test(rule.selector))
    expect(textarea.some(rule => /(^|[\s;])padding\s*:\s*var\(--space-2\)/.test(rule.body)), 'the textareas pad themselves with a token').toBe(true)
  })

  it('CA-1: the context row has four fields in four columns, two by two up to 750 px, one column up to 520 px', () => {
    const row = /<div className="delegation-context-row">([\s\S]*?)<\/div>/.exec(TSX)?.[1] ?? ''
    expect((row.match(/<label>/g) ?? []).length).toBe(4)
    const base = all.find(rule => rule.selector === '.delegation-context-row' && rule.media === null)
    expect(count(columns(base?.body ?? ''))).toBe(4)
    const at750 = all.filter(rule => rule.media?.includes('750px') && /\.delegation-context-row/.test(rule.selector))
    expect(at750.map(rule => count(columns(rule.body))).filter(Boolean)).toEqual([2])
    expect(at750.some(rule => /grid-column/.test(rule.body)), 'no field spans the row at 750 px: the four fields are 2 by 2').toBe(false)
    const at520 = all.filter(rule => rule.media?.includes('520px') && /\.delegation-context-row/.test(rule.selector))
    expect(at520.map(rule => count(columns(rule.body))).filter(Boolean)).toEqual([1])
  })
})
