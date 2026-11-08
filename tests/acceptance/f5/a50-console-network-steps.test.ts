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
      { method: 'GET', url: 'http://localhost:3000/', status: null, type: 'document', ms: 500 },
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
