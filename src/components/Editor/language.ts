const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['c', 'c'],
  ['cc', 'cpp'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['css', 'css'],
  ['cxx', 'cpp'],
  ['go', 'go'],
  ['gql', 'graphql'],
  ['graphql', 'graphql'],
  ['h', 'c'],
  ['hpp', 'cpp'],
  ['html', 'html'],
  ['htm', 'html'],
  ['ini', 'ini'],
  ['java', 'java'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['json', 'json'],
  ['kt', 'kotlin'],
  ['less', 'less'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['php', 'php'],
  ['ps1', 'powershell'],
  ['py', 'python'],
  ['rb', 'ruby'],
  ['rs', 'rust'],
  ['scss', 'scss'],
  ['sh', 'shell'],
  ['sql', 'sql'],
  ['svg', 'xml'],
  ['swift', 'swift'],
  ['toml', 'ini'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['xml', 'xml'],
  ['yaml', 'yaml'],
  ['yml', 'yaml']
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
