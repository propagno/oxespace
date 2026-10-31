import { describe, expect, it } from 'vitest'
import { classifyPreviewUrl } from '../../electron/main/utils/preview-url'

/** B15: which agent preview URLs open directly, which ask a person first, and which are refused. */
describe('classifyPreviewUrl', () => {
  it.each([
    'http://localhost', 'http://localhost:5173', 'https://localhost:8443/app?x=1#top', 'http://127.0.0.1:4178', 'http://127.0.0.1',
    'http://[::1]:3000/', 'http://app.localhost:5173', 'http://a.b-c.localhost', 'http://localhost:65535/path', 'HTTP://localhost:3000'
  ])('opens %s directly', url => {
    expect(classifyPreviewUrl(url).kind).toBe('local')
  })

  it.each([
    'https://example.com', 'http://192.168.0.10:3000', 'http://10.0.0.1', 'http://127.0.0.2', 'http://0.0.0.0:3000',
    // Tricks that read as local to a careless check.
    'http://localhost.evil.com', 'http://localhost.evil.com:5173', 'http://evil.com/localhost', 'http://evil.com?http://localhost',
    'http://127.0.0.1@evil.com', 'http://localhost@evil.com', 'http://user:pass@localhost:3000', 'http://localhost:3000@evil.com',
    'http://[::ffff:7f00:1]', 'http://[::ffff:127.0.0.1]', 'http://[0:0:0:0:0:0:0:1]',
    'http://2130706433', 'http://0177.0.0.1', 'http://0x7f.0.0.1', 'http://0x7f000001', 'http://127.1', 'http://017700000001',
    'http://LOCALHOST', 'http://LocalHost:5173', 'http://APP.LOCALHOST', 'http://localhost.', 'http://localhost%2e',
    'http://xn--localhost-.com', 'http://loca\u006chost.evil.com', 'http:\\\\evil.com', 'http://evil.com\\@localhost',
    ' http://localhost', 'http://local\thost', 'http://localhost\u200b', 'http://localhost\u00ad:3000', 'http://ｌocalhost'
  ])('asks before %s', url => {
    expect(classifyPreviewUrl(url)).toMatchObject({ kind: 'external', file: false })
  })

  it('asks before any file: URL, and the approval names the parsed URL', () => {
    for (const url of ['file:///C:/Users/me/report.html', 'file:///etc/passwd', 'FILE:///tmp/x.html', 'file://localhost/tmp/x.html']) {
      expect(classifyPreviewUrl(url), url).toMatchObject({ kind: 'external', file: true })
    }
    expect(classifyPreviewUrl('file:///tmp/a b.html')).toEqual({ kind: 'external', file: true, href: 'file:///tmp/a%20b.html' })
  })

  it.each([
    'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'blob:http://localhost/1234', 'about:blank',
    'chrome://settings', 'devtools://devtools/bundled/inspector.html', 'mailto:me@example.com', 'ftp://localhost', 'ws://localhost:3000',
    'vscode://file/x', 'oxespace://open', 'view-source:http://localhost', 'localhost:3000', '//localhost:3000', 'not a url', ''
  ])('refuses %s', url => {
    expect(classifyPreviewUrl(url)).toEqual({ kind: 'refused' })
  })
})
