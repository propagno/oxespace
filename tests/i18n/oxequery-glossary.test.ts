// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-224, PQ-07·11, CA-1 to CA-3). Written by the planner;
// the executor must not edit it. Item: oxespace-ux-ag/POLISH-07-oxequery.md #11 and docs/design/glossary.md (§1, §7).
// Contract, over the shared/locales oxequery catalogs: pt-BR never says "gravar" (any form: grava, gravado, gravação…;
// §7 says Salvar) nor "apaga" for a permanent removal (§7 says Excluir); the error titles form.testFailed,
// queryError.title, queryError.code.connect.headline and import.failed follow "Não foi possível …" in pt-BR and say
// "could not" (never "… failed") in en; the technical block is "Detalhes técnicos" / "Technical details" (plural), and
// no text names it in the singular.
import { describe, expect, test } from 'vitest'
// ---- catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pqReadFile } from 'node:fs'
import { join as pqJoin } from 'node:path'

const pqRead = (rel: string): string => pqReadFile(pqJoin(process.cwd(), rel), 'utf8')
const pqCatalogs: Record<string, unknown> = {}
/** The OxeQuery catalog text of a key, so elements are found by the string the person reads. A missing key fails loudly. */
function cat(key: string, vars: Record<string, string | number> = {}, lang: 'en' | 'pt-BR' = 'en'): string {
  pqCatalogs[lang] ??= JSON.parse(pqRead(`shared/locales/${lang}/oxequery.json`))
  let node: unknown = pqCatalogs[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} oxequery catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
type Tree = Record<string, unknown>
const leaves = (node: unknown, prefix = ''): Array<[string, string]> => node && typeof node === 'object'
  ? Object.entries(node as Tree).flatMap(([key, child]) => leaves(child, `${prefix}${key}.`))
  : [[prefix.slice(0, -1), String(node)]]
const ptBR = leaves(JSON.parse(pqRead('shared/locales/pt-BR/oxequery.json')))
const en = leaves(JSON.parse(pqRead('shared/locales/en/oxequery.json')))
const TITLES = ['form.testFailed', 'queryError.title', 'queryError.code.connect.headline', 'import.failed']

describe('PQ-07·11 · the OxeQuery catalogs follow the glossary', () => {
  test('pt-BR never says "gravar" nor "apaga": Salvar and Excluir', () => {
    expect(ptBR.filter(([, text]) => /\bgrav(ar|a|e|ou|ado|ada|ados|adas|ação|ações|ando)\b/i.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([])
    expect(ptBR.filter(([, text]) => /\bapag(a|ar|ado|ada)\b/i.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([])
    expect(cat('collection.dropWarning', { name: 'x' }, 'pt-BR')).toMatch(/\bexclui\b/i)
    expect(cat('server.dropWarning', { name: 'x' }, 'pt-BR')).toMatch(/\bexclui\b/i)
  })

  test('the error titles start with "Não foi possível" in pt-BR and say "could not" in en', () => {
    for (const key of TITLES) {
      expect(cat(key, {}, 'pt-BR'), key).toMatch(/^Não foi possível /)
      expect(cat(key, {}, 'en'), key).toMatch(/\bcould not\b/i)
      expect(cat(key, {}, 'en'), key).not.toMatch(/\bfailed\b/i)
    }
  })

  test('the technical block is "Detalhes técnicos" / "Technical details", never the singular', () => {
    expect(cat('queryError.technical', {}, 'pt-BR')).toBe('Detalhes técnicos')
    expect(cat('queryError.technical', {}, 'en')).toBe('Technical details')
    expect(ptBR.filter(([, text]) => /detalhe técnico\b/i.test(text)).map(([key]) => key)).toEqual([])
    expect(en.filter(([, text]) => /technical detail\b/i.test(text)).map(([key]) => key)).toEqual([])
  })
})
