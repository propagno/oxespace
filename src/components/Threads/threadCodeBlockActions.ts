import { createContext } from 'react'
import { useEditorStore } from '../../store/editor.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { detectEditorLanguage } from '../Editor/language'
import { inlinePathExists } from './threadInlinePath'
export { extractFenceFilename } from './threadMarkdownParse'

export const SHELL_LANGUAGES: ReadonlySet<string> = new Set([
  'sh',
  'shell',
  'bash',
  'zsh',
  'fish',
  'pwsh',
  'powershell',
  'ps1',
  'cmd',
  'bat',
  'console',
  'shellsession'
])

export const DIFF_LANGUAGES: ReadonlySet<string> = new Set(['diff', 'patch'])

export type DiffLineKind = 'added' | 'removed' | 'hunk' | 'meta' | 'context'

export interface CodeBlockRunInTerminalInput {
  code: string
  command: string
  language: string | null
}

export interface CodeBlockOpenInEditorInput {
  code: string
  language: string | null
  languageName: string | null
  filename: string | null
}

export interface ThreadCodeBlockActions {
  onRunInTerminal?: (input: CodeBlockRunInTerminalInput) => void | Promise<void>
  onOpenInEditor?: (input: CodeBlockOpenInEditorInput) => void | Promise<void>
}

export const ThreadCodeBlockActionsContext = createContext<ThreadCodeBlockActions | null>(null)

/** Extracts the lowercase language id from a `language-<id>` (or `language-<id>:<path>`) class name. */
export function extractLanguageId(className: string | undefined): string | null {
  const match = /(?:^|\s)language-([^\s:]+)/.exec(className ?? '')
  return match ? match[1].toLowerCase() : null
}

export function isShellLanguage(langId: string | null): boolean {
  return Boolean(langId && SHELL_LANGUAGES.has(langId.toLowerCase()))
}

export function isDiffLanguage(langId: string | null): boolean {
  return Boolean(langId && DIFF_LANGUAGES.has(langId.toLowerCase()))
}

const DOLLAR_PROMPT_RE = /^\s*\$\s+/
const PS_PROMPT_RE = /^\s*PS(?:\s+[^>\n]*)?>\s+/
const HASH_COMMENT_RE = /^\s*#/

/**
 * Prepares a shell code block for terminal execution. Strips leading `$ ` (or `PS> `) prompt markers when every
 * command line is clearly prompt-prefixed, and preserves multi-line scripts and `$VAR` expansions verbatim.
 */
export function prepareShellSnippet(code: string, language: string | null): string {
  const trimmed = code.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '')
  if (!trimmed) return ''
  const lines = trimmed.split(/\r?\n/)
  const nonEmpty = lines.filter(line => line.trim().length > 0)
  if (nonEmpty.length === 0) return ''

  const commandLines = nonEmpty.filter(line => !HASH_COMMENT_RE.test(line))
  if (commandLines.length > 0 && commandLines.every(line => DOLLAR_PROMPT_RE.test(line))) {
    return lines.map(line => (DOLLAR_PROMPT_RE.test(line) ? line.replace(DOLLAR_PROMPT_RE, '') : line)).join('\n')
  }

  const lang = language?.toLowerCase() ?? ''
  const allowPsPrompt = lang === 'pwsh' || lang === 'powershell' || lang === 'ps1' || lang === 'console' || lang === 'shellsession'
  if (allowPsPrompt && commandLines.length > 0 && commandLines.every(line => PS_PROMPT_RE.test(line))) {
    return lines.map(line => (PS_PROMPT_RE.test(line) ? line.replace(PS_PROMPT_RE, '') : line)).join('\n')
  }

  return trimmed
}

const DIFF_META_PREFIX_RE = /^(?:diff |index |new file mode |deleted file mode |old mode |new mode |rename from |rename to |similarity index |Binary files )/

/** Classifies a line in a `diff` / `patch` fenced code block for subtle semantic styling. */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+++') || line.startsWith('---') || DIFF_META_PREFIX_RE.test(line)) return 'meta'
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  ts: 'ts',
  typescript: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  py: 'py',
  python: 'py',
  python3: 'py',
  rs: 'rs',
  rust: 'rs',
  go: 'go',
  golang: 'go',
  java: 'java',
  kt: 'kt',
  kotlin: 'kt',
  cs: 'cs',
  csharp: 'cs',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'h',
  rb: 'rb',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  sql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'svg',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  md: 'md',
  markdown: 'md',
  mdx: 'md',
  diff: 'diff',
  patch: 'diff',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  pwsh: 'ps1',
  powershell: 'ps1',
  ps1: 'ps1',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql'
}

const MONACO_BY_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  py: 'python',
  python: 'python',
  python3: 'python',
  rs: 'rust',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  java: 'java',
  kt: 'kotlin',
  kotlin: 'kotlin',
  cs: 'csharp',
  csharp: 'csharp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  rb: 'ruby',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  sql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  diff: 'plaintext',
  patch: 'plaintext',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  zsh: 'shell',
  pwsh: 'powershell',
  powershell: 'powershell',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql'
}

export function monacoLanguageFor(language: string | null, filename: string | null): string {
  const fromLang = language ? MONACO_BY_LANGUAGE[language.toLowerCase()] : undefined
  if (fromLang) return fromLang
  if (filename) return detectEditorLanguage(filename)
  return 'plaintext'
}

function nextScratchPath(workspaceId: string, language: string | null): string {
  const ext = (language && EXTENSION_BY_LANGUAGE[language.toLowerCase()]) || 'txt'
  const existing = new Set((useEditorStore.getState().tabs[workspaceId] ?? []).map(tab => tab.relativePath))
  let index = 1
  while (existing.has(`snippet-${index}.${ext}`)) index += 1
  return `snippet-${index}.${ext}`
}

/**
 * Opens a code block in the thread's integrated editor panel: if the block names a file that exists in the working
 * root, opens that real file; otherwise opens (or focuses) a lightweight read-only virtual snippet buffer.
 */
export async function openCodeBlockInEditor(input: {
  threadId: string
  workspaceId: string
  rootPath: string
  code: string
  language: string | null
  filename: string | null
}): Promise<void> {
  const { threadId, workspaceId, rootPath, code, language, filename } = input
  const store = useEditorStore.getState()

  if (filename && rootPath) {
    const exists = await inlinePathExists(workspaceId, { root: rootPath, relativePath: filename }).catch(() => false)
    if (exists) {
      void store.openFile({ workspaceId, rootPath, relativePath: filename })
      useThreadWorkbenchStore.getState().setView(threadId, { panel: 'files' })
      return
    }
  }

  const monacoLanguage = monacoLanguageFor(language, filename)
  if (!filename) {
    const existingVirtual = Object.values(store.files[workspaceId] ?? {}).find(
      file => file.virtual && file.content === code && file.language === monacoLanguage
    )
    if (existingVirtual) {
      store.openVirtualFile({
        workspaceId,
        rootPath,
        relativePath: existingVirtual.relativePath,
        content: code,
        language: monacoLanguage
      })
      useThreadWorkbenchStore.getState().setView(threadId, { panel: 'files' })
      return
    }
  }

  const relativePath = filename ?? nextScratchPath(workspaceId, language)
  store.openVirtualFile({
    workspaceId,
    rootPath,
    relativePath,
    content: code,
    language: monacoLanguage
  })
  useThreadWorkbenchStore.getState().setView(threadId, { panel: 'files' })
}
