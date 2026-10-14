import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The interface is English only. This fails on Portuguese accents or common
 * Portuguese words inside the strings that reach the screen. Deliberate
 * exceptions are listed here with the reason.
 */
const ROOT = join(__dirname, '..')

const EXEMPT_LINES: Array<{ file: string; includes: string; why: string }> = [
  { file: 'src/components/Settings/AppearanceSettings.tsx', includes: 'Sertão', why: 'brand name of a color palette' },
  { file: 'src/utils/threadQuickReplies.ts', includes: '', why: 'bilingual regex that recognises replies in Portuguese' },
  { file: 'electron/main/services/voice.service.ts', includes: 'PT_BR_PROMPT', why: 'transcription prompt for Brazilian Portuguese speech' },
  { file: 'electron/main/services/semantic-retrieval.ts', includes: 'EXHAUSTIVE_INTENT', why: 'multilingual intent regex' }
]

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/
const WORDS = /\b(?:Tentar novamente|Carregando|Salvando|Excluir|Fechar|Cancelar|Nenhum[a]?|Selecione|Buscar|Dividir|Abrir|Voltar|Falha ao|Erro ao|Algo falhou)\b/
const LITERAL = /'([^'\n]{4,})'|"([^"\n]{4,})"|`([^`\n]{4,})`|>([^<>{}\n]{4,})</g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (/node_modules|vendor|migrations|tokens$|\.test\./.test(path)) return []
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

describe('interface copy', () => {
  it('is English only', () => {
    const found: string[] = []
    for (const dir of ['src', 'electron', 'shared']) {
      for (const path of sources(join(ROOT, dir))) {
        const file = relative(ROOT, path).split('\\').join('/')
        readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
          const trimmed = line.trim()
          if (/^(\/\/|\*|\/\*)/.test(trimmed)) return
          if (EXEMPT_LINES.some(item => item.file === file && line.includes(item.includes))) return
          for (const match of line.matchAll(LITERAL)) {
            const text = match[1] ?? match[2] ?? match[3] ?? match[4] ?? ''
            if (ACCENT.test(text) || WORDS.test(text)) found.push(`${file}:${index + 1} ${text.slice(0, 80)}`)
          }
        })
      }
    }
    expect(found).toEqual([])
  })
})
