import { describe, expect, it } from 'vitest'
import { RENDERER_RELOAD_LIMIT, RENDERER_RELOAD_WINDOW_MS, RendererRecoveryPolicy } from '../../electron/main/renderer-recovery'

describe('RendererRecoveryPolicy', () => {
  it('reloads after a crash and ignores an intentional exit or an external kill', () => {
    const policy = new RendererRecoveryPolicy()
    expect(policy.decide('clean-exit', 0)).toBe('ignore')
    expect(policy.decide('killed', 0)).toBe('ignore')
    expect(policy.decide('crashed', 0)).toBe('reload')
    expect(policy.decide('oom', 1)).toBe('reload')
  })

  it('stops reloading a renderer that keeps dying and tries again once the window has passed', () => {
    const policy = new RendererRecoveryPolicy()
    for (let index = 0; index < RENDERER_RELOAD_LIMIT; index++) expect(policy.decide('crashed', index)).toBe('reload')
    expect(policy.decide('crashed', 10)).toBe('give-up')
    expect(policy.decide('crashed', RENDERER_RELOAD_WINDOW_MS + 5)).toBe('reload')
  })
})
