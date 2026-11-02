import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.3.3', getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined }
}))
vi.mock('electron-log/main.js', () => ({ default: { info: () => undefined, warn: () => undefined } }))

const { loopbackUpdateFeed } = await import('../../electron/main/updater')

describe('the packaged smoke update feed (B13, T8)', () => {
  test('is honoured only as plain http on the loopback', () => {
    for (const url of ['http://127.0.0.1:43123/', 'http://localhost:9/feed', 'http://[::1]:8080/']) {
      expect(loopbackUpdateFeed({ OXESPACE_UPDATE_FEED_URL: url }), url).toBe(new URL(url).toString())
    }
  })

  test('anything else is ignored, so the real feed stays in charge', () => {
    for (const url of [undefined, '', 'https://127.0.0.1/', 'http://example.com/', 'http://127.0.0.1.example.com/',
      'http://user:pass@127.0.0.1/', 'file:///C:/feed', 'http://10.0.0.1/', 'http://0.0.0.0/', 'not a url']) {
      expect(loopbackUpdateFeed({ OXESPACE_UPDATE_FEED_URL: url }), String(url)).toBeNull()
    }
  })
})
