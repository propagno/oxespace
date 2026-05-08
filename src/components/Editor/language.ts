const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['css', 'css'],
  ['html', 'html'],
  ['htm', 'html'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['json', 'json'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['ts', 'typescript'],
  ['tsx', 'typescript']
])

const LANGUAGE_BY_FILENAME = new Map<string, string>([
  ['dockerfile', 'dockerfile'],
  ['makefile', 'makefile'],
  ['package.json', 'json'],
  ['tsconfig.json', 'json']
])

export function detectEditorLanguage(relativePath: string): string {
  const fileName = getFileName(relativePath).toLowerCase()
  const explicitLanguage = LANGUAGE_BY_FILENAME.get(fileName)

  if (explicitLanguage) {
    return explicitLanguage
  }

  const extension = getExtension(fileName)
  return extension ? LANGUAGE_BY_EXTENSION.get(extension) ?? 'plaintext' : 'plaintext'
}

function getFileName(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? ''
}

function getExtension(fileName: string): string | null {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return null
  }

  return fileName.slice(lastDotIndex + 1)
}
