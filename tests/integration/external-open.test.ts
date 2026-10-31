import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.fn(async () => undefined)
const recordIncident = vi.fn()
vi.mock('electron', () => ({ shell: { openExternal } }))
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident }))

const { EXTERNAL_URL_MAX_LENGTH, externalUrlRefusal, isSafeExternalUrl } = await import('../../electron/main/utils/external-url')
const { EXTERNAL_REFUSALS_PER_MINUTE, openExternalOrRecord, resetExternalRefusals } = await import('../../electron/main/utils/external-open')

beforeEach(() => {
  openExternal.mockClear()
  recordIncident.mockClear()
  resetExternalRefusals()
})

// F24 (FRONTEND CCR): links leaving the app from the main window, with the reason of a refusal journalled.
describe('external links', () => {
  it('says why a URL may not leave the app', () => {
    expect(externalUrlRefusal('https://example.com/a?b=c')).toBeNull()
    expect(externalUrlRefusal('mailto:support@example.com')).toBeNull()
    expect(externalUrlRefusal('file:///etc/passwd')).toBe('protocol')
    expect(externalUrlRefusal('javascript:alert(1)')).toBe('protocol')
    expect(externalUrlRefusal('https://user:secret@example.com/')).toBe('credentials')
    expect(externalUrlRefusal('https://token@example.com/')).toBe('credentials')
    expect(externalUrlRefusal('https://example.com/\u0000x')).toBe('malformed')
    expect(externalUrlRefusal('https://exa\nmple.com/')).toBe('malformed')
    expect(externalUrlRefusal('not a url')).toBe('malformed')
  })

  it('takes 2,048 characters and refuses 2,049', () => {
    const at = (length: number) => `https://example.com/${'a'.repeat(length - 'https://example.com/'.length)}`
    expect(EXTERNAL_URL_MAX_LENGTH).toBe(2_048)
    expect(at(2_048)).toHaveLength(2_048)
    expect(isSafeExternalUrl(at(2_048))).toBe(true)
    expect(externalUrlRefusal(at(2_049))).toBe('length')
  })

  it('opens a safe link and records nothing', () => {
    expect(openExternalOrRecord('https://example.com/')).toBe(true)
    expect(openExternalOrRecord('mailto:a@example.com')).toBe(true)
    expect(openExternal).toHaveBeenCalledTimes(2)
    expect(recordIncident).not.toHaveBeenCalled()
  })

  it('records each refusal by its reason, never the URL or its host', () => {
    for (const url of ['file:///C:/secret.txt', 'https://user:pass@private.example/', `https://example.com/${'x'.repeat(3000)}`, 'https://bad\u0007host/']) {
      expect(openExternalOrRecord(url)).toBe(false)
    }
    expect(openExternal).not.toHaveBeenCalled()
    expect(recordIncident.mock.calls).toEqual([
      ['incident.external.refused', 'protocol'], ['incident.external.refused', 'credentials'],
      ['incident.external.refused', 'length'], ['incident.external.refused', 'malformed']
    ])
    expect(JSON.stringify(recordIncident.mock.calls)).not.toMatch(/example|secret|pass|private/)
  })

  it('records at most the limit per minute, then once that a burst is going on', () => {
    const start = 1_000_000
    for (let index = 0; index < EXTERNAL_REFUSALS_PER_MINUTE + 15; index++) openExternalOrRecord('file:///x', start + index)
    expect(recordIncident).toHaveBeenCalledTimes(EXTERNAL_REFUSALS_PER_MINUTE + 1)
    expect(recordIncident).toHaveBeenLastCalledWith('incident.external.rateLimited')
    // A new minute records again.
    openExternalOrRecord('file:///x', start + 60_000)
    expect(recordIncident).toHaveBeenLastCalledWith('incident.external.refused', 'protocol')
  })
})
