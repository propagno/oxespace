import { describe, expect, it } from 'vitest'
import { isBinaryPreview, previewKind } from '../../src/components/Preview/previewKind'
import { previewMimeType } from '../../electron/main/services/file-system.service'

describe('previewKind', () => {
  it('classifies markdown variants', () => {
    expect(previewKind('README.md')).toBe('markdown')
    expect(previewKind('docs/guide.markdown')).toBe('markdown')
    expect(previewKind('page.MDX')).toBe('markdown')
  })

  it('classifies images and pdf', () => {
    expect(previewKind('assets/logo.png')).toBe('image')
    expect(previewKind('a/b/photo.JPEG')).toBe('image')
    expect(previewKind('icon.svg')).toBe('image')
    expect(previewKind('spec.pdf')).toBe('pdf')
  })

  it('falls back to text for code and extensionless files', () => {
    expect(previewKind('src/index.ts')).toBe('text')
    expect(previewKind('Dockerfile')).toBe('text')
    expect(previewKind('.gitignore')).toBe('text')
  })

  it('marks only image and pdf as binary', () => {
    expect(isBinaryPreview('image')).toBe(true)
    expect(isBinaryPreview('pdf')).toBe(true)
    expect(isBinaryPreview('markdown')).toBe(false)
    expect(isBinaryPreview('text')).toBe(false)
  })
})

describe('previewMimeType', () => {
  it('maps previewable extensions', () => {
    expect(previewMimeType('a/b.png')).toBe('image/png')
    expect(previewMimeType('a/b.JPG')).toBe('image/jpeg')
    expect(previewMimeType('a/b.pdf')).toBe('application/pdf')
    expect(previewMimeType('a/b.svg')).toBe('image/svg+xml')
  })

  it('rejects anything else so readBinary cannot exfiltrate arbitrary files', () => {
    expect(previewMimeType('.env')).toBeNull()
    expect(previewMimeType('id_rsa')).toBeNull()
    expect(previewMimeType('src/index.ts')).toBeNull()
    expect(previewMimeType('data.sqlite')).toBeNull()
  })
})
