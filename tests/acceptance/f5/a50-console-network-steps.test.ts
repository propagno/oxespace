// Frozen acceptance test for 1.5.0 A49 (the step strip and live action) and A50 (OXE program, phase F5), SECURITY: what
// the agent browser shows of its own page. Console rows are masked and cut; network rows carry method, URL with query
// values masked, status, type and time, never a header or a body; step pills name what the agent did, with password
// values masked. Built from CDP-shaped fixtures. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f5-see-agent.md §A50; DESIGN 1.5.0-f5-design.md U5.1.
import { describe, expect, test } from 'vitest'
import { consoleRow, NetworkLog, previewStep } from '../../../electron/main/services/browser-preview/preview-observe'

const SECRET = `sk-ant-${'z'.repeat(40)}`

describe('A50 · the Console drawer', () => {
  test('A50: a console call is one row: level, the masked message, source and line', () => {
    const row = consoleRow({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ type: 'string', value: `Token ${SECRET} rejected` }], stackTrace: { callFrames: [{ url: 'http://localhost:3000/assets/app.js', lineNumber: 41, columnNumber: 3 }] } } })
    expect(row).toEqual({ level: 'error', message: expect.not.stringContaining(SECRET), source: 'http://localhost:3000/assets/app.js', line: 42 })
    expect(row?.message).toContain('rejected')
  })

  test('A50: warnings, logs and Log.entryAdded entries map to their level; a message is cut at 500 characters', () => {
    expect(consoleRow({ method: 'Runtime.consoleAPICalled', params: { type: 'warning', args: [{ type: 'string', value: 'careful' }] } })).toMatchObject({ level: 'warning', message: 'careful' })
    expect(consoleRow({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ type: 'string', value: 'a' }, { type: 'number', value: 2 }] } })).toMatchObject({ level: 'info', message: 'a 2' })
    expect(consoleRow({ method: 'Log.entryAdded', params: { entry: { level: 'error', text: 'Failed to load resource', url: 'http://localhost:3000/x', lineNumber: 0 } } })).toMatchObject({ level: 'error', source: 'http://localhost:3000/x', line: 1 })
    expect(consoleRow({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ type: 'string', value: 'x'.repeat(2000) }] } })?.message.length).toBeLessThanOrEqual(500)
    expect(consoleRow({ method: 'Network.requestWillBeSent', params: {} })).toBeNull()
  })

  test('A50: a source URL loses its query values too', () => {
    const row = consoleRow({ method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ type: 'string', value: 'x' }], stackTrace: { callFrames: [{ url: 'http://localhost:3000/app.js?token=abc123', lineNumber: 0 }] } } })
    expect(row?.source).toBe('http://localhost:3000/app.js?token=•••')
  })
})

describe('A50 · the Network drawer', () => {
  test('A50: a request becomes one row from its three events: method, masked URL, status, type and ms; never headers or bodies', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'r1', timestamp: 10, type: 'Fetch', request: { method: 'POST', url: 'https://api.example.com/v1/charges?customer=cus_123&token=abc', headers: { Authorization: `Bearer ${SECRET}` }, postData: '{"card":"4242"}' } } })
    log.add({ method: 'Network.responseReceived', params: { requestId: 'r1', timestamp: 10.2, type: 'Fetch', response: { status: 201, headers: { 'set-cookie': 'sid=xyz' } } } })
    log.add({ method: 'Network.loadingFinished', params: { requestId: 'r1', timestamp: 10.25 } })
    const rows = log.rows()
    expect(rows).toEqual([{ method: 'POST', url: 'https://api.example.com/v1/charges?customer=•••&token=•••', status: 201, type: 'fetch', ms: 250 }])
    const text = JSON.stringify(rows)
    for (const leak of [SECRET, 'Authorization', '4242', 'sid=xyz', 'cus_123', 'abc']) expect(text, leak).not.toContain(leak)
  })

  test('A50: a failed or still running request has a null status; a user and password in the URL are dropped', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'r2', timestamp: 1, type: 'Document', request: { method: 'GET', url: 'http://dev:pw@localhost:3000/' } } })
    log.add({ method: 'Network.loadingFailed', params: { requestId: 'r2', timestamp: 1.5, errorText: 'net::ERR_CONNECTION_REFUSED' } })
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'r3', timestamp: 2, type: 'Script', request: { method: 'GET', url: 'http://localhost:3000/app.js' } } })
    expect(log.rows()).toEqual([
      { method: 'GET', url: 'http://localhost:3000/', status: null, type: 'document', ms: 500, failed: 'error' },
      { method: 'GET', url: 'http://localhost:3000/app.js', status: null, type: 'script', ms: null }
    ])
  })

  test('A50: the log is bounded: the newest 200 requests stay', () => {
    const log = new NetworkLog()
    for (let index = 0; index < 250; index++) log.add({ method: 'Network.requestWillBeSent', params: { requestId: `r${index}`, timestamp: index, type: 'XHR', request: { method: 'GET', url: `http://localhost:3000/${index}` } } })
    const rows = log.rows()
    expect(rows).toHaveLength(200)
    expect(rows.at(-1)?.url).toBe('http://localhost:3000/249')
  })
})

