import { describe, expect, test } from 'vitest'
import ptCode from '../../shared/locales/pt-BR/code.json'

function flattenStrings(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flattenStrings(v, prefix ? `${prefix}.${k}` : k)
  )
}

describe('OXE-262 · PP-05.6 Worktrees pt-BR glossary ("Excluir" and feminine "a worktree")', () => {
  test('pt-BR worktree.panel keys use Excluir instead of Apagar when deleting a branch', () => {
    const panel = ptCode.worktree.panel
    expect(panel.deleteBranch).toBe('Excluir também a branch {{branch}}')
    expect(panel.removedDeleted).toBe('Worktree removida; branch excluída.')
    expect(panel.removeBody).toContain('exclua a branch')
    expect(panel.removeBody).not.toMatch(/apague a branch/i)
    expect(panel.removedNotDeleted).toContain('excluir a branch')
    expect(panel.removedNotDeleted).not.toMatch(/apagar a branch/i)
  })

  test('pt-BR worktree.* keys use feminine gender and agreement for worktree', () => {
    const entries = flattenStrings(ptCode.worktree, 'worktree')
    expect(entries.length).toBeGreaterThan(0)

    const masculineWorktreePattern =
      /\b(?:o|os|um|uns|do|dos|no|nos|este|estes|esse|esses|aquele|aqueles|outro|outros|nenhum|novo|novos|neste|nestes)\s+worktrees?\b|\bworktrees?\s+(?:desconhecido|selecionados?|removidos?|criado|removido)\b/i

    for (const [key, text] of entries) {
      expect(text, `${key} should use feminine gender for worktree`).not.toMatch(masculineWorktreePattern)
      expect(text, `${key} should not use masculine enclitic removê-lo(s)`).not.toMatch(/\bremovê-los?\b/i)
    }

    expect(ptCode.worktree.onlyMain).toContain('Crie uma abaixo')
    expect(ptCode.worktree.tag.locked).toBe('bloqueada')
    expect(ptCode.worktree.hooks.waiting.setup).toContain('worktree é criada')
    expect(ptCode.worktree.hooks.waiting.archive).toContain('worktree ser removida')
    expect(ptCode.worktree.removeError.main).toBe('Esta é a worktree principal; ela não pode ser removida pelo app.')
    expect(ptCode.worktree.cleanup.none).toBe('Nenhuma worktree além da principal.')
    expect(ptCode.worktree.cleanup.removed_many).toBe('{{count}} worktrees removidas.')
    expect(ptCode.worktree.cleanup.partly_one).toBe('{{removed}} removidas; {{count}} recusada:')
    expect(ptCode.worktree.cleanup.partly_many).toBe('{{removed}} removidas; {{count}} recusadas:')
    expect(ptCode.worktree.cleanup.remove_one).toBe('Remover {{count}} selecionada')
    expect(ptCode.worktree.cleanup.remove_many).toBe('Remover {{count}} selecionadas')
    expect(ptCode.worktree.panel.locked).toBe('Bloqueada')
    expect(ptCode.worktree.panel.lockedReason).toBe('O git está com ela bloqueada. Desbloqueie antes.')
    expect(ptCode.worktree.panel.removeBody).toContain('A pasta dela')
  })
})
