// OXE-162: the usage panel's total follows the density (--fs-md: 14 compact, 15 comfortable), and the Web Preview's
// "source file" link underlines in its own text color instead of a border token far below 3:1.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readCss = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `${selector} rule`).not.toBeNull()
  return match![2]
}

describe('OXE-162 usage total and source-file underline', () => {
  it('CA-1: the usage total reads --fs-md, with no pixel size or fallback, in both densities', () => {
    const body = rule(readCss('src/components/Threads/ThreadView.css'), '.thread-usage-total strong')
    expect(body).toMatch(/font-size:\s*var\(--fs-md\)\s*;/)
    expect(body).not.toMatch(/font-size:[^;]*\d+px/)
    const tokens = readCss('src/styles/tokens.generated.css')
    expect(tokens).toMatch(/--fs-md:\s*14px/)
    expect(rule(tokens, ":root[data-density='comfortable']")).toMatch(/--fs-md:\s*15px/)
  })

  it('CA-2: the source-file link underlines in currentColor, with no color of its own', () => {
    const body = rule(readCss('src/styles/scripts-webpreview.css'), 'button.design-grab-source-file')
    expect(body).toMatch(/text-decoration:\s*underline/)
    expect(body).not.toMatch(/text-decoration-color/)
  })
})
