import { describe, expect, it } from 'vitest'
import { REDACTED, isSensitiveName, maskValues, redactHeaders, redactUrl } from '../../shared/oxepost/redact'

describe('redaction', () => {
  it('recognizes credential names and leaves ordinary ones', () => {
    for (const name of ['Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'X-API-Key', 'x_api_key', 'access_token', 'client_secret', 'password', 'X-Auth-Token', 'session']) expect(isSensitiveName(name), name).toBe(true)
    for (const name of ['Accept', 'Content-Type', 'User-Agent', 'X-Request-Id', 'page', 'monkey', 'author']) expect(isSensitiveName(name), name).toBe(false)
  })

  it('hides credential headers and keeps the rest', () => {
    expect(redactHeaders([{ name: 'Authorization', value: 'Bearer abc', enabled: true }, { name: 'Accept', value: 'x', enabled: true }])).toEqual([
      { name: 'Authorization', value: REDACTED, enabled: true }, { name: 'Accept', value: 'x', enabled: true }])
  })

  it('hides credential query parameters and the user info of a URL', () => {
    expect(redactUrl('https://me:pw@host/a?page=2&api_key=abc&token=zzz#frag')).toBe(`https://${REDACTED}@host/a?page=2&api_key=${REDACTED}&token=${REDACTED}#frag`)
    expect(redactUrl('http://h/a?x=1')).toBe('http://h/a?x=1')
    expect(redactUrl('http://h/a?access%5Ftoken=1')).toContain(REDACTED)
  })

  it('masks the secrets an API echoes back, longest first, and ignores short ones', () => {
    const secrets = [{ name: 'token', value: 'abcd1234' }, { name: 'long', value: 'abcd1234-extra' }, { name: 'tiny', value: 'ab' }]
    expect(maskValues('you sent abcd1234-extra and abcd1234, also ab', secrets)).toBe('you sent [secret:long] and [secret:token], also ab')
  })
})
