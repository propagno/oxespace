// @vitest-environment node
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OxePostService } from '../../electron/main/services/oxepost/service'
import { sendRequest } from '../../electron/main/services/oxepost/send'
import type { PostEnvironmentView, PostHistoryEntry, PostRequest, PostResponse } from '../../shared/oxepost/types'

/** A vault that "encrypts" by reversing and tagging, so a test can tell the file never holds the plain value. */
const vault = {
  available: () => true, problem: () => null as string | null,
  encrypt: (value: string) => Buffer.from(`enc:${[...value].reverse().join('')}`),
  decrypt: (value: Buffer) => { const text = value.toString(); if (!text.startsWith('enc:')) throw new Error('bad'); return [...text.slice(4)].reverse().join('') }
}

let server: Server
let base = ''
const seen: Array<{ method: string; url: string; headers: IncomingMessage['headers']; body: string }> = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body })
      const url = new URL(request.url ?? '/', 'http://x')
      if (url.pathname === '/slow') return void setTimeout(() => response.end('late'), 3000).unref()
      if (url.pathname === '/big') { response.writeHead(200, { 'content-type': 'text/plain' }); return void response.end('x'.repeat(3 * 1024 * 1024)) }
      if (url.pathname === '/bin') { response.writeHead(200, { 'content-type': 'application/octet-stream' }); return void response.end(Buffer.from([0, 1, 2, 3])) }
      if (url.pathname === '/redirect') { response.writeHead(302, { location: '/echo' }); return void response.end() }
      response.writeHead(url.pathname === '/missing' ? 404 : 200, { 'content-type': 'application/json', 'set-cookie': ['a=1; HttpOnly', 'b=2'], 'x-echo-auth': String(request.headers.authorization ?? '') })
      response.end(JSON.stringify({ method: request.method, query: Object.fromEntries(url.searchParams), body, auth: request.headers.authorization ?? null }))
    })
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })

const request = (patch: Partial<PostRequest> = {}): PostRequest => ({ name: 'r', method: 'GET', url: `${base}/echo`, headers: [], auth: { type: 'none' }, body: '', ...patch })

