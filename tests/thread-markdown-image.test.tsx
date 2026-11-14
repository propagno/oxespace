// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import '../src/i18n'
import { ThreadMarkdown } from '../src/components/Threads/ThreadMarkdown'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

describe('images in an answer', () => {
  afterEach(cleanup)

  test('an image the answer carries is drawn', () => {
    const { container } = render(<ThreadMarkdown text={`Here it is:\n\n![a pixel](${PNG})`} />)
    const image = container.querySelector('img.thread-markdown-image')
    expect(image?.getAttribute('src')).toBe(PNG)
    expect(image?.getAttribute('alt')).toBe('a pixel')
  })

  test('an image on the network is not requested: it stays a reference', () => {
    const { container } = render(<ThreadMarkdown text="![tracker](https://example.com/pixel.png?u=secret)" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('[Image: tracker]')
  })

  test('a vector image and a script address are not drawn', () => {
    const { container } = render(<ThreadMarkdown text={'![v](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=) ![s](javascript:alert(1))'} />)
    expect(container.querySelector('img')).toBeNull()
  })
})