describe('A49 · the step strip and the live action', () => {
  test('A49: each agent action is a step pill: opened a path, clicked a label, filled a field with its value', () => {
    expect(previewStep({ action: 'navigate', url: 'http://localhost:3000/statements?month=3' })).toEqual({ kind: 'navigate', label: '/statements' })
    expect(previewStep({ action: 'click', target: { label: 'Download CSV', type: 'button' } })).toEqual({ kind: 'click', label: 'Download CSV' })
    expect(previewStep({ action: 'fill', target: { label: 'Month', type: 'text' }, text: 'March' })).toEqual({ kind: 'fill', label: 'Month', value: 'March' })
    expect(previewStep({ action: 'scroll', target: null })).toEqual({ kind: 'scroll', label: null })
  })

  test('A49: a password field\'s value is masked; any other value is redacted and cut', () => {
    expect(previewStep({ action: 'fill', target: { label: 'Password', type: 'password' }, text: 'hunter2' })).toEqual({ kind: 'fill', label: 'Password', value: '••••' })
    const step = previewStep({ action: 'fill', target: { label: 'API key', type: 'text' }, text: SECRET })
    expect(JSON.stringify(step)).not.toContain(SECRET)
    expect((previewStep({ action: 'fill', target: { label: 'Notes', type: 'text' }, text: 'y'.repeat(500) }).value ?? '').length).toBeLessThanOrEqual(80)
  })
})

describe('A50 · SECURITY S5: live traffic payloads are never kept', () => {
  test('S5: a WebSocket is one connection row (masked URL); its frames, sent or received, are never logged', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.webSocketCreated', params: { requestId: 'ws1', url: 'wss://live.example.com/socket?token=abc' } })
    log.add({ method: 'Network.webSocketWillSendHandshakeRequest', params: { requestId: 'ws1', timestamp: 5, request: { headers: { Cookie: 'sid=1' } } } })
    log.add({ method: 'Network.webSocketFrameSent', params: { requestId: 'ws1', timestamp: 6, response: { opcode: 1, payloadData: `{"auth":"${SECRET}"}` } } })
    log.add({ method: 'Network.webSocketFrameReceived', params: { requestId: 'ws1', timestamp: 7, response: { opcode: 1, payloadData: 'PRIVATE-FRAME' } } })
    const rows = log.rows()
    expect(rows).toEqual([{ method: 'GET', url: 'wss://live.example.com/socket?token=•••', status: 101, type: 'websocket', ms: null }])
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE-FRAME|sid=1|abc/)
    expect(JSON.stringify(rows)).not.toContain(SECRET)
  })

  test('S5: EventSource messages and streamed fetch chunks are never logged; only the request row is', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'es1', timestamp: 1, type: 'EventSource', request: { method: 'GET', url: 'http://localhost:3000/events' } } })
    log.add({ method: 'Network.eventSourceMessageReceived', params: { requestId: 'es1', timestamp: 2, eventName: 'message', eventId: '1', data: 'PRIVATE-EVENT' } })
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'f1', timestamp: 3, type: 'Fetch', request: { method: 'POST', url: 'http://localhost:3000/stream' } } })
    log.add({ method: 'Network.dataReceived', params: { requestId: 'f1', timestamp: 4, dataLength: 120, encodedDataLength: 120, data: 'UFJJVkFURS1DSFVOSw==' } })
    const rows = log.rows()
    expect(rows.map(row => [row.type, row.url])).toEqual([['eventsource', 'http://localhost:3000/events'], ['fetch', 'http://localhost:3000/stream']])
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE-EVENT|UFJJVkFURS1DSFVOSw/)
  })
})

