import { act, renderHook, waitFor } from '@testing-library/react'
import type { KeyboardEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rankMentionFiles, useFileMentions } from '../../src/components/Threads/useFileMentions'

/**
 * OXE-372 (part 1): in a big repository the ranking stopped after 400 partial matches, so a file whose name is exactly
 * what was typed could be missed; and Escape closed the list only until the next key, because the dismissal was tied
 * to the draft's length.
 */
describe('file mentions in a large repository (OXE-372)', () => {
  const original = window.oxe

  afterEach(() => { window.oxe = original })

  it('finds the exact basename even after hundreds of partial matches', () => {
    const files = [...Array.from({ length: 500 }, (_, index) => `src/generated/legacy-config-${index}.ts`), 'config.ts']
    expect(rankMentionFiles(files, 'config')[0]).toBe('config.ts')
    expect(rankMentionFiles(files, 'config')).toHaveLength(8)
  })

  it('keeps a dismissed list closed while the same mention is typed, and opens it for the next one', async () => {
    window.oxe = { ...original, search: { listFiles: vi.fn().mockResolvedValue({ files: ['src/app.ts', 'src/api.ts'] }) } } as unknown as typeof window.oxe
    const escape = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>
    const { result, rerender } = renderHook(
      ({ draft }: { draft: string }) => useFileMentions({ workspaceId: 'w-large', rootPath: '/repo-large', draft, caret: draft.length, enabled: true, onApply: () => undefined }),
      { initialProps: { draft: '@sr' } }
    )
    await waitFor(() => expect(result.current.popup).not.toBeNull())

    act(() => { result.current.onKeyDown(escape) })
    expect(result.current.popup).toBeNull()
    rerender({ draft: '@src' })
    expect(result.current.popup, 'one more key on the dismissed mention').toBeNull()
    rerender({ draft: '@src/a' })
    expect(result.current.popup, 'still the dismissed mention').toBeNull()

    rerender({ draft: '@src/a then @a' })
    expect(result.current.popup, 'a new mention lists again').not.toBeNull()
  })

  it('reopens the list at the same position after the dismissed mention is deleted', async () => {
    window.oxe = { ...original, search: { listFiles: vi.fn().mockResolvedValue({ files: ['src/app.ts', 'src/api.ts'] }) } } as unknown as typeof window.oxe
    const escape = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>
    const { result, rerender } = renderHook(
      ({ draft }: { draft: string }) => useFileMentions({ workspaceId: 'w-reopen', rootPath: '/repo-reopen', draft, caret: draft.length, enabled: true, onApply: () => undefined }),
      { initialProps: { draft: '@sr' } }
    )
    await waitFor(() => expect(result.current.popup).not.toBeNull())

    act(() => { result.current.onKeyDown(escape) })
    expect(result.current.popup).toBeNull()
    rerender({ draft: '' })
    expect(result.current.popup).toBeNull()
    rerender({ draft: '@a' })
    expect(result.current.popup, 'a fresh mention at index 0 lists again').not.toBeNull()
  })
})
