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

describe('A49 · SECURITY S1, S2, S6 (TECH LEAD on #711)', () => {
  test('S1: a page-driven move from a granted local page to an external origin asks like an agent navigate: a redirect, a meta refresh, a script location', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    for (const cause of ['redirect', 'meta-refresh', 'script'] as const) {
      expect(await model.checkNavigation({ previewSessionId: 'ps1', from: 'http://localhost:3000/', to: 'https://evil.example/', cause, ask })).toBe(true)
    }
    expect(ask).toHaveBeenCalledTimes(4)
    expect(ask.mock.calls.slice(1).every(call => call[0].scope === 'action' && call[0].url === 'https://evil.example/')).toBe(true)
    // A local-to-local redirect in the granted origin asks nothing; a denied external move is refused.
    expect(await model.checkNavigation({ previewSessionId: 'ps1', from: 'http://localhost:3000/', to: 'http://localhost:3000/next', cause: 'redirect', ask })).toBe(true)
    expect(ask).toHaveBeenCalledTimes(4)
    const denied = grants(false)
    expect(await denied.model.checkNavigation({ previewSessionId: 'ps1', from: 'http://localhost:3000/', to: 'https://evil.example/', cause: 'redirect', ask: denied.ask })).toBe(false)
  })

  test('S1: a new window (window.open or target=_blank) is a new preview session: it never inherits the opener\'s grant', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    const child = model.openedFrom('ps1')
    expect(child).not.toBe('ps1')
    expect(model.list(child)).toEqual([])
    await model.authorize({ previewSessionId: child, url: 'http://localhost:3000/', action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(2)
  })

  test('S1: an action inside an external iframe is judged by the frame\'s origin, never by the granted top page', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    for (let index = 0; index < 2; index++) await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', frameUrl: 'https://payments.example/widget', action: 'fill', ask })
    expect(ask).toHaveBeenCalledTimes(3)
    expect(ask.mock.calls.slice(1).every(call => call[0].origin === 'https://payments.example' && call[0].scope === 'action')).toBe(true)
  })

  test('S2: a grant is bound to the session and the exact origin (scheme, host and port), and ends with the session', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    for (const url of ['http://localhost:5173/', 'https://localhost:3000/', 'http://127.0.0.1:3000/']) await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(4)
    await model.authorize({ previewSessionId: 'ps2', url: 'http://localhost:3000/', action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(5)
    model.endSession('ps1')
    expect(model.list('ps1')).toEqual([])
    expect(model.list('ps2')).toHaveLength(1)
  })

  test('S6: every grant answer and End write one audit row, with no URL path, query or page content', async () => {
    const rows: Array<Record<string, unknown>> = []
    const model = new PreviewGrants({ now: () => 1000, audit: { record: entry => { rows.push(entry) } } })
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/secret-path?token=abc', action: 'click', ask: async () => true })
    await model.authorize({ previewSessionId: 'ps1', url: 'https://example.org/a?b=c', action: 'click', ask: async () => false })
    model.revoke('ps1')
    expect(rows).toEqual([
      { action: 'preview-grant', target: 'http://localhost:3000', outcome: 'ok' },
      { action: 'preview-grant', target: 'https://example.org', outcome: 'refused' },
      { action: 'preview-end', target: 'ps1', outcome: 'ok' }
    ])
    expect(JSON.stringify(rows)).not.toMatch(/secret-path|token|abc|b=c/)
  })
})

describe('A49 · HML 711', () => {
  test('HML-711-1: a granted local page that left by itself (a 302 to an SSO, a location set by the page) is judged on its current URL: the next action asks with scope action', async () => {
    const { model, ask } = grants()
    await model.authorize({ previewSessionId: 'ps1', url: 'http://localhost:3000/', action: 'click', ask })
    // The page is now on the SSO; the grant for localhost does not follow it.
    await model.authorize({ previewSessionId: 'ps1', url: 'https://sso.example/login', action: 'fill', ask })
    await model.authorize({ previewSessionId: 'ps1', url: 'https://sso.example/login', action: 'click', ask })
    expect(ask).toHaveBeenCalledTimes(3)
    expect(ask.mock.calls.slice(1).every(call => call[0].scope === 'action' && call[0].origin === 'https://sso.example')).toBe(true)
  })

  test('HML-711-2: the loopback forms, decided: plain localhost, *.localhost, 127/8 and [::1] are a session grant; any other spelling asks every time', async () => {
    const session = ['http://localhost:3000/', 'http://app.localhost:3000/', 'http://127.0.0.1:3000/', 'http://127.0.0.2:3000/', 'http://[::1]:3000/']
    const perAction = ['http://127.1:3000/', 'http://0x7f000001:3000/', 'http://[::ffff:127.0.0.1]:3000/', 'http://LOCALHOST:3000/', 'http://localhost.:3000/']
    for (const url of session) {
      const { model, ask } = grants()
      await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
      await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
      expect(ask, url).toHaveBeenCalledTimes(1)
      expect(ask.mock.calls[0][0].scope, url).toBe('session')
    }
    for (const url of perAction) {
      const { model, ask } = grants()
      await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
      await model.authorize({ previewSessionId: 'ps1', url, action: 'click', ask })
      expect(ask, url).toHaveBeenCalledTimes(2)
      expect(ask.mock.calls.every(call => call[0].scope === 'action'), url).toBe(true)
    }
  })
})
