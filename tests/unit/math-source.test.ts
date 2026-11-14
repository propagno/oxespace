import { describe, expect, test } from 'vitest'
import { MATH_MARK, mathOf, protectMath } from '../../src/components/Threads/mathSource'

const inline = (tex: string): string => `\`${MATH_MARK}${tex}\``
const block = (...tex: string[]): string => ['', '```math', ...tex, '```', ''].join('\n')

describe('formulas in an answer, before the Markdown parser reads it', () => {
  test('text with no formula comes back as it was, character for character', () => {
    for (const text of ['Plain words.', 'It costs $5 and $10.', 'Paid $ 5 $ for it', 'a$b$c', 'Use `$HOME` and `$PATH`.', 'Escaped \\$x\\$ stays.', 'One $ alone', 'price: $5, tax: $0.50', '', '# Title\n\n- item']) expect(protectMath(text), text).toBe(text)
  })

  test('an inline formula between dollars becomes a marked code span, underscores and stars untouched', () => {
    expect(protectMath('The sum $a_1 + b_2$ and $x*y*z$ hold.')).toBe(`The sum ${inline('a_1 + b_2')} and ${inline('x*y*z')} hold.`)
    expect(protectMath('($E=mc^2$)')).toBe(`(${inline('E=mc^2')})`)
    expect(protectMath('Com $\\frac{a}{b}$, vale.')).toBe(`Com ${inline('\\frac{a}{b}')}, vale.`)
  })

  test('\\( … \\) is an inline formula too', () => {
    expect(protectMath('So \\( x^2 \\) grows.')).toBe(`So ${inline('x^2')} grows.`)
    expect(protectMath('Open \\( never closed')).toBe('Open \\( never closed')
  })

  test('money is not a formula: a closing dollar before a digit, or an opening one before a space, is not one', () => {
    expect(protectMath('From $5 to $10 a month.')).toBe('From $5 to $10 a month.')
    expect(protectMath('Between $x$ and $5')).toBe(`Between ${inline('x')} and $5`)
    expect(protectMath('US$20 and R$30')).toBe('US$20 and R$30')
  })

  test('an escaped dollar inside a formula does not close it', () => {
    expect(protectMath('$a \\$ b$')).toBe(inline('a \\$ b'))
  })

  test('nothing inside a code span or a fenced block is read', () => {
    expect(protectMath('Run `echo $a$b` then $x$.')).toBe(`Run \`echo $a$b\` then ${inline('x')}.`)
    const fenced = 'Before $y$\n\n```sh\necho $a$ $$b$$\n```\n\nAfter $z$'
    expect(protectMath(fenced)).toBe(`Before ${inline('y')}\n\n\`\`\`sh\necho $a$ $$b$$\n\`\`\`\n\nAfter ${inline('z')}`)
    const tilde = '~~~\n$$\nx\n$$\n~~~'
    expect(protectMath(tilde)).toBe(tilde)
    // A longer fence closes only on one as long: the shorter run inside is content.
    const nested = '````md\n```\n$a$\n```\n````\n$b$'
    expect(protectMath(nested)).toBe(`\`\`\`\`md\n\`\`\`\n$a$\n\`\`\`\n\`\`\`\`\n${inline('b')}`)
  })

  test('a displayed formula on one line becomes a fenced block named math', () => {
    expect(protectMath('$$E = mc^2$$')).toBe(block('E = mc^2'))
    // The block stands apart from the lines around it, as a fenced block must.
    expect(protectMath('Then:\n\\[ \\int_0^1 x\\,dx \\]\nDone.')).toBe(`Then:\n${block('\\int_0^1 x\\,dx')}\nDone.`)
  })

  test('a displayed formula over several lines, with its delimiters on their own lines or not', () => {
    expect(protectMath('$$\na = b \\\\\nc = d\n$$')).toBe(block('a = b \\\\', 'c = d'))
    expect(protectMath('$$ a = b\n+ c $$')).toBe(block('a = b', '+ c'))
    expect(protectMath('\\[\nx^2\n\\]')).toBe(block('x^2'))
  })

  test('inside a list the block keeps the item\'s indent', () => {
    expect(protectMath('- Step:\n  $$\n  x = 1\n  $$\n- Next')).toBe(['- Step:', '', '  ```math', '  x = 1', '  ```', '', '- Next'].join('\n'))
  })

  test('a formula still arriving, with no closing line yet, stays as the text it is', () => {
    expect(protectMath('$$\na = b')).toBe('$$\na = b')
    expect(protectMath('Text $a + b')).toBe('Text $a + b')
    expect(protectMath('$$\na\n```\ncode\n```')).toBe('$$\na\n```\ncode\n```')
  })

  test('a formula with a backtick is left alone: it could not travel in a code span', () => {
    expect(protectMath('$a`b$')).toBe('$a`b$')
    expect(protectMath('$$ a ``` b $$')).toBe('$$ a ``` b $$')
  })

  test('the mark is read back only from a span that carries it', () => {
    expect(mathOf(`${MATH_MARK}x^2`)).toBe('x^2')
    expect(mathOf('x^2')).toBeNull()
    expect(mathOf('')).toBeNull()
  })
})