describe('A50 · how requests really arrive (HML 711)', () => {
  test('HML-711-3: a redirect reuses the requestId: a 302 → 200 chain is one row per hop, each masked', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'r1', timestamp: 1, type: 'Document', request: { method: 'GET', url: 'http://localhost:3000/login?next=/a' } } })
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'r1', timestamp: 1.1, type: 'Document', request: { method: 'GET', url: 'https://sso.example/authorize?client_id=abc&state=xyz' }, redirectResponse: { status: 302, headers: { Location: 'https://sso.example/authorize?client_id=abc&state=xyz' } } } })
    log.add({ method: 'Network.responseReceived', params: { requestId: 'r1', timestamp: 1.3, type: 'Document', response: { status: 200 } } })
    log.add({ method: 'Network.loadingFinished', params: { requestId: 'r1', timestamp: 1.35 } })
    expect(log.rows()).toEqual([
      { method: 'GET', url: 'http://localhost:3000/login?next=•••', status: 302, type: 'document', ms: 100 },
      { method: 'GET', url: 'https://sso.example/authorize?client_id=•••&state=•••', status: 200, type: 'document', ms: 250 }
    ])
    expect(JSON.stringify(log.rows())).not.toMatch(/xyz|abc|Location/)
  })

  test('HML-711-4: data: and blob: URLs show only their kind, never their content', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'd1', timestamp: 1, type: 'Image', request: { method: 'GET', url: 'data:image/png;base64,iVBORw0KGgoPRIVATE' } } })
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'b1', timestamp: 2, type: 'Fetch', request: { method: 'GET', url: 'blob:http://localhost:3000/4b2e-PRIVATE-uuid' } } })
    expect(log.rows().map(row => row.url)).toEqual(['data:image/png', 'blob:'])
    expect(JSON.stringify(log.rows())).not.toContain('PRIVATE')
  })

  test('HML-711-5: ExtraInfo events add nothing, an unknown requestId is ignored, and a canceled load says canceled', () => {
    const log = new NetworkLog()
    log.add({ method: 'Network.requestWillBeSentExtraInfo', params: { requestId: 'x1', headers: { Cookie: 'sid=SECRET-COOKIE' }, associatedCookies: [] } })
    log.add({ method: 'Network.responseReceivedExtraInfo', params: { requestId: 'x1', headers: { 'set-cookie': 'sid=SECRET-COOKIE' } } })
    expect(() => log.add({ method: 'Network.loadingFinished', params: { requestId: 'never-seen', timestamp: 3 } })).not.toThrow()
    expect(log.rows()).toEqual([])
    log.add({ method: 'Network.requestWillBeSent', params: { requestId: 'c1', timestamp: 1, type: 'XHR', request: { method: 'GET', url: 'http://localhost:3000/slow' } } })
    log.add({ method: 'Network.loadingFailed', params: { requestId: 'c1', timestamp: 1.2, errorText: 'net::ERR_ABORTED', canceled: true } })
    expect(log.rows()).toEqual([{ method: 'GET', url: 'http://localhost:3000/slow', status: null, type: 'xhr', ms: 200, failed: 'canceled' }])
    expect(JSON.stringify(log.rows())).not.toContain('SECRET-COOKIE')
  })
})
