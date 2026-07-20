import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { DiagnosticsService, sanitizeDiagnosticText } from '../../electron/main/services/diagnostics.service'

vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }))

describe('DiagnosticsService', () => {
  test('reports database, MCP and sandbox health', () => {
    const db = openInMemoryDatabase()
    try {
      const service = new DiagnosticsService(db, () => ({
        running: true, port: 4567, bridgePath: null, serverRowId: null, lastError: null,
        uptimeMs: 1, toolCount: 3, tools: []
      }))
      const snapshot = service.getSnapshot()
      expect(snapshot.appVersion).toBe('test')
      expect(snapshot.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'database', tone: 'ok' }),
        expect.objectContaining({ id: 'mcp', tone: 'ok' }),
        expect.objectContaining({ id: 'sandbox', tone: 'ok' })
      ]))
    } finally {
      db.close()
    }
  })

  test('redacts secrets from exported logs', () => {
    const text = sanitizeDiagnosticText('authorization: Bearer abc.def\napi_key=super-secret\npassword: hunter2')
    expect(text).not.toContain('abc.def')
    expect(text).not.toContain('super-secret')
    expect(text).not.toContain('hunter2')
    expect(text).toContain('[REDACTED]')
  })
})
