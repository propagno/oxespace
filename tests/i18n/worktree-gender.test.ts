// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-186, CA-1 to CA-3; A1–A3). Written by the planner; the executor
// must not edit it. ref/glossary.md §3: "a worktree", feminine, in every pt-BR catalog. OXE-262 fixed code.json's
// worktree.* keys (tests/i18n/worktrees-glossary.test.ts); on main f65fa5374 main.json still says "o worktree",
// "um worktree", "Este worktree", "Worktree criado", "Worktree removido", "worktree novo" (messages.worktree.*).
// Contract: every string of every shared/locales/pt-BR/*.json file (a new file is covered too) uses feminine determiners
// and adjectives with "worktree"/"worktrees". The technical literals stay: "worktree.copyFiles" (a config key, followed
// by a dot) and "git worktree" are not the Portuguese noun. Whole sentences agree (RN-1), not just the article: the
// HML daily review reads them; this file pins what a pattern can prove. No key is renamed and no {{placeholder}} changes.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DIR = join(process.cwd(), 'shared/locales')
type Flat = Map<string, string>
function flatten(value: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (typeof value === 'string') out.set(prefix, value)
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, out)
  return out
}
const files = readdirSync(join(DIR, 'pt-BR')).filter(name => name.endsWith('.json')).sort()
const catalog = (lang: string, file: string): Flat => flatten(JSON.parse(readFileSync(join(DIR, lang, file), 'utf8')))

/** Masculine article, contraction, demonstrative or pronoun before the noun (not before the "worktree.copyFiles" key). */
const DETERMINER = /(?<![\p{L}\p{N}_.])(?:o|os|um|uns|do|dos|no|nos|ao|aos|pelo|pelos|este|estes|esse|esses|aquele|aqueles|deste|desse|daquele|neste|nesse|naquele|outro|outros|novo|novos|nenhum|seu|seus|próprio|próprios)\s+worktrees?(?![\p{L}\p{N}_])(?!\.[\p{L}])/giu
/** Masculine adjective or participle right after the noun. */
const ADJECTIVE = /(?<![\p{L}\p{N}_.])worktrees?\s+(?:limpos?|próprios?|selecionados?|criados?|removidos?|isolados?|novos?|desconhecidos?|bloqueados?|usados?)(?![\p{L}\p{N}_])/giu

function offenders(pattern: RegExp): string[] {
  const found: string[] = []
  for (const file of files) for (const [key, text] of catalog('pt-BR', file)) {
    for (const match of text.matchAll(pattern)) found.push(`${file} ${key}: «${match[0]}» in "${text}"`)
  }
  return found
}
const placeholders = (text: string): string[] => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]).sort()

describe('OXE-186 · "a worktree" in every pt-BR catalog', () => {
  test('pt-BR catalogs use feminine determiners for worktree and worktrees', () => {
    expect(files.length).toBeGreaterThan(4)
    expect(offenders(DETERMINER)).toEqual([])
    // The technical literals stay as they are: a config key and a git command are not the noun.
    expect('Padrões do worktree.copyFiles recusados').not.toMatch(DETERMINER)
    expect('Use git worktree list').not.toMatch(DETERMINER)
  })

  test('pt-BR catalogs use feminine adjectives and participles with worktree', () => {
    expect(offenders(ADJECTIVE)).toEqual([])
    // The creation and removal notices of the main process (shared/locales/pt-BR/main.json, messages.worktree.*).
    const main = catalog('pt-BR', 'main.json')
    expect(main.get('messages.worktree.created')).toMatch(/^Worktree criada\b/)
    expect(main.get('messages.worktree.createdFrom')).toMatch(/^Worktree criada\b/)
    expect(main.get('messages.worktree.removed')).toMatch(/^Worktree removida\b/)
  })

  test('pt-BR catalogs preserve keys and placeholders after feminine worktree rewrite', () => {
    const drift: string[] = []
    for (const file of files) {
      const en = catalog('en', file)
      for (const [key, text] of catalog('pt-BR', file)) {
        if (!/worktree/i.test(text)) continue
        // A plural form only pt-BR has (i18next "_many") compares with the English "_other".
        const english = en.get(key) ?? (/_(?:zero|one|two|few|many)$/.test(key) ? en.get(key.replace(/_[a-z]+$/, '_other')) : undefined)
        if (english === undefined) { drift.push(`${file} ${key}: no en key`); continue }
        if (placeholders(text).join(',') !== placeholders(english).join(',')) drift.push(`${file} ${key}: {{${placeholders(text)}}} vs en {{${placeholders(english)}}}`)
      }
    }
    expect(drift).toEqual([])
    // The keys the main process formats keep their names (electron/main/services/github/repository.service.ts).
    const main = catalog('pt-BR', 'main.json')
    for (const key of ['messages.worktree.created', 'messages.worktree.createdFrom', 'messages.worktree.removed', 'messages.worktree.remove.busy', 'messages.worktree.copyFiles.notIgnored']) expect(main.has(key), key).toBe(true)
  })
})
