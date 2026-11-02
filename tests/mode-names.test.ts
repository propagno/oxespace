import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KEYBINDINGS, SCOPE_LABELS } from '../src/keyboard/keybindings'
import { bindingLabel } from '../src/keyboard/labels'

/**
 * The modes are named OxeCode and OxeChat on screen (F12), in the family of OxeQuery, OxePod and OxePost, and an
 * OxeChat item is a conversation (conversa), never a "thread". The internal ids (`code`, `thread`), IPC channels,
 * MCP tools and catalog keys keep their names; only the text people read changed.
 *
 * main.json is left out: its strings belong to the main process and are renamed there.
 */
const ROOT = join(__dirname, '..')
const LOCALES = join(ROOT, 'shared', 'locales')
const LANGUAGES = ['en', 'pt-BR'] as const

/** "Thread" as the mode, or as a name for a conversation, in any case. */
const THREAD = /\bthreads?\b/i
/** "Code" as the mode. Claude Code and VS Code are other products; lowercase "code" is source code. */
const CODE = /(?<!Claude |VS )\bCode\b/

/** Values that keep one of the old words on purpose. */
const ALLOWED: Array<{ language: string; file: string; key: string; why: string }> = [
  { language: 'en', file: 'thread.json', key: 'dialogs.branchPlaceholder', why: 'the thread/<date> branch name the main process generates (thread-worktree.ts), shown verbatim' },
  { language: 'pt-BR', file: 'thread.json', key: 'dialogs.branchPlaceholder', why: 'the thread/<data> branch name the main process generates (thread-worktree.ts), shown verbatim' },
  { language: 'en', file: 'thread.json', key: 'markdown.code', why: 'the label of a code block in a message: source code, not the mode (pt-BR says "Código")' },
  { language: 'en', file: 'settings.json', key: 'tools.sourceHint.project', why: 'the oxe.yaml key thread.tools, shown verbatim so the person can find it in the file' },
  { language: 'pt-BR', file: 'settings.json', key: 'tools.sourceHint.project', why: 'a chave thread.tools do oxe.yaml, mostrada como está para a pessoa achá-la no arquivo' }
]

function flatten(value: unknown, prefix = ''): Array<[string, string]> {
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => flatten(inner, prefix ? `${prefix}.${key}` : key))
  return [[prefix, String(value)]]
}

function catalogs(): Array<{ language: string; file: string; key: string; text: string }> {
  return LANGUAGES.flatMap(language => readdirSync(join(LOCALES, language))
    .filter(file => file.endsWith('.json') && file !== 'main.json')
    .flatMap(file => flatten(JSON.parse(readFileSync(join(LOCALES, language, file), 'utf8')))
      .map(([key, text]) => ({ language, file, key, text }))))
}

const allowed = (entry: { language: string; file: string; key: string }): boolean =>
  ALLOWED.some(item => item.language === entry.language && item.file === entry.file && item.key === entry.key)

describe('mode names in the interface copy', () => {
  it('never calls a mode Code or Thread, nor a conversation a thread, in the catalogs', () => {
    const found = catalogs().filter(entry => !allowed(entry) && (THREAD.test(entry.text) || CODE.test(entry.text)))
      .map(entry => `${entry.language}/${entry.file} ${entry.key}: ${entry.text.slice(0, 100)}`)
    expect(found).toEqual([])
  })

  it('keeps every allowlisted value present, so the allowlist cannot go stale', () => {
    const entries = catalogs()
    for (const item of ALLOWED) expect(entries.some(entry => allowed(entry) && entry.language === item.language && entry.key === item.key), `${item.language}/${item.file} ${item.key}`).toBe(true)
  })

  it('names the modes OxeCode and OxeChat in their titles, in both languages', () => {
    for (const language of LANGUAGES) {
      const common = JSON.parse(readFileSync(join(LOCALES, language, 'common.json'), 'utf8')) as { nav: { modeTitle: Record<string, string> } }
      expect(common.nav.modeTitle.code, language).toMatch(/^OxeCode: /)
      expect(common.nav.modeTitle.thread, language).toMatch(/^OxeChat: /)
    }
  })

  it('uses the same names in the mode switch, the View menu, the shortcut guide and the shortcut settings', () => {
    for (const file of ['src/components/Navigation/ModeSwitch.tsx', 'src/components/Navigation/appMenus.ts', 'src/components/Keyboard/ShortcutGuide.tsx']) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      expect(source, file).toContain("'OxeCode'")
      expect(source, file).toContain("'OxeChat'")
      expect(source, file).not.toMatch(/'(?:Code|Thread)'/)
    }
    expect(SCOPE_LABELS.code).toBe('OxeCode')
    expect(SCOPE_LABELS.thread).toBe('OxeChat')
    const labels = KEYBINDINGS.map(binding => bindingLabel(binding)).filter(label => THREAD.test(label) || CODE.test(label))
    expect(labels).toEqual([])
  })

  it('names them the same way in the command palette', () => {
    const dir = join(ROOT, 'src', 'commands')
    const found = readdirSync(dir).filter(file => file.endsWith('.ts')).flatMap(file => readFileSync(join(dir, file), 'utf8').split(/\r?\n/)
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      // Lowercase search keywords ('thread') stay, so people who knew the old name still find the commands.
      .flatMap(line => [...line.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)].map(match => match[1] ?? match[2] ?? ''))
      .filter(text => /\bThreads?\b/.test(text) || CODE.test(text))
      .map(text => `${file}: ${text}`))
    expect(found).toEqual([])
  })
})
