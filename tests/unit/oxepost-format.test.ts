import { describe, expect, it } from 'vitest'
import { coerceEnvironment, coerceRequest, folderSegments, requestPathSegments } from '../../shared/oxepost/coerce'
import { emptyRequest, literalSecrets, parseRequest, serializeRequest, slugify } from '../../shared/oxepost/format'
import { findVariables, interpolate, resolveRequest } from '../../shared/oxepost/variables'
import type { PostRequest } from '../../shared/oxepost/types'

const sample: PostRequest = {
  name: 'Get a user', description: 'One line.', method: 'POST', url: '{{baseUrl}}/users/{{id}}?expand=roles',
  headers: [{ name: 'Accept', value: 'application/json', enabled: true }, { name: 'X-Debug', value: '1', enabled: false }],
  auth: { type: 'bearer', token: '{{token}}' }, body: '{\n  "a": 1\n}'
}

describe('request file format', () => {
  it('writes a readable file', () => {
    expect(serializeRequest(sample)).toBe([
      '# name: Get a user', '# description: One line.', '# auth: bearer {{token}}', 'POST {{baseUrl}}/users/{{id}}?expand=roles',
      'Accept: application/json', '#! X-Debug: 1', '', '{', '  "a": 1', '}', ''
    ].join('\n'))
  })

  it('reads back what it wrote, including a disabled header and the body byte for byte', () => {
    expect(parseRequest(serializeRequest(sample))).toEqual(sample)
    const trailing = { ...sample, body: 'line\n\nlast\n' }
    expect(parseRequest(serializeRequest(trailing)).body).toBe('line\n\nlast\n')
  })

  it('round trips every kind of authentication', () => {
    for (const auth of [
      { type: 'none' }, { type: 'basic', username: '{{user}}', password: '{{pass}} with spaces' },
      { type: 'apikey', in: 'query', name: 'api_key', value: '{{apiKey}}' }, { type: 'apikey', in: 'header', name: 'X-Key', value: '{{k}}' }
    ] as const) {
      const request = { ...emptyRequest(), url: 'http://x', auth }
      expect(parseRequest(serializeRequest(request)).auth).toEqual(auth)
    }
  })

  it('accepts CRLF, a BOM, HTTP/1.1 after the URL and a file with no metadata', () => {
    const parsed = parseRequest('﻿GET https://x.test/a HTTP/1.1\r\nAccept: */*\r\n\r\nbody')
    expect(parsed).toMatchObject({ method: 'GET', url: 'https://x.test/a', body: 'body', name: 'GET https://x.test/a' })
    expect(parsed.headers).toEqual([{ name: 'Accept', value: '*/*', enabled: true }])
  })

  it('says which line is wrong', () => {
    expect(() => parseRequest('# name: x\n')).toThrow(/no request line/)
    expect(() => parseRequest('FETCH http://x')).toThrow(/Line 1.*method/)
    expect(() => parseRequest('GET http://x\nnot a header')).toThrow(/Line 2/)
    expect(() => parseRequest('# auth: magic\nGET http://x')).toThrow(/Line 1.*Unknown auth/)
  })

  it('keeps a new line out of a header or a name', () => {
    const text = serializeRequest({ ...sample, name: 'a\nb', headers: [{ name: 'X', value: 'v\nInjected: 1', enabled: true }] })
    expect(parseRequest(text).headers).toEqual([{ name: 'X', value: 'v Injected: 1', enabled: true }])
    expect(parseRequest(text).name).toBe('a b')
  })

  it('names files by slug', () => {
    expect(slugify('Créer un utilisateur / v2')).toBe('creer-un-utilisateur-v2')
    expect(slugify('???')).toBe('request')
  })

  it('flags a literal secret in the authentication but not a variable', () => {
    expect(literalSecrets({ ...sample, auth: { type: 'bearer', token: 'abc123' } })).toEqual(['token'])
    expect(literalSecrets({ ...sample, auth: { type: 'bearer', token: ' {{ token }} ' } })).toEqual([])
    expect(literalSecrets({ ...sample, auth: { type: 'basic', username: 'me', password: 'hunter2' } })).toEqual(['password'])
  })
})

describe('variables', () => {
  it('finds names once, in order', () => {
    expect(findVariables('{{a}}/{{ b }}/{{a}} {{ not valid }}')).toEqual(['a', 'b'])
  })

  it('replaces in one pass and reports what has no value', () => {
    expect(interpolate('{{a}}-{{b}}-{{c}}', { a: '1', b: '{{a}}' })).toEqual({ text: '1-{{a}}-{{c}}', missing: ['c'] })
  })

  it('resolves URL, headers, body and authentication', () => {
    const { request, missing } = resolveRequest({ ...sample, auth: { type: 'basic', username: '{{u}}', password: '{{p}}' } }, { baseUrl: 'http://h', id: '7', u: 'me', p: 'pw' })
    expect(request.url).toBe('http://h/users/7?expand=roles')
    expect(request.auth).toEqual({ type: 'basic', username: 'me', password: 'pw' })
    expect(missing).toEqual([])
    expect(resolveRequest(sample, {}).missing.sort()).toEqual(['baseUrl', 'id', 'token'])
  })

  it('does not treat object prototype names as values', () => {
    expect(interpolate('{{constructor}}', {}).missing).toEqual(['constructor'])
  })
})

describe('what arrives over IPC', () => {
  it('reads a request into the real shape and refuses a malformed one', () => {
    expect(coerceRequest({ name: 'x', method: 'post', url: 'http://x' })).toMatchObject({ method: 'POST', headers: [], body: '', auth: { type: 'none' } })
    expect(() => coerceRequest({ method: 'TRACE' })).toThrow(/method/)
    expect(() => coerceRequest({ url: 3 })).toThrow()
    expect(() => coerceRequest({ auth: { type: 'oauth' } })).toThrow(/Unknown authentication/)
    expect(() => coerceRequest({ headers: [{ name: 'a\0', value: 'b' }] })).toThrow()
  })

  it('keeps request paths inside the folder, as .http files', () => {
    expect(requestPathSegments('users/get-user.http')).toEqual(['users', 'get-user.http'])
    for (const bad of ['../x.http', 'a/../../x.http', '/etc/passwd.http', 'a\\b.http', 'x.txt', 'environments/prod.http', 'a/./b.http', 'a/b/c/d/e.http', '', 'x.http\0', '.hidden.http', 'a.http.'])
      expect(() => requestPathSegments(bad), bad).toThrow()
    expect(folderSegments('a/b')).toEqual(['a', 'b'])
    expect(() => folderSegments('../x')).toThrow()
    expect(() => folderSegments('a/b/c/d')).toThrow()
  })

  it('refuses a credential kept as a variable: it would be committed', () => {
    expect(coerceEnvironment({ name: 'local', variables: { baseUrl: 'http://x' }, secrets: ['token'] })).toMatchObject({ name: 'local', secrets: ['token'] })
    expect(() => coerceEnvironment({ name: 'local', variables: { apiKey: 'abc' } })).toThrow(/secret/)
    expect(() => coerceEnvironment({ name: 'local', variables: { Authorization: 'Bearer x' } })).toThrow(/secret/)
    expect(() => coerceEnvironment({ name: 'local', variables: { token: 'x' }, secrets: ['token'] })).toThrow()
    expect(() => coerceEnvironment({ name: 'l', variables: { 'bad name': '1' } })).toThrow(/valid variable name/)
    // An empty placeholder for a token is fine: nothing secret in the file.
    expect(coerceEnvironment({ name: 'l', variables: { token: '' } }).variables).toEqual({ token: '' })
  })
})