describe('sending', () => {
  it('returns status, time, size, headers, cookies and the body', async () => {
    const response = await sendRequest(request({ method: 'POST', url: `${base}/echo?a=1`, headers: [{ name: 'X-Test', value: 'yes', enabled: true }, { name: 'X-Off', value: 'no', enabled: false }], body: '{"k":1}' }))
    expect(response).toMatchObject({ status: 200, statusText: 'OK', truncated: false, binary: false, contentType: 'application/json' })
    expect(response.ms).toBeGreaterThanOrEqual(0)
    expect(response.size).toBe(Buffer.byteLength(response.body))
    expect(JSON.parse(response.body)).toMatchObject({ method: 'POST', query: { a: '1' }, body: '{"k":1}' })
    expect(response.headers.filter(header => header.name === 'set-cookie').map(header => header.value)).toEqual(['a=1; HttpOnly', 'b=2'])
    const last = seen.at(-1)!
    expect(last.headers['x-test']).toBe('yes')
    expect(last.headers['x-off']).toBeUndefined()
    // A JSON body with no Content-Type is sent as JSON.
    expect(last.headers['content-type']).toBe('application/json')
  })

  it('applies bearer, basic and API key authentication', async () => {
    const auth = async (value: PostRequest['auth'], url = `${base}/echo`): Promise<string | null> => JSON.parse((await sendRequest(request({ auth: value, url }))).body).auth
    expect(await auth({ type: 'bearer', token: 'tok' })).toBe('Bearer tok')
    expect(await auth({ type: 'basic', username: 'me', password: 'pw' })).toBe(`Basic ${Buffer.from('me:pw').toString('base64')}`)
    await sendRequest(request({ auth: { type: 'apikey', in: 'header', name: 'X-Key', value: 'k1' } }))
    expect(seen.at(-1)!.headers['x-key']).toBe('k1')
    await sendRequest(request({ auth: { type: 'apikey', in: 'query', name: 'key', value: 'k 2' } }))
    expect(seen.at(-1)!.url).toBe('/echo?key=k+2')
  })

  it('follows redirects, reports 4xx as a response and not an error', async () => {
    expect(JSON.parse((await sendRequest(request({ url: `${base}/redirect` }))).body).method).toBe('GET')
    expect((await sendRequest(request({ url: `${base}/missing` }))).status).toBe(404)
  })

  it('says why a send failed as a message code the window translates (C3)', async () => {
    const failing = (code: string, name = 'TypeError') => (async () => { throw Object.assign(new Error('fetch failed'), { name, cause: { code, message: `getaddrinfo ${code}` } }) }) as unknown as typeof fetch
    const codeOf = async (fetchImpl: typeof fetch, extra: Partial<PostRequest> = {}) => {
      try { await sendRequest(request({ url: 'http://nao-existe.invalid/ping', ...extra }), { fetchImpl }); return null } catch (error) { return (error as { messageCode?: { code: string } }).messageCode?.code }
    }
    expect(await codeOf(failing('ENOTFOUND'))).toBe('oxepost.network.notFound')
    expect(await codeOf(failing('ECONNREFUSED'))).toBe('oxepost.network.refused')
    expect(await codeOf(failing('ETIMEDOUT'))).toBe('oxepost.network.timedOut')
    expect(await codeOf(failing('CERT_HAS_EXPIRED'))).toBe('oxepost.send.tls')
    expect(await codeOf(failing('', 'TimeoutError'))).toBe('oxepost.send.timeout')
    expect(await codeOf(failing('EWEIRD'))).toBe('oxepost.send.failedWith')
    expect(await codeOf(failing('ENOTFOUND'), { url: 'not a url' })).toBe('oxepost.send.invalidUrl')
    expect(await codeOf(failing('ENOTFOUND'), { body: 'x'.repeat(6 * 1024 * 1024), method: 'POST' })).toBe('oxepost.send.bodyTooLarge')
  })

  it('caps the body it returns but still counts the size', async () => {
    const response = await sendRequest(request({ url: `${base}/big` }), { maxBody: 1024 })
    expect(response.body).toHaveLength(1024)
    expect(response).toMatchObject({ truncated: true, size: 3 * 1024 * 1024 })
    const whole = await sendRequest(request({ url: `${base}/big` }))
    expect(whole.body.length).toBe(2 * 1024 * 1024)
    expect(whole.truncated).toBe(true)
  })

  it('does not print binary content', async () => {
    expect(await sendRequest(request({ url: `${base}/bin` }))).toMatchObject({ binary: true, body: '', size: 4 })
  })

  it('stops waiting at the timeout, and refuses what it cannot send', async () => {
    await expect(sendRequest(request({ url: `${base}/slow` }), { timeoutMs: 1000 })).rejects.toMatchObject({ code: 'timeout' })
    await expect(sendRequest(request({ url: 'not a url' }))).rejects.toMatchObject({ code: 'invalid' })
    await expect(sendRequest(request({ url: 'file:///etc/passwd' }))).rejects.toThrow(/http and https/)
    await expect(sendRequest(request({ body: 'x' }))).rejects.toThrow(/cannot carry a body/)
    const closed = createServer()
    await new Promise<void>(done => closed.listen(0, '127.0.0.1', done))
    const port = (closed.address() as AddressInfo).port
    await new Promise(done => closed.close(done))
    await expect(sendRequest(request({ url: `http://127.0.0.1:${port}/` }))).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/refused/) })
  })

  it('leaves certificate checks on: a self-signed server is not trusted', async () => {
    const fake = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }) }) as unknown as typeof fetch
    await expect(sendRequest(request({ url: 'https://self-signed.test/' }), { fetchImpl: fake })).rejects.toMatchObject({ code: 'tls', message: expect.stringMatching(/always verifies/) })
    expect(readFileSync(join(process.cwd(), 'electron/main/services/oxepost/send.ts'), 'utf8')).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|insecure/i)
  })
})

