import { describe, expect, test } from 'vitest'
import { firstProseLine } from '../../src/components/Threads/deriveThreadActivity'

describe('the line of an answer the band sums it up by', () => {
  test('prose after a heading, not the heading', () => {
    expect(firstProseLine('## Report\n\nThe test fails because total() ignores qty.\n')).toBe('The test fails because total() ignores qty.')
  })

  test('what is inside a code fence, a table or a rule is skipped', () => {
    expect(firstProseLine('```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n\n---\n\nNothing else changed.')).toBe('Nothing else changed.')
  })

  test('a list item reads without its marker, a quote without its bar, inline marks without the marks', () => {
    expect(firstProseLine('- [x] **Read** `src/price.js`')).toBe('Read src/price.js')
    expect(firstProseLine('1) First, the cause.')).toBe('First, the cause.')
    expect(firstProseLine('> As the README says.')).toBe('As the README says.')
  })

  test('only headings or only code: the first heading, or nothing', () => {
    expect(firstProseLine('# Plan\n\n## Steps\n')).toBe('Plan')
    expect(firstProseLine('```\nonly code\n```')).toBe('')
    expect(firstProseLine('')).toBe('')
  })
})
