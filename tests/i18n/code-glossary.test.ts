// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-253, PC-04·6, CA-1 to CA-3).
// Contract: shared/locales/pt-BR/code.json uses "Começar do zero" (never "Reiniciar do zero"),
// has no all-caps "WORKSPACE", uses "configurações" (never "preferências"), and treats "branch"
// and "worktree" as feminine (a, uma, nova, etc.).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

type Tree = Record<string, unknown>

const readCatalog = (rel: string): Tree =>
  JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as Tree

const leaves = (node: unknown, prefix = ''): Array<[string, string]> =>
  node && typeof node === 'object'
    ? Object.entries(node as Tree).flatMap(([key, child]) => leaves(child, `${prefix}${key}.`))
    : [[prefix.slice(0, -1), String(node)]]

const ptBRTree = readCatalog('shared/locales/pt-BR/code.json')
const ptBR = leaves(ptBRTree)

function cat(key: string): string {
  let node: unknown = ptBRTree
  for (const part of key.split('.')) {
    node = (node as Tree | undefined)?.[part]
  }
  if (typeof node !== 'string') {
    throw new Error(`pt-BR code.json has no string key ${key}`)
  }
  return node
}

describe('PC-04·6 · pt-BR code.json follows the glossary', () => {
  test('pt-BR code.json says Começar do zero and never Reiniciar do zero', () => {
    const violations = ptBR
      .filter(([, text]) => /reiniciar do zero/i.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(violations).toEqual([])
    expect(cat('slash.new.hint')).toBe('Começar do zero')
    expect(cat('agentResume.startFresh')).toBe('Começar do zero')
  })

  test('pt-BR code.json has no all-caps WORKSPACE and says configurações, never preferências', () => {
    const allCapsWorkspace = ptBR
      .filter(([, text]) => /\bWORKSPACE\b/.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(allCapsWorkspace).toEqual([])
    expect(cat('workspace.settings.navLabel')).toBe('Workspace')

    const preferences = ptBR
      .filter(([, text]) => /prefer[êe]ncia/i.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(preferences).toEqual([])
    expect(cat('workspace.settings.pages.general.hint')).toMatch(/configurações/i)
    expect(cat('workspace.settings.pages.general.description')).toMatch(/configurações/i)
    expect(cat('workspace.settings.usingGlobal')).toMatch(/configurações/i)
  })

  test('pt-BR code.json treats branch and worktree as feminine (a, uma, nova)', () => {
    const masculineArticleBefore =
      /\b(o|os|um|uns|novo|novos|outro|outros|neste|nestes|no|nos|do|dos|este|estes|esse|esses|aquele|aqueles|nenhum|pelo|pelos)\s+(branch|branches|worktree|worktrees)\b/i
    const masculineAdjAfter =
      /\b(branch|branches|worktree|worktrees)\s+(desconhecido|desconhecidos|selecionado|selecionados|removido|removidos|novo|novos|próprio|próprios|limpo|limpos|criado|criados|bloqueado|bloqueados)\b/i

    const violations = ptBR
      .filter(([, text]) => masculineArticleBefore.test(text) || masculineAdjAfter.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(violations).toEqual([])

    expect(cat('delegate.strategies.create')).toBe('Nova branch')
    expect(cat('delegate.checkoutHint')).toMatch(/\ba branch da worktree\b/i)
    expect(cat('delegate.thisProject')).toMatch(/\bnova worktree\b/i)
    expect(cat('worktree.create.open')).toBe('Nova worktree')
    expect(cat('worktree.none')).toBe('Nenhuma worktree')
  })
})
