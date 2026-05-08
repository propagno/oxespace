import { describe, expect, test } from 'vitest'
import { detectEditorLanguage } from '../../src/components/Editor/language'

describe('detectEditorLanguage', () => {
  test.each([
    ['src/index.ts', 'typescript'],
    ['src/App.tsx', 'typescript'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['src/styles.css', 'css'],
    ['index.html', 'html'],
    ['scripts/build.js', 'javascript']
  ])('detects %s as %s', (relativePath, language) => {
    expect(detectEditorLanguage(relativePath)).toBe(language)
  })

  test('handles windows separators and unknown extensions', () => {
    expect(detectEditorLanguage('src\\main.ts')).toBe('typescript')
    expect(detectEditorLanguage('notes.unknown')).toBe('plaintext')
    expect(detectEditorLanguage('LICENSE')).toBe('plaintext')
  })
})
