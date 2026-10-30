import { describe, expect, it } from 'vitest'
import { parseCurl, shellWords, toCurl } from '../../shared/oxepost/curl'
import { parseOpenApi } from '../../shared/oxepost/openapi'
import { parseRequest, serializeRequest } from '../../shared/oxepost/format'

describe('cURL import', () => {
  it('splits a shell line like a shell', () => {
    expect(shellWords(`curl 'a b' "c \\"d\\"" e\\ f $'g\\nh'`)).toEqual(['curl', 'a b', 'c "d"', 'e f', 'g\nh'])
    expect(shellWords('curl -X POST \\\n  http://x')).toEqual(['curl', '-X', 'POST', 'http://x'])
  })

  it('reads a browser-style command: method, headers, JSON body and bearer token', () => {
    const { request, warnings } = parseCurl(`curl 'https://api.test/v1/users?id=1' -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer abc.def' --data-raw '{"a":1}' --compressed`)
    expect(request).toMatchObject({ method: 'POST', url: 'https://api.test/v1/users?id=1', body: '{"a":1}', auth: { type: 'bearer', token: 'abc.def' } })
    expect(request.headers).toEqual([{ name: 'Content-Type', value: 'application/json', enabled: true }])
    // The literal token is called out so it is not saved into the file by accident.
    expect(warnings.join(' ')).toMatch(/credential/)
  })

  it('infers POST from a body, HEAD from -I, and moves data to the query with -G', () => {
    expect(parseCurl('curl http://x -d a=1').request).toMatchObject({ method: 'POST', body: 'a=1' })
    expect(parseCurl('curl -I http://x').request.method).toBe('HEAD')
    expect(parseCurl('curl -G http://x -d a=1 -d b=2').request).toMatchObject({ method: 'GET', url: 'http://x?a=1&b=2', body: '' })
  })

  it('reads -u as basic authentication, a Basic header the same way, and attached flags', () => {
    expect(parseCurl('curl -u me:pw http://x').request.auth).toEqual({ type: 'basic', username: 'me', password: 'pw' })
    expect(parseCurl(`curl -H 'Authorization: Basic ${Buffer.from('a:b').toString('base64')}' http://x`).request.auth).toEqual({ type: 'basic', username: 'a', password: 'b' })
    expect(parseCurl(`curl -XPUT -H'X-A: 1' -sSL http://x`).request).toMatchObject({ method: 'PUT', headers: [{ name: 'X-A', value: '1', enabled: true }] })
  })

  it('never turns off certificate checks, and says it ignored the flag', () => {
    const { warnings } = parseCurl('curl -k https://x')
    expect(warnings.join(' ')).toMatch(/always verifies TLS/)
  })

  it('refuses text that is not a command', () => {
    expect(() => parseCurl('curl')).toThrow()
    expect(() => parseCurl('curl -X POST')).toThrow(/no URL/)
  })

  it('exports a command that imports back to the same request', () => {
    const request = parseRequest(serializeRequest({
      name: 'x', method: 'POST', url: "https://h/a?b='1'", headers: [{ name: 'Accept', value: 'application/json', enabled: true }, { name: 'Off', value: 'no', enabled: false }],
      auth: { type: 'basic', username: '{{u}}', password: '{{p}}' }, body: `{"q":"it's"}`
    }))
    const command = toCurl(request)
    expect(command).toContain(`-u '{{u}}:{{p}}'`)
    expect(command).not.toContain('Off')
    const again = parseCurl(command).request
    expect(again).toMatchObject({ method: 'POST', url: request.url, body: request.body, auth: request.auth })
    expect(toCurl(request, { u: 'me', p: 'pw' })).toContain(`-u 'me:pw'`)
  })

  it('exports bearer, API key and HEAD', () => {
    const base = { name: 'n', method: 'GET' as const, url: 'http://h', headers: [], body: '' }
    expect(toCurl({ ...base, auth: { type: 'bearer', token: '{{t}}' } })).toBe(`curl 'http://h' -H 'Authorization: Bearer {{t}}'`)
    expect(toCurl({ ...base, auth: { type: 'apikey', in: 'query', name: 'k', value: 'v' } })).toBe(`curl 'http://h?k=v'`)
    expect(toCurl({ ...base, method: 'HEAD', auth: { type: 'none' } })).toBe(`curl -I 'http://h'`)
  })
})

const DOCUMENT = {
  openapi: '3.0.3', info: { title: 'Pets' }, servers: [{ url: 'https://{env}.pets.test/v1/', variables: { env: { default: 'api' } } }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
    schemas: { Pet: { type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, owner: { $ref: '#/components/schemas/Owner' } } }, Owner: { type: 'object', properties: { self: { $ref: '#/components/schemas/Owner' }, id: { type: 'integer' } } } }
  },
  paths: {
    '/pets': {
      get: { tags: ['pets'], summary: 'List pets', parameters: [{ name: 'limit', in: 'query', required: true }, { name: 'q', in: 'query' }] },
      post: { tags: ['pets'], operationId: 'createPet', security: [{ key: [] }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } }
    },
    '/pets/{petId}': { parameters: [{ name: 'petId', in: 'path', required: true }], delete: { summary: 'Remove', parameters: [{ name: 'X-Trace', in: 'header', required: true }] } }
  }
}

describe('OpenAPI import', () => {
  it('turns operations into requests with variables, auth and an example body', () => {
    const result = parseOpenApi(JSON.stringify(DOCUMENT))
    expect(result.title).toBe('Pets')
    expect(result.baseUrl).toBe('https://api.pets.test/v1')
    expect(result.requests.map(item => `${item.folder}:${item.request.method} ${item.request.url}`)).toEqual([
      'pets:GET {{baseUrl}}/pets?limit={{limit}}', 'pets:POST {{baseUrl}}/pets', 'pets:DELETE {{baseUrl}}/pets/{{petId}}'])
    const [list, create, remove] = result.requests.map(item => item.request)
    expect(list).toMatchObject({ name: 'List pets', auth: { type: 'bearer', token: '{{token}}' } })
    expect(create).toMatchObject({ name: 'createPet', auth: { type: 'apikey', in: 'header', name: 'X-Key', value: '{{apiKey}}' } })
    expect(JSON.parse(create!.body)).toEqual({ name: 'string', tags: ['string'], owner: { self: null, id: 0 } })
    expect(create!.headers).toEqual([{ name: 'Content-Type', value: 'application/json', enabled: true }])
    expect(remove!.headers).toEqual([{ name: 'X-Trace', value: '{{X-Trace}}', enabled: true }])
  })

  it('reads YAML too, and every imported request is a valid file', () => {
    const yaml = ['openapi: 3.1.0', 'info:', '  title: Tiny', 'paths:', '  /ping:', '    get:', '      summary: Ping'].join('\n')
    const result = parseOpenApi(yaml)
    expect(result.requests).toHaveLength(1)
    for (const item of parseOpenApi(JSON.stringify(DOCUMENT)).requests) expect(parseRequest(serializeRequest(item.request))).toEqual(item.request)
  })

  it('says why a document cannot be imported', () => {
    expect(() => parseOpenApi('{ nope')).toThrow(/neither valid JSON nor YAML/)
    expect(() => parseOpenApi(JSON.stringify({ swagger: '2.0', paths: {} }))).toThrow(/Swagger 2/)
    expect(() => parseOpenApi('hello: world')).toThrow(/not an OpenAPI 3/)
    expect(() => parseOpenApi(JSON.stringify({ openapi: '3.0.0', paths: {} }))).toThrow(/no operations/)
  })
})
