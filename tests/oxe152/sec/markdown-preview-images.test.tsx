// Frozen acceptance test for OXE-360 A1 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// An untrusted README must not make a request or draw an unbounded or vector image: MarkdownPreview follows the rule
// answers already follow (inlineImageSource in src/components/Threads/markdownImage.ts).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownPreview } from '../../../src/components/Preview/MarkdownPreview'
import { MAX_INLINE_IMAGE_CHARS } from '../../../src/components/Threads/markdownImage'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
afterEach(cleanup)

describe('OXE-360 · the images a Markdown preview may show', () => {
  it('a Markdown preview never loads a remote image', () => {
    for (const src of ['https://tracker.example/p.png', 'http://192.168.0.1/admin.png', 'HTTP://tracker.example/q.gif', '//tracker.example/r.png']) {
      const { container, unmount } = render(<MarkdownPreview content={`![pixel](${src})`} />)
      expect(container.querySelector('img'), src).toBeNull()
      expect(container.textContent, src).toContain('pixel')
      unmount()
    }
  })

  it('a Markdown preview shows an inline raster image and refuses SVG and oversized data', () => {
    const shown = render(<MarkdownPreview content={`![dot](${PNG})`} />)
    expect(shown.container.querySelector('img')).toHaveAttribute('src', PNG)
    shown.unmount()
    for (const src of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGI+', `data:image/png;base64,${'A'.repeat(MAX_INLINE_IMAGE_CHARS)}`]) {
      const { container, unmount } = render(<MarkdownPreview content={`![dot](${src})`} />)
      expect(container.querySelector('img'), src.slice(0, 40)).toBeNull()
      unmount()
    }
  // Released by 8e (152sec CR-01): v8 coverage makes parsing the real 4 MB limit about 7x slower (run 45057950386).
  }, 60_000)
})
