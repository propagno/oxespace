import { beforeEach, describe, expect, test, vi } from 'vitest'

const toast = vi.fn()
vi.mock('../src/ui', () => ({ toast: (input: unknown) => toast(input) }))
const { reportSplitRefused } = await import('../src/components/Grid/splitRefusal')

describe('a refused split (F19)', () => {
  beforeEach(() => { toast.mockClear(); vi.spyOn(console, 'warn').mockImplementation(() => undefined) })

  test('says why, as a warning, instead of failing in silence', () => {
    reportSplitRefused(new Error('Target slot is already occupied'))
    expect(toast).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'This pane cannot be split here',
      description: expect.stringContaining('Choose a larger layout'),
      intent: 'warning'
    }))
  })

  test('never shows the raw English error from the main process', () => {
    reportSplitRefused(new Error('Cannot split vertically: layout limit reached'))
    const shown = JSON.stringify(toast.mock.calls[0][0])
    expect(shown).not.toContain('layout limit reached')
  })
})
