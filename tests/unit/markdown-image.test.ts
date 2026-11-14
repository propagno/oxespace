import { describe, expect, test } from 'vitest'
import { inlineImageSource, MAX_INLINE_IMAGE_CHARS, projectImagePath } from '../../src/components/Threads/markdownImage'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const ROOT = 'C:\\work\\shop'

describe('which images an answer may show', () => {
  test('an image the answer carries itself', () => {
    expect(inlineImageSource(PNG)).toBe(PNG)
    expect(inlineImageSource('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA')
  })

  test('not a vector image, not another kind of data, not a dump, not markup in the address', () => {
    expect(inlineImageSource('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeNull()
    expect(inlineImageSource('data:text/html;base64,PGI+')).toBeNull()
    expect(inlineImageSource('data:image/png;base64,AAAA" onerror="x')).toBeNull()
    expect(inlineImageSource('data:image/png,not-base64')).toBeNull()
    expect(inlineImageSource(`data:image/png;base64,${'A'.repeat(MAX_INLINE_IMAGE_CHARS)}`)).toBeNull()
    expect(inlineImageSource(undefined)).toBeNull()
  })

  test('nothing from the network', () => {
    for (const src of ['https://example.com/a.png', 'http://localhost:3000/a.png', '//cdn.example.com/a.png', 'file:///C:/work/shop/a.png', 'ftp://x/a.png']) {
      expect(inlineImageSource(src), src).toBeNull()
      expect(projectImagePath(src, ROOT), src).toBeNull()
    }
  })

  test('an image file of the project, by a relative or an absolute path', () => {
    expect(projectImagePath('docs/shot.png', ROOT)).toBe('docs/shot.png')
    expect(projectImagePath('./docs/My%20Shot.JPG?raw=1', ROOT)).toBe('docs/My Shot.JPG')
    expect(projectImagePath('C:\\work\\shop\\out\\chart.webp', ROOT)).toBe('out/chart.webp')
    expect(projectImagePath('c:/work/shop/out/chart.gif', ROOT)).toBe('out/chart.gif')
    expect(projectImagePath('/home/me/shop/a.png', '/home/me/shop')).toBe('a.png')
  })

  test('not outside the project, not another kind of file', () => {
    expect(projectImagePath('../secrets.png', ROOT)).toBeNull()
    expect(projectImagePath('docs/../../x.png', ROOT)).toBeNull()
    expect(projectImagePath('C:\\Users\\me\\Pictures\\a.png', ROOT)).toBeNull()
    expect(projectImagePath('C:\\work\\shop-other\\a.png', ROOT)).toBeNull()
    expect(projectImagePath('/etc/a.png', '/home/me/shop')).toBeNull()
    expect(projectImagePath('docs/diagram.svg', ROOT)).toBeNull()
    expect(projectImagePath('.env', ROOT)).toBeNull()
    expect(projectImagePath('docs/shot.png', '')).toBeNull()
    expect(projectImagePath('', ROOT)).toBeNull()
  })
})
