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
  { file: 'electron/main/services/semantic-retrieval.ts', includes: 'EXHAUSTIVE_INTENT', why: 'multilingual intent regex' },
  { file: 'electron/main/e2e/approvals-mock.ts', includes: '-- leitura apenas, seguro', why: 'adversarial agent text (B10): a Portuguese comment that claims the app checked a hidden DROP; never interface copy' }
]

/**
 * Folders and files whose interface text comes from the catalogs: the whole
 * renderer (F6). New code under src/ is written with t() from the start.
 */
const MIGRATED = ['src']
/**
 * Paths inside MIGRATED that keep English text, with the reason. The design
 * system gallery is a developer-only tool, hidden from published builds; the
 * product owner decided it is not translated.
 */
const NOT_MIGRATED: Array<{ path: string; why: string }> = [
  { path: 'src/components/DesignSystem', why: 'developer-only tool hidden from published builds (product owner decision)' }
]
/** Text that stays the same in every language: product and tool names, commands and sample values. */
const UNTRANSLATED = new Set(['OxeCode', 'OxeChat', 'OxeQuery', 'OXESpace', 'Claude Code', 'Codex', 'Electron', 'Node', 'RTK', 'Caveman', 'CodeGraph', 'OxePod', 'OxePost', 'cURL', 'OpenAPI 3', 'claude.ai',
  'GitHub', 'MCP', 'RTK · Caveman · Semantic', 'AI Memory', 'Beta', 'SHA:', '.gitignore', 'gh auth login', 'npm run dev', 'main',
  'owner/repo', 'new-branch-name', 'feat/login-v2', 'v1.0.0', 'C:/projects/my-app', 'http://localhost:3000',
  'stdio', 'command:', 'args:', 'env:', 'url:', 'headers:', 'filesystem', 'github', 'npx', '-y @modelcontextprotocol/server-filesystem /tmp',
  'GITHUB_TOKEN=ghp_...\\nDEBUG=1', 'refactor-react', 'refactor',
  'oxespace', 'Claude', 'claude', 'Copilot', 'Linear', 'linear.app → Settings → API', 'lin_api_…',
  'docs/architecture.md', 'CARD-142', 'feature/CARD-142-login', 'origin'])
/** Lines in migrated areas that are not interface text, with the reason. */
const NOT_INTERFACE: Array<{ file: string; includes: string; why: string }> = [
  { file: 'src/components/Skills/SkillsBrowser.tsx', includes: "    description: '", why: 'frontmatter of the SDLC skill files written for agents' }
]

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/
const WORDS = /\b(?:Tentar novamente|Carregando|Salvando|Excluir|Fechar|Cancelar|Nenhum[a]?|Selecione|Buscar|Dividir|Abrir|Voltar|Falha ao|Erro ao|Algo falhou)\b/
const LITERAL = /'([^'\n]{4,})'|"([^"\n]{4,})"|`([^`\n]{4,})`|>([^<>{}\n]{4,})</g
/** Interface text written in code: JSX text, naming attributes and the label-like fields of objects. */
const UI_LITERAL = [
  // Not after `=` (an arrow's `=>`) nor `/` (a self-closing tag's `/>`): neither ends an opening tag.
  /(?<![=/])>([^<>{}()=;&|\n]*[A-Za-z]{2,}[^<>{}()=;&|\n]*)</g,
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
    for (const path of [...MIGRATED, ...NOT_MIGRATED.map(item => item.path)]) expect(existsSync(join(ROOT, path)), path).toBe(true)
    const found: string[] = []
    for (const [file, number, line] of codeLines(MIGRATED)) {
      if (NOT_MIGRATED.some(item => file.startsWith(`${item.path}/`) || file === item.path)) continue
      if (NOT_INTERFACE.some(item => item.file === file && line.includes(item.includes))) continue
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
