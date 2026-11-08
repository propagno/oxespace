// Frozen acceptance test for 1.5.0 A49 / B1 (OXE program, phase F5), SECURITY: the agent browser's grants. On a loopback
// origin one approval lasts for the preview session (key previewSessionId + origin); on any other origin every action
// asks; navigating from local to external always asks; End revokes at once; a different origin or session asks again.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f5-see-agent.md §A49; DESIGN 1.5.0-f5-design.md U5.1 (Approvals).
import { describe, expect, test, vi } from 'vitest'
import { PreviewGrants } from '../../../electron/main/services/browser-preview/preview-grants'

type Ask = (request: { previewSessionId: string; origin: string; action: string; url: string; scope: 'session' | 'action' }) => Promise<boolean>
function grants(answer: boolean | ((n: number) => boolean) = true, now = () => 1000) {
  let count = 0
  const ask = vi.fn<Ask>(async () => { count++; return typeof answer === 'function' ? answer(count) : answer })
  return { model: new PreviewGrants({ now }), ask }
}

describe('A49 · who may act on the page', () => {
  test('A49: on localhost the first agent action asks once, for the session; the next five do not', async () => {
    const { model, ask } = grants()
    for (let index = 0; index < 6; index++) {
      expect(await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/statements', action: 'click', ask })).toBe(true)
    }
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0][0]).toMatchObject({ previewSessionId: 'ps1', origin: 'http://localhost:3000', scope: 'session' })
    expect(model.list('ps1')).toEqual([{ previewSessionId: 'ps1', origin: 'http://localhost:3000', scope: 'session', grantedAt: 1000 }])
  })

  test('A49: 127.0.0.1 and [::1] are loopback too; each origin (scheme, host, port) is its own grant', async () => {
    const { model, ask } = grants()
    for (const url of ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/b', 'http://[::1]:8080/', 'http://localhost:3001/', 'https://localhost:3001/']) {
      await model.authorize({ previewSessionId: 'ps1', url, action: 'fill', ask })
    }
    expect(ask).toHaveBeenCalledTimes(4)
  })

  test('A49: on any other origin every action asks, one at a time, with scope action; nothing is remembered', async () => {
    const { model, ask } = grants()
    for (let index = 0; index < 3; index++) expect(await model.authorize({ previewSessionId: 'ps1', url: 'https://example.org/a', action: 'click', ask })).toBe(true)
    expect(ask).toHaveBeenCalledTimes(3)
    expect(ask.mock.calls.every(call => call[0].scope === 'action')).toBe(true)
    expect(model.list('ps1')).toEqual([])
  })

  test('A49: lookalikes of loopback are external: localhost.evil.example, 127.0.0.1.nip.io, a credential URL, 0.0.0.0', async () => {
    const { model, ask } = grants()
    for (const url of ['http://localhost.evil.example/', 'http://127.0.0.1.nip.io/', 'http://0.0.0.0:3000/']) {
      await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
      await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
    }
    expect(ask).toHaveBeenCalledTimes(6)
    expect(ask.mock.calls.every(call => call[0].scope === 'action')).toBe(true)
    // A URL with a user and password is refused outright, without asking.
    expect(await model.authorize({ previewSessionId: 'ps1', url: 'http://user:pw@localhost:3000/', action: 'click', ask })).toBe(false)
    expect(ask).toHaveBeenCalledTimes(6)
  })

  test('A49: navigating from a granted local page to an external URL always asks, even inside the session', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(1)
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'navigate', target: 'https://bank.example/login', ask })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1][0]).toMatchObject({ action: 'navigate', scope: 'action', url: 'https://bank.example/login' })
    // A local-to-local navigate inside the granted origin needs nothing more.
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'navigate', target: 'http://localhost:3000/next', ask })
    expect(ask).toHaveBeenCalledTimes(2)
  })

  test('A49: a denial grants nothing: the action is refused and the next one asks again', async () => {
    const { model, ask } = grants(n => n > 1)
    expect(await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })).toBe(false)
    expect(model.list('ps1')).toEqual([])
    expect(await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  test('A49: End revokes at once: the next action asks again; another preview session never shares a grant', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    await model.authorize({ previewSessionId: 'ps2', url: 'http://localhost:3000/', action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(2)
    model.revoke('ps1')
    expect(model.list('ps1')).toEqual([])
    expect(model.list('ps2')).toHaveLength(1)
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(3)
  })

  test('A49: reads (inspect, status, console, network) never ask; schemes other than http(s) are refused', async () => {
    const { model, ask } = grants()
    for (const action of ['inspect', 'status', 'console', 'network']) expect(await model.authorize({ previewSessionId: 'ps1', url: 'https://example.org/', action, ask })).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings']) expect(await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })
})
