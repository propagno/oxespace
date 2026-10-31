// @vitest-environment node
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MainMessageError, redactMainMessage } from '../../electron/main/ipc/main-message-error'
import { MAIN_MESSAGE_ERROR_TAG, MAIN_MESSAGE_PARAM_LIMITS, mainMessage, messageFromError, type MainMessage } from '../../shared/messages'

/** What the window does with a rejection: the C3 message when there is one, its own generic sentence otherwise. */
const shown = (cause: unknown): MainMessage | 'generic' => messageFromError(cause) ?? 'generic'
/** What `ipcRenderer.invoke` rejects with: only the text survives, wrapped by Electron. */
const acrossIpc = (error: Error): Error => new Error(`Error invoking remote method 'remote:x': ${String(error)}`)

describe('C3 in a rejection (MainMessageError and messageFromError)', () => {
  it('round-trips through the IPC text, and text without the marker falls back to the generic message', () => {
    const message = mainMessage('remote.pairing.limit', { max: 5 })
    const error = new MainMessageError(message, 'Too many devices')
    expect(shown(error)).toEqual(message)
    expect(shown(acrossIpc(error))).toEqual(message)
    for (const plain of [new Error('Too many devices'), acrossIpc(new Error('enabled must be a boolean')), 'Unknown device', undefined]) expect(shown(plain)).toBe('generic')
  })

  it('the marker is " #c3 " with its spaces, and "#c3" in the English text or in a parameter does not mislead the read', () => {
    expect(MAIN_MESSAGE_ERROR_TAG).toBe(' #c3 ')
    const message = mainMessage('mcp.quarantine.changed', { tools: ['see #c3 notes', `ticket${MAIN_MESSAGE_ERROR_TAG}42`, 'c3'] })
    for (const english of ['Tool c3 changed', 'See #c3 for the reason', `Marked${MAIN_MESSAGE_ERROR_TAG}by hand`, `${MAIN_MESSAGE_ERROR_TAG}{"code":"app.connectivity.offline","params":{}}`]) {
      const error = new MainMessageError(message, english)
      expect(messageFromError(error), english).toEqual(message)
      expect(messageFromError(acrossIpc(error)), english).toEqual(message)
      expect(error.message.startsWith(english)).toBe(true)
    }
    // Without a real message after any marker, there is nothing to read.
    expect(messageFromError(new Error(`a${MAIN_MESSAGE_ERROR_TAG}b${MAIN_MESSAGE_ERROR_TAG}c`))).toBeNull()
  })

  it('keeps the English sentence first and readable on its own, for logs and crash reports', () => {
    const error = new MainMessageError(mainMessage('remote.gateway.offline', {}), 'Turn the gateway on first')
    const [english, json] = error.message.split(MAIN_MESSAGE_ERROR_TAG)
    expect(english).toBe('Turn the gateway on first')
    expect(JSON.parse(json)).toEqual({ code: 'remote.gateway.offline', params: {} })
    expect(String(error)).toMatch(/^MainMessageError: Turn the gateway on first #c3 \{/)
  })

  it('redacts text parameters like the rest of C3: the home folder made relative and secrets removed', () => {
    const home = process.platform === 'win32' ? '%USERPROFILE%' : '~'
    const token = `ghp_${'A'.repeat(36)}`
    const error = new MainMessageError(mainMessage('mcp.quarantine.changed', { tools: [join(homedir(), 'projects', 'tool'), `token=${token}`, 'search'] }), `Failed in ${homedir()}`)
    const crossed = messageFromError(acrossIpc(error)) as { params: { tools: string[] } }
    expect(crossed.params.tools[0]).toBe(join(home, 'projects', 'tool'))
    expect(crossed.params.tools[1]).toMatch(/^token=\[redacted\]$/i)
    expect(crossed.params.tools[2]).toBe('search')
    expect(error.message).not.toContain(homedir())
    expect(error.message).not.toContain(token)
    expect(error.mainMessage).toEqual(crossed)
  })

  it('caps each text parameter and each list, so nothing unbounded crosses IPC or lands in a log', () => {
    const long = 'x'.repeat(5_000)
    const many = Array.from({ length: 500 }, (_, index) => `tool-${index}`)
    const safe = redactMainMessage(mainMessage('mcp.quarantine.added', { tools: [long, ...many] })) as { params: { tools: string[] } }
    expect(safe.params.tools).toHaveLength(MAIN_MESSAGE_PARAM_LIMITS.listLength)
    expect(safe.params.tools[0]).toHaveLength(MAIN_MESSAGE_PARAM_LIMITS.textLength)
    expect(safe.params.tools[0].endsWith('…')).toBe(true)
    const error = new MainMessageError(mainMessage('mcp.quarantine.added', { tools: [long, ...many] }), long)
    expect(error.message.length).toBeLessThan(MAIN_MESSAGE_PARAM_LIMITS.textLength * (MAIN_MESSAGE_PARAM_LIMITS.listLength + 2) + 200)
    expect(messageFromError(error)).toEqual(safe)
    // Numbers pass untouched.
    expect(redactMainMessage(mainMessage('remote.device.invalidName', { max: 64 }))).toEqual({ code: 'remote.device.invalidName', params: { max: 64 } })
  })
})