describe('collections, environments and secrets through the service', () => {
  let root = ''
  let userData = ''
  let service: OxePostService
  const call = async <T>(op: Parameters<OxePostService['call']>[0], input: Record<string, unknown>): Promise<T> => {
    const result = await service.call(op, { workspaceId: 'w1', ...input })
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
    return result.value as T
  }
  const refused = async (op: Parameters<OxePostService['call']>[0], input: Record<string, unknown>): Promise<string> => {
    const result = await service.call(op, { workspaceId: 'w1', ...input })
    expect(result.ok).toBe(false)
    return result.ok ? '' : `${result.error.code}: ${result.error.message}`
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'oxepost-ws-'))
    userData = mkdtempSync(join(tmpdir(), 'oxepost-ud-'))
    service = new OxePostService({ rootOf: id => id === 'w1' ? root : undefined, vault, secretsFile: join(userData, 'secrets.json') })
  })
  afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }) })

  it('saves requests as readable files, lists, reads, renames and deletes them', async () => {
    const saved = await call<{ path: string }>('save', { request: request({ name: 'Get user', url: '{{baseUrl}}/users/1' }), folder: 'users' })
    expect(saved.path).toBe('users/get-user.http')
    expect(readFileSync(join(root, '.oxespace/requests/users/get-user.http'), 'utf8')).toBe('# name: Get user\nGET {{baseUrl}}/users/1\n')
    // A second request with the same name does not overwrite the first.
    expect((await call<{ path: string }>('save', { request: request({ name: 'Get user' }), folder: 'users' })).path).toBe('users/get-user-2.http')
    const listed = await call<{ requests: Array<{ path: string; name: string; method: string }> }>('list', {})
    expect(listed.requests.map(item => item.path)).toEqual(['users/get-user-2.http', 'users/get-user.http'])
    expect((await call<PostRequest>('read', { path: 'users/get-user.http' })).url).toBe('{{baseUrl}}/users/1')
    const renamed = await call<{ path: string }>('rename', { path: 'users/get-user.http', name: 'Fetch one user' })
    expect(renamed.path).toBe('users/fetch-one-user.http')
    expect(existsSync(join(root, '.oxespace/requests/users/get-user.http'))).toBe(false)
    await call('delete', { path: 'users/fetch-one-user.http' })
    await call('delete', { path: 'users/get-user-2.http' })
    expect((await call<{ requests: unknown[] }>('list', {})).requests).toEqual([])
  })

  it('lists a file it cannot read with the reason instead of hiding it', async () => {
    mkdirSync(join(root, '.oxespace/requests'), { recursive: true })
    writeFileSync(join(root, '.oxespace/requests/broken.http'), 'FETCH nothing\n')
    const entry = (await call<{ requests: Array<{ path: string; method: string | null; problem?: string }> }>('list', {})).requests.find(item => item.path === 'broken.http')
    expect(entry).toMatchObject({ method: null, problem: expect.stringMatching(/Line 1/) })
    rmSync(join(root, '.oxespace/requests/broken.http'))
  })

  it('refuses paths that leave the requests folder, including through a link', async () => {
    for (const path of ['../../secret.http', '../x.http', '/abs.http', 'a\\b.http', 'environments/x.http']) expect(await refused('read', { path }), path).toMatch(/not valid/)
    expect(await refused('save', { request: request(), folder: '../..' })).toMatch(/folder is not valid/)
    expect(await refused('read', { workspaceId: 'unknown', path: 'x.http' })).toMatch(/workspace was not found/)
    const outside = mkdtempSync(join(tmpdir(), 'oxepost-out-'))
    writeFileSync(join(outside, 'leak.http'), 'GET http://leak\n')
    try {
      symlinkSync(outside, join(root, '.oxespace/requests/linked'), 'junction')
      expect(await refused('read', { path: 'linked/leak.http' })).toMatch(/outside the workspace/)
      expect(await refused('save', { request: request(), folder: 'linked' })).toMatch(/outside the workspace/)
      expect(readdirSync(outside)).toEqual(['leak.http'])
      expect((await call<{ requests: unknown[] }>('list', {})).requests).toEqual([])
    } finally { rmSync(join(root, '.oxespace/requests/linked'), { force: true, recursive: false }); rmSync(outside, { recursive: true, force: true }) }
  })

  it('keeps secret values out of every file and out of every answer', async () => {
    await call('envSave', { environment: { name: 'Local', variables: { baseUrl: base }, secrets: ['token'] } })
    expect(await refused('envSave', { environment: { name: 'Bad', variables: { api_key: 'abc123' } } })).toMatch(/secret/)
    expect(await refused('envSave', { environment: { name: 'local' } })).toMatch(/already exists/)
    await call('secretSet', { environment: 'local', name: 'token', value: 'S3CRET-VALUE-42' })
    expect(await refused('secretSet', { environment: 'local', name: 'other', value: 'x' })).toMatch(/not a secret of this environment/)

    const listed = await call<{ environments: PostEnvironmentView[] }>('list', {})
    expect(listed.environments).toHaveLength(1)
    expect(listed.environments[0]).toMatchObject({ id: 'local', production: false, secrets: ['token'], secretState: { token: 'set' } })
    expect(JSON.stringify(listed)).not.toContain('S3CRET')

    // Not in the environment file, not in the encrypted file as plain text, not in any request file.
    expect(readFileSync(join(root, '.oxespace/requests/environments/local.json'), 'utf8')).not.toContain('S3CRET')
    const stored = readFileSync(join(userData, 'secrets.json'), 'utf8')
    expect(stored).not.toContain('S3CRET')
    expect(stored).toContain(Buffer.from(vault.encrypt('S3CRET-VALUE-42')).toString('base64'))

    await call('secretClear', { environment: 'local', name: 'token' })
    expect((await call<{ environments: PostEnvironmentView[] }>('list', {})).environments[0]!.secretState).toEqual({ token: 'not set' })
    await call('secretSet', { environment: 'local', name: 'token', value: 'S3CRET-VALUE-42' })
  })

  it('sends with the environment, masks a secret the API echoes back, and redacts the history', async () => {
    const response = await call<PostResponse>('send', {
      environment: 'local',
      request: request({ method: 'POST', url: '{{baseUrl}}/echo?api_key={{token}}', auth: { type: 'bearer', token: '{{token}}' }, headers: [{ name: 'X-Trace', value: 'tr-{{token}}', enabled: true }], body: '{"t":"{{token}}"}' })
    })
    // The server really received the secret...
    const received = seen.at(-1)!
    expect(received.headers.authorization).toBe('Bearer S3CRET-VALUE-42')
    expect(received.body).toBe('{"t":"S3CRET-VALUE-42"}')
    // ...and the page gets it back masked, in the body and in the headers.
    expect(response.body).not.toContain('S3CRET')
    expect(response.body).toContain('[secret:token]')
    expect(JSON.stringify(response.headers)).not.toContain('S3CRET')
    expect(response.url).not.toContain('S3CRET')

    const history = await call<PostHistoryEntry[]>('history', {})
    expect(history[0]).toMatchObject({ method: 'POST', status: 200, environment: 'Local' })
    expect(JSON.stringify(history)).not.toContain('S3CRET')
    expect(history[0]!.url).toContain('api_key=[redacted]')
    expect(history[0]!.requestHeaders.find(header => header.name === 'Authorization')?.value).toBe('[redacted]')
    expect(history[0]!.requestHeaders.find(header => header.name === 'X-Trace')?.value).toBe('tr-[secret:token]')
  })

  it('stops before sending when a variable has no value, and says which', async () => {
    const before = seen.length
    expect(await refused('send', { environment: 'local', request: request({ url: '{{baseUrl}}/{{nope}}' }) })).toMatch(/missing: No value for \{\{nope\}\}/)
    await call('secretClear', { environment: 'local', name: 'token' })
    expect(await refused('send', { environment: 'local', request: request({ auth: { type: 'bearer', token: '{{token}}' } }) })).toMatch(/\{\{token\}\}/)
    expect(seen.length).toBe(before)
    const failures = (await call<PostHistoryEntry[]>('history', {}))
    expect(failures.every(entry => !entry.error)).toBe(true)
  })

  it('asks for a confirmation before sending to a production environment', async () => {
    await call('envSave', { environment: { name: 'Production', production: true, variables: { baseUrl: base }, secrets: [] } })
    const before = seen.length
    expect(await refused('send', { environment: 'production', request: request({ url: '{{baseUrl}}/echo' }) })).toMatch(/^confirm:/)
    expect(seen.length).toBe(before)
    const ok = await call<PostResponse>('send', { environment: 'production', confirmed: true, request: request({ url: '{{baseUrl}}/echo' }) })
    expect(ok.status).toBe(200)
  })

  it('erases the secrets of an environment that is deleted', async () => {
    await call('envSave', { id: 'local', environment: { name: 'Local', variables: { baseUrl: base }, secrets: ['token'] } })
    await call('secretSet', { environment: 'local', name: 'token', value: 'ANOTHER-SECRET' })
    await call('envDelete', { id: 'local' })
    expect(readFileSync(join(userData, 'secrets.json'), 'utf8')).not.toContain(Buffer.from(vault.encrypt('ANOTHER-SECRET')).toString('base64'))
    expect(existsSync(join(root, '.oxespace/requests/environments/local.json'))).toBe(false)
  })

  it('does not store a secret when the system has no secure storage', async () => {
    const weak = new OxePostService({ rootOf: () => root, vault: { ...vault, problem: () => 'No system keyring was found' }, secretsFile: join(userData, 'weak.json') })
    const result = await weak.call('secretSet', { workspaceId: 'w', environment: 'production', name: 'x', value: 'v' })
    expect(result.ok).toBe(false)
    expect(existsSync(join(userData, 'weak.json'))).toBe(false)
  })
})
