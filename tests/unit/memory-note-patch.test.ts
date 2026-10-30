import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
const { notePatch } = await import('../../electron/main/ipc/memory-manage.ipc')

describe('what a person may change about a memory note', () => {
  test('keeps only the known fields, each of the right type', () => {
    expect(notePatch({ pinned: true, wrong: false, expiresAt: null, scope: 'team', trust: 'trusted', text: 'x', title: 'y', path: '../evil', origin: 'user' }))
      .toEqual({ pinned: true, wrong: false, expiresAt: null, scope: 'team', trust: 'trusted', text: 'x', title: 'y' })
  })
  test.each([
    [undefined], ['pin'], [{ pinned: 'yes' }], [{ expiresAt: 'tomorrow' }], [{ expiresAt: Infinity }], [{ scope: 'world' }], [{ trust: 'untrusted' }], [{ text: 5 }], [{ text: 'x'.repeat(16001) }]
  ])('refuses %j', value => { expect(() => notePatch(value)).toThrow('Invalid memory note change') })
})
