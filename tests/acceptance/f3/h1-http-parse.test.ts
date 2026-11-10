// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1): reading the HTTP calls out of an agent's shell
// command, keeping only what is safe to store. Written by the planner; the executor must not edit it.
// @vitest-environment node
import { beforeAll, describe, expect, test } from 'vitest'
import { warmShellParser } from '../../../electron/main/services/conversation/shell-parse'
import { parseHttpCalls, pathTemplate, statusFromOutput } from '../../../electron/main/services/http-audit/parse'

beforeAll(async () => { expect(await warmShellParser()).toBe(true) })

describe('A59 · HTTP calls read from a shell command', () => {
  test('A59: curl keeps method, host, port, a path template, query keys and header names, and no secret value', () => {
    const calls = parseHttpCalls(`curl -s -X POST 'https://api.example.com/v1/users/123/orders?page=2&token=abc123' -H 'Authorization: Bearer xyz789' -H 'X-Trace: 1' -d '{"a":1}'`)
    expect(calls).toEqual([{
      tool: 'curl', method: 'POST', scheme: 'https', host: 'api.example.com', port: 443, path: '/v1/users/:id/orders',
      queryKeys: ['page', 'token'], headerNames: ['•••• (Authorization)', 'X-Trace'], hasBody: true, bodyBytes: 7,
      insecure: false, plainHttpExternal: false
    }])
    const json = JSON.stringify(calls)
    for (const secret of ['abc123', 'xyz789', 'Bearer', '{"a":1}']) expect(json, secret).not.toContain(secret)
  })

  test('A59: -k and plain http to an outside host are flagged; localhost is not', () => {
    expect(parseHttpCalls('curl -k http://example.org/a')).toMatchObject([{ method: 'GET', scheme: 'http', port: 80, insecure: true, plainHttpExternal: true }])
    expect(parseHttpCalls('curl http://localhost:3000/health')).toMatchObject([{ host: 'localhost', port: 3000, insecure: false, plainHttpExternal: false }])
    expect(parseHttpCalls('curl http://127.0.0.1:8080/x')).toMatchObject([{ plainHttpExternal: false }])
  })

  test('A59: wget, HTTPie and xh are read too', () => {
    expect(parseHttpCalls('wget -O- https://files.test/archive.tar')).toMatchObject([{ tool: 'wget', method: 'GET', host: 'files.test', path: '/archive.tar' }])
    expect(parseHttpCalls('http POST https://api.test/items name=widget')).toMatchObject([{ tool: 'httpie', method: 'POST', hasBody: true }])
    expect(parseHttpCalls('xh get https://api.test/a/550e8400-e29b-41d4-a716-446655440000')).toMatchObject([{ tool: 'xh', method: 'GET', path: '/a/:id' }])
  })

  test('A59: every HTTP call in a compound line, in order, and nothing for other commands', () => {
    const calls = parseHttpCalls('git status && curl https://a.test/one | jq . && curl -X DELETE https://b.test/two/9')
    expect(calls.map(call => [call.host, call.method, call.path])).toEqual([['a.test', 'GET', '/one'], ['b.test', 'DELETE', '/two/:id']])
    expect(parseHttpCalls('ls -la && npm test')).toEqual([])
    expect(parseHttpCalls('')).toEqual([])
  })

  test('A59: PowerShell Invoke-RestMethod and Invoke-WebRequest, with header values never kept', () => {
    const calls = parseHttpCalls(`Invoke-RestMethod -Uri https://api.test/v1/x -Method Post -Headers @{Authorization='Bearer zzz111'} -Body '{}'`, 'powershell')
    expect(calls).toMatchObject([{ tool: 'Invoke-RestMethod', method: 'POST', host: 'api.test', path: '/v1/x', headerNames: ['•••• (Authorization)'], hasBody: true }])
    expect(JSON.stringify(calls)).not.toContain('zzz111')
    expect(parseHttpCalls('Invoke-WebRequest https://api.test/ping', 'powershell')).toMatchObject([{ tool: 'Invoke-WebRequest', method: 'GET', host: 'api.test' }])
  })

  test('A59: ids in a path become :id (numbers, UUIDs, long hex), words stay', () => {
    expect(pathTemplate('/v1/charges/ch_3Ox/refunds/42')).toBe('/v1/charges/ch_3Ox/refunds/:id')
    expect(pathTemplate('/u/550e8400-e29b-41d4-a716-446655440000/files')).toBe('/u/:id/files')
    expect(pathTemplate('/blobs/0123456789abcdef0123456789abcdef')).toBe('/blobs/:id')
    expect(pathTemplate('/')).toBe('/')
  })

  test('A59: the status comes from an HTTP/x status line or a -w %{http_code} tail, otherwise null', () => {
    expect(statusFromOutput('HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\n\r\nnope')).toBe(404)
    expect(statusFromOutput('HTTP/2 201\r\n')).toBe(201)
    expect(statusFromOutput('{"ok":true}200')).toBe(200)
    expect(statusFromOutput('{"ok":true}')).toBeNull()
    expect(statusFromOutput('')).toBeNull()
  })
})
