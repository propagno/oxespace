// OXE-372 (#1031) & OXE-422: in DelegationCreateDialog all inputs, selects and textareas use src/ui Field primitives
// and keep Field.module.css padding (including the Select's room for its chevron and TextArea's --space-2 padding);
// the context row's four fields sit in four columns, two by two at 750 px and one under the other at 520 px.
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
  it('CA-1: no rule of the dialog overrides padding or border on Field primitives, keeping Select chevron and TextArea spacing intact', () => {
    const padded = all.filter(rule => /\b(?:input|select|textarea)\b/.test(rule.selector) && !/:focus|::placeholder/.test(rule.selector) && /(^|[\s;])padding(-[a-z]+)?\s*:/.test(rule.body))
    expect(padded.map(rule => rule.selector)).toEqual([])
    const bordered = all.filter(rule => /\b(?:input|select|textarea)\b/.test(rule.selector) && /(^|[\s;])border(-color)?\s*:/.test(rule.body))
    expect(bordered.map(rule => rule.selector)).toEqual([])
    expect(TSX).not.toMatch(/<textarea\b/)
    expect((TSX.match(/<TextArea\b/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('CA-1: the context row has four fields in four columns, two by two up to 750 px, one column up to 520 px', () => {
    const row = /<div className="delegation-context-row">([\s\S]*?)<\/div>/.exec(TSX)?.[1] ?? ''
    expect((row.match(/<Select\b/g) ?? []).length).toBe(4)
    const base = all.find(rule => rule.selector === '.delegation-context-row' && rule.media === null)
    expect(count(columns(base?.body ?? ''))).toBe(4)
    const at750 = all.filter(rule => rule.media?.includes('750px') && /\.delegation-context-row/.test(rule.selector))
    expect(at750.map(rule => count(columns(rule.body))).filter(Boolean)).toEqual([2])
    expect(at750.some(rule => /grid-column/.test(rule.body)), 'no field spans the row at 750 px: the four fields are 2 by 2').toBe(false)
    const at520 = all.filter(rule => rule.media?.includes('520px') && /\.delegation-context-row/.test(rule.selector))
    expect(at520.map(rule => count(columns(rule.body))).filter(Boolean)).toEqual([1])
  })
})
