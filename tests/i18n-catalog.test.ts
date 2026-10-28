import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANGUAGES, NAMESPACES, type Language } from '../shared/i18n'

/**
 * English is the source catalog. Every other language has exactly its keys
 * (plural forms aside), the same {{placeholders}}, and a form for each plural
 * category the language uses: i18next shows the raw key when one is missing.
 */
const LOCALES = join(__dirname, '..', 'shared', 'locales')
const PLURAL = /_(zero|one|two|few|many|other)$/

type Catalog = Record<string, unknown>
function read(language: Language, namespace: string): Catalog {
  return JSON.parse(readFileSync(join(LOCALES, language, `${namespace}.json`), 'utf8')) as Catalog
}

function flatten(catalog: Catalog, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') for (const [inner, text] of flatten(value as Catalog, path)) out.set(inner, text)
    else out.set(path, String(value))
  }
  return out
}

const base = (key: string): string => key.replace(PLURAL, '')
const placeholders = (text: string): string[] => [...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map(match => match[1]).sort()

/** Every key without its plural suffix, with the placeholders of each of its forms. */
function shape(entries: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [key, text] of entries) {
    const forms = out.get(base(key)) ?? new Set<string>()
    forms.add(placeholders(text).filter(name => name !== 'count').join(','))
    out.set(base(key), forms)
  }
  return out
}

describe('translation catalogs', () => {
  it('has one file per language and namespace, and nothing else', () => {
    for (const language of LANGUAGES) expect(readdirSync(join(LOCALES, language)).sort()).toEqual(NAMESPACES.map(name => `${name}.json`).sort())
    expect(readdirSync(LOCALES).sort()).toEqual([...LANGUAGES].sort())
  })

  for (const language of LANGUAGES.filter(item => item !== 'en')) {
    for (const namespace of NAMESPACES) {
      it(`${language}/${namespace} matches the English keys and placeholders`, () => {
        const english = shape(flatten(read('en', namespace)))
        const translated = shape(flatten(read(language, namespace)))
        const missing = [...english.keys()].filter(key => !translated.has(key))
        const orphans = [...translated.keys()].filter(key => !english.has(key))
        expect({ missing, orphans }).toEqual({ missing: [], orphans: [] })
        const mismatched = [...english.keys()].filter(key => [...translated.get(key)!].some(forms => !english.get(key)!.has(forms)))
        expect(mismatched).toEqual([])
      })
    }
  }

  for (const language of LANGUAGES) {
    it(`${language} has every plural form the language needs, and no empty text`, () => {
      const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories
      for (const namespace of NAMESPACES) {
        const entries = flatten(read(language, namespace))
        expect([...entries].filter(([, text]) => !text.trim()).map(([key]) => `${namespace}:${key}`)).toEqual([])
        const plurals = new Set([...entries.keys()].filter(key => PLURAL.test(key)).map(base))
        for (const key of plurals) {
          expect(categories.filter(category => !entries.has(`${key}_${category}`)).map(category => `${namespace}:${key}_${category}`)).toEqual([])
        }
      }
    })
  }
})
