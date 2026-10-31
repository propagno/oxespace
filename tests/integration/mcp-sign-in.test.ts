import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'

const openExternalOrRecord = vi.fn(() => true)
vi.mock('../../electron/main/utils/external-open', () => ({ openExternalOrRecord }))

const { McpManager } = await import('../../electron/main/services/mcp.service')

type Runtime = { server: { id: string }; authUrl?: string; browserOpened?: boolean; initialized?: boolean }
type Internals = { runtimes: Map<string, Runtime>; watchSignIn(runtime: Runtime, line: string): void }

afterEach(() => { vi.useRealTimers(); openExternalOrRecord.mockClear() })

// Review of #259: the sign-in URL is text the server process wrote; it never opens the browser by itself.
describe('MCP sign-in page', () => {
  test('a sign-in URL in the server output is kept, and nothing opens until the person clicks', () => {
    vi.useFakeTimers()
    const db = openInMemoryDatabase()
    try {
      const manager = new McpManager(db) as unknown as Internals & InstanceType<typeof McpManager>
      const runtime: Runtime = { server: { id: 's1' } }
      manager.runtimes.set('s1', runtime)
      // mcp-remote prints the URL on a line of its own; a URL inside other text is not taken.
      manager.watchSignIn(runtime, 'Please authorize: https://auth.example.com/authorize?state=other')
      expect(runtime.authUrl).toBeUndefined()
      manager.watchSignIn(runtime, 'https://auth.example.com/authorize?state=abc')
      expect(runtime.authUrl).toBe('https://auth.example.com/authorize?state=abc')
      vi.advanceTimersByTime(60_000)
      expect(openExternalOrRecord).not.toHaveBeenCalled()

      expect(manager.openSignIn('s1')).toBe(true)
      expect(openExternalOrRecord).toHaveBeenCalledWith('https://auth.example.com/authorize?state=abc')
    } finally { db.close() }
  })

  test('only an https URL of a known server is handed over, and a refusal is reported back', () => {
    const db = openInMemoryDatabase()
    try {
      const manager = new McpManager(db) as unknown as Internals & InstanceType<typeof McpManager>
      manager.runtimes.set('plain', { server: { id: 'plain' }, authUrl: 'http://auth.example.com/' })
      expect(manager.openSignIn('plain')).toBe(false)
      expect(manager.openSignIn('unknown')).toBe(false)
      expect(openExternalOrRecord).not.toHaveBeenCalled()
      // The shared rules refuse it (credentials in the URL): the click reports false and the incident is theirs to record.
      manager.runtimes.set('creds', { server: { id: 'creds' }, authUrl: 'https://user:pass@auth.example.com/' })
      openExternalOrRecord.mockReturnValueOnce(false)
      expect(manager.openSignIn('creds')).toBe(false)
      expect(openExternalOrRecord).toHaveBeenCalledWith('https://user:pass@auth.example.com/')
    } finally { db.close() }
  })
})
