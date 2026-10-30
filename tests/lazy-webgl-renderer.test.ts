import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'

const created: Array<{ setEnabled: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
vi.mock('../src/components/Terminal/webglRenderer', () => ({
  createWebglRenderer: () => {
    const renderer = { setEnabled: vi.fn(), dispose: vi.fn() }
    created.push(renderer)
    return renderer
  }
}))

const { createLazyWebglRenderer } = await import('../src/components/Terminal/lazyWebglRenderer')
const terminal = {} as Terminal
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('lazy WebGL renderer (F16, off the boot path)', () => {
  beforeEach(() => { created.length = 0 })

  test('loads nothing until a pane is granted WebGL', async () => {
    const lazy = createLazyWebglRenderer(terminal)
    lazy.setEnabled(false)
    await settle()
    expect(created).toHaveLength(0)
  })

  test('applies the last grant once the module arrives, then passes changes straight through', async () => {
    const lazy = createLazyWebglRenderer(terminal)
    lazy.setEnabled(true)
    await settle()
    expect(created).toHaveLength(1)
    expect(created[0].setEnabled).toHaveBeenLastCalledWith(true)
    lazy.setEnabled(false)
    expect(created[0].setEnabled).toHaveBeenLastCalledWith(false)
    lazy.dispose()
    expect(created[0].dispose).toHaveBeenCalledOnce()
  })

  test('a grant withdrawn while loading leaves the pane on the DOM renderer', async () => {
    const lazy = createLazyWebglRenderer(terminal)
    lazy.setEnabled(true)
    lazy.setEnabled(false)
    await settle()
    expect(created).toHaveLength(1)
    expect(created[0].setEnabled).not.toHaveBeenCalled()
  })

  test('a pane closed while loading never creates a renderer', async () => {
    const lazy = createLazyWebglRenderer(terminal)
    lazy.setEnabled(true)
    lazy.dispose()
    await settle()
    expect(created).toHaveLength(0)
  })
})
