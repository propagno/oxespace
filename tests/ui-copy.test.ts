import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Interface text has two homes. Code is written in English; Portuguese lives
 * only in the translation catalogs (shared/locales/pt-BR/*.json), which these
 * rules never scan. In the areas already migrated to the catalogs, the code
 * holds no interface text at all: it calls t().
 */
const ROOT = join(__dirname, '..')
/** Reading every source file is slow on a busy machine; the default 5 s timeout is for unit tests. */
const SCAN_TIMEOUT = 60_000

const EXEMPT_LINES: Array<{ file: string; includes: string; why: string }> = [
  { file: 'src/components/Settings/AppearanceSettings.tsx', includes: 'Sertão', why: 'brand name of a color palette' },
  { file: 'src/utils/threadQuickReplies.ts', includes: '', why: 'bilingual regex that recognises replies in Portuguese' },
  { file: 'electron/main/services/voice.service.ts', includes: 'PT_BR_PROMPT', why: 'transcription prompt for Brazilian Portuguese speech' },
  { file: 'electron/main/services/semantic-retrieval.ts', includes: 'EXHAUSTIVE_INTENT', why: 'multilingual intent regex' }
]

/**
 * Folders and files whose interface text comes from the catalogs. This list
 * only grows: each migration PR adds its area.
 */
const MIGRATED = [
  'src/components/Keyboard',
  'src/components/Navigation',
  'src/components/Onboarding/AgentCliOnboarding.tsx',
  'src/components/OxeQuery',
  'src/components/OxePod',
  'src/components/OxePost',
  'src/components/Settings',
  'src/components/Threads'
]
/** Text that stays the same in every language: product and tool names. */
const UNTRANSLATED = new Set(['Code', 'Thread', 'OxeQuery', 'OxePod', 'OxePost', 'cURL', 'OpenAPI 3', 'OXESpace', 'Claude Code', 'Codex', 'Electron', 'Node', 'RTK', 'Caveman', 'CodeGraph', 'claude.ai'])

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/
const WORDS = /\b(?:Tentar novamente|Carregando|Salvando|Excluir|Fechar|Cancelar|Nenhum[a]?|Selecione|Buscar|Dividir|Abrir|Voltar|Falha ao|Erro ao|Algo falhou)\b/
const LITERAL = /'([^'\n]{4,})'|"([^"\n]{4,})"|`([^`\n]{4,})`|>([^<>{}\n]{4,})</g
/** Interface text written in code: JSX text, naming attributes and the label-like fields of objects. */
const UI_LITERAL = [
  // JSX text; an arrow's `>` (`=> Promise<T>`) starts a type, not text.
  /(?<!=)>([^<>{}()=;&|\n]*[A-Za-z]{2,}[^<>{}()=;&|\n]*)</g,
  /\s(?:aria-label|title|placeholder|alt|label|hint|description)=(?:"([^"]*[A-Za-z][^"]*)"|\{['`]([^'`]*[A-Za-z][^'`]*)['`]\})/g,
  /\b(?:label|title|hint|description|placeholder|message|detail|ariaLabel)\s*:\s*['"`]([^'"`]*[A-Za-z][^'"`]*)['"`]/g
]

function sources(dir: string): string[] {
  if (!statSync(dir).isDirectory()) return [dir]
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (/node_modules|vendor|migrations|tokens$|\.test\./.test(path)) return []
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

/** Each code line of the files under `dirs`, without comments, as [file, line number, text]. */
function codeLines(dirs: string[]): Array<[string, number, string]> {
  return dirs.flatMap(dir => sources(join(ROOT, dir))).flatMap(path => {
    const file = relative(ROOT, path).split('\\').join('/')
    return readFileSync(path, 'utf8').split(/\r?\n/).map((line, index): [string, number, string] => [file, index + 1, line])
      .filter(([, , line]) => !/^(\/\/|\*|\/\*)/.test(line.trim()))
  })
}

describe('interface copy', () => {
  it('is English in code; Portuguese lives in the catalogs', () => {
    const found: string[] = []
    for (const [file, number, line] of codeLines(['src', 'electron', 'shared'])) {
      if (EXEMPT_LINES.some(item => item.file === file && line.includes(item.includes))) continue
      for (const match of line.matchAll(LITERAL)) {
        const text = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
        if (ACCENT.test(text) || WORDS.test(text)) found.push(`${file}:${number} ${text.slice(0, 80)}`)
      }
    }
    expect(found).toEqual([])
  }, SCAN_TIMEOUT)

  it('comes from the catalogs in the migrated areas', () => {
    for (const path of MIGRATED) expect(existsSync(join(ROOT, path)), path).toBe(true)
    const found: string[] = []
    for (const [file, number, line] of codeLines(MIGRATED)) {
      for (const pattern of UI_LITERAL) {
        for (const match of line.matchAll(pattern)) {
          const text = (match[1] ?? match[2] ?? '').trim()
          // A template made only of ${…} values holds no words of its own; text that starts with `:` `,` or `?` is a
          // ternary between two elements or the next argument after a generic type (`Set<string>, b: Set<`), not JSX text.
          if (/[A-Za-z]/.test(text.replace(/\$\{[^}]*\}/g, '')) && !/^[:,?]/.test(text) && !UNTRANSLATED.has(text)) found.push(`${file}:${number} ${text.slice(0, 80)}`)
        }
      }
    }
    expect(found).toEqual([])
  }, SCAN_TIMEOUT)
})
