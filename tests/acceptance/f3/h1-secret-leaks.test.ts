// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1), SECURITY S1–S4, S6, S7 (TECH LEAD) and
// HML-695-1..3: no secret value survives the parse or the redacted command. Written by the planner; the executor must
// not edit it. Every planted secret is a unique SKnn marker.
// @vitest-environment node
import { beforeAll, describe, expect, test } from 'vitest'
import { warmShellParser } from '../../../electron/main/services/conversation/shell-parse'
import { HTTP_CALLS_MAX, isSensitiveHeaderName, parseHttpCalls, redactCommand } from '../../../electron/main/services/http-audit/parse'
import { LEAK_CASES } from './fixtures/http-leak-cases'

beforeAll(async () => { expect(await warmShellParser()).toBe(true) })

describe('A59 · SECURITY: nothing secret survives the parse or the redacted command', () => {
  test('S1–S6: for every leak case, no secret appears in the parsed calls or the redacted command, and a call is still read', () => {
    for (const { name, shell, command, secrets } of LEAK_CASES) {
      const calls = parseHttpCalls(command, shell)
      expect(calls.length, name).toBeGreaterThanOrEqual(1)
      const kept = JSON.stringify(calls) + '\n' + redactCommand(command, shell)
      for (const secret of secrets) expect(kept, `${name}: ${secret}`).not.toContain(secret)
    }
  })

  test('S1: a body keeps only the flag and its size', () => {
    expect(parseHttpCalls("curl -d 'password=SK01hunter2' https://a.test/login")).toMatchObject([{ method: 'POST', hasBody: true, bodyBytes: 'password=SK01hunter2'.length }])
  })

  test('S3: userinfo leaves the host clean', () => {
    expect(parseHttpCalls('curl https://user:SK24pass@a.test/x')).toMatchObject([{ host: 'a.test', path: '/x' }])
  })

  test('S4: a long mixed letters-and-digits path segment becomes :secret, in the template and the command', () => {
    expect(parseHttpCalls('curl https://hooks.slack.com/services/T0ABCDEFG/B0ABCDEFG/SK25aBcDeFgHiJkLmNoP12')).toMatchObject([{ path: '/services/T0ABCDEFG/B0ABCDEFG/:secret' }])
    expect(parseHttpCalls('curl https://api.telegram.org/bot123456789:AAHSK26xYzAbCdEfGhIjKlMn/sendMessage')).toMatchObject([{ path: '/:secret/sendMessage' }])
    expect(redactCommand('curl https://api.test/v1/keys/sk_live_SK27abcdefghijklmnop', 'bash')).toContain(':secret')
  })

  test('S7: sensitive header names, case-insensitive', () => {
    for (const name of ['Authorization', 'proxy-authorization', 'Cookie', 'Set-Cookie', 'X-Api-Token', 'X-Client-Secret', 'Api-Key', 'X-Auth-User', 'Session-Id', 'X-Signature', 'X-Password', 'X-Credential']) {
      expect(isSensitiveHeaderName(name), name).toBe(true)
    }
    for (const name of ['Accept', 'Content-Type', 'X-Request-Id', 'User-Agent']) expect(isSensitiveHeaderName(name), name).toBe(false)
    expect(parseHttpCalls("curl -H 'x-client-secret: v' -H 'Accept: json' https://a.test/x")).toMatchObject([{ headerNames: ['•••• (x-client-secret)', 'Accept'] }])
  })

  test('HML-695-2: wrappers and nested shells are read through; a variable URL never throws', () => {
    const wrapped = ['sudo curl https://a.test/w1', 'env FOO=1 curl https://a.test/w2', 'time curl https://a.test/w3', 'command curl https://a.test/w4', 'timeout 5 curl https://a.test/w5', "bash -c 'curl https://a.test/w6'", 'sh -c "curl https://a.test/w7"']
    for (const command of wrapped) expect(parseHttpCalls(command).map(call => call.host), command).toEqual(['a.test'])
    expect(() => parseHttpCalls('curl "$API_URL/x"')).not.toThrow()
    const variable = parseHttpCalls('curl "$API_URL/x"')
    expect(variable.length).toBeLessThanOrEqual(1)
    if (variable.length) expect(variable[0].host === null || typeof variable[0].host === 'string').toBe(true)
  })

  test('HML-695-2: at most HTTP_CALLS_MAX calls are read from one command', () => {
    expect(HTTP_CALLS_MAX).toBe(50)
    const many = Array.from({ length: 60 }, (_, index) => `curl https://a.test/${index}`).join(' && ')
    expect(parseHttpCalls(many)).toHaveLength(50)
  })

  test('HML-695-3: Windows curl.exe and the PowerShell aliases iwr and irm', () => {
    expect(parseHttpCalls('curl.exe https://a.test/win')).toMatchObject([{ tool: 'curl', host: 'a.test' }])
    expect(parseHttpCalls('iwr https://a.test/a', 'powershell')).toMatchObject([{ tool: 'Invoke-WebRequest' }])
    expect(parseHttpCalls('irm https://a.test/b -Headers @{ "X-Api-Key" = $env:KEY }', 'powershell')).toMatchObject([{ tool: 'Invoke-RestMethod', headerNames: ['•••• (X-Api-Key)'] }])
  })
})
