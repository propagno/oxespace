import type { GitDiffSummaryFile } from '../../../shared/types/git'
import { i18n } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'

export interface ChangeTreeNode {
  kind: 'dir' | 'file'
  name: string
  path: string
  additions: number
  deletions: number
  children: ChangeTreeNode[]
  file?: GitDiffSummaryFile
}

/** Above either limit the panel shows a banner and one file at a time. */
export const LARGE_DIFF_FILES = 40
export const LARGE_DIFF_LINES = 5000

export function isLargeDiff(files: number, lines: number): boolean {
  return files > LARGE_DIFF_FILES || lines > LARGE_DIFF_LINES
}

/**
 * Folds a flat file list into a directory tree. Single-child directory chains
 * are collapsed (`a/b/c`) the way the reference file tree shows them, and
 * directories sort before files.
 */
export function buildChangeTree(files: GitDiffSummaryFile[]): ChangeTreeNode[] {
  const root: ChangeTreeNode = { kind: 'dir', name: '', path: '', additions: 0, deletions: 0, children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let index = 0; index < parts.length - 1; index++) {
      const path = parts.slice(0, index + 1).join('/')
      let child = node.children.find(entry => entry.kind === 'dir' && entry.path === path)
      if (!child) { child = { kind: 'dir', name: parts[index], path, additions: 0, deletions: 0, children: [] }; node.children.push(child) }
      node = child
    }
    node.children.push({ kind: 'file', name: parts[parts.length - 1], path: file.path, additions: file.additions, deletions: file.deletions, children: [], file })
  }
  const finish = (node: ChangeTreeNode): void => {
    for (const child of node.children) {
      if (child.kind === 'dir') finish(child)
      node.additions += child.additions
      node.deletions += child.deletions
    }
    node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)
    for (let index = 0; index < node.children.length; index++) {
      let child = node.children[index]
      while (child.kind === 'dir' && child.children.length === 1 && child.children[0].kind === 'dir') {
        const only = child.children[0]
        child = { ...only, name: `${child.name}/${only.name}` }
        node.children[index] = child
      }
    }
  }
  finish(root)
  return root.children
}

export function filterChangedFiles(files: GitDiffSummaryFile[], query: string): GitDiffSummaryFile[] {
  const needle = query.trim().toLowerCase()
  return needle ? files.filter(file => file.path.toLowerCase().includes(needle)) : files
}

/** Files in the order the tree shows them, so previous/next follows the eye. */
export function orderedFiles(nodes: ChangeTreeNode[]): GitDiffSummaryFile[] {
  return nodes.flatMap(node => node.kind === 'file' ? [node.file!] : orderedFiles(node.children))
}

/** `origin/HEAD` aliases and `remotes/` prefixes are noise in a branch picker. */
export function normalizeBranchName(name: string): string | null {
  const trimmed = name.replace(/^remotes\//, '').trim()
  if (!trimmed || /(^|\/)HEAD(\s|$)/.test(trimmed) || trimmed.includes('->')) return null
  return trimmed
}

/**
 * Picks the comparison base: the resolved worktree base when it exists, then the
 * usual trunk names, then the first branch, and finally HEAD.
 */
export function chooseBase(resolved: string | null, branches: string[]): string {
  if (resolved && (branches.length === 0 || branches.includes(resolved))) return resolved
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master', 'develop']) {
    if (branches.includes(candidate)) return candidate
  }
  return resolved ?? branches[0] ?? 'HEAD'
}

/**
 * Side B of a comparison: the work tree of a checkout (this one or another worktree of the repository,
 * uncommitted changes included) or the committed state of a ref.
 */
export type CompareHead = { kind: 'worktree'; path: string; branch: string | null } | { kind: 'ref'; ref: string }
export type CompareMode = 'merge-base' | 'direct'

/** Same rule as the main process (`expectGitRef`), so a typed ref is refused before it is sent. */
export function isValidRef(text: string): boolean {
  return /^[A-Za-z0-9_./@~^{}-]+$/.test(text) && !text.includes('..') && !text.startsWith('-')
}

export function headLabel(head: CompareHead): string {
  if (head.kind === 'ref') return head.ref
  return head.branch ?? i18n.t('changes.detached', { ns: 'code' })
}

/** Identifies one comparison, for the "viewed" marks: a file viewed against one pair is not viewed against another. */
export function comparisonKey(base: string, head: CompareHead, mode: CompareMode): string {
  const side = head.kind === 'ref' ? `ref:${head.ref}` : `tree:${head.path}`
  return mode === 'merge-base' ? `${base}|${side}` : `${base}|${side}|direct`
}

/**
 * Exchanges the sides. Side A must be a ref, so a work-tree side B becomes its branch (its committed state);
 * a detached work tree cannot move to side A and the swap is refused (null).
 */
export function swapSides(base: string, head: CompareHead): { base: string; head: CompareHead } | null {
  const nextBase = head.kind === 'ref' ? head.ref : head.branch
  if (!nextBase) return null
  return { base: nextBase, head: { kind: 'ref', ref: base } }
}

export function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf('/')
  return index < 0 ? { directory: '', name: path } : { directory: path.slice(0, index + 1), name: path.slice(index + 1) }
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json',
  css: 'css', scss: 'scss', html: 'html', md: 'markdown', yml: 'yaml', yaml: 'yaml', py: 'python', sh: 'shell', ps1: 'powershell',
  rs: 'rust', go: 'go', java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c', toml: 'ini', xml: 'xml', sql: 'sql', dockerfile: 'dockerfile'
}

export function languageFor(path: string): string {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  const extension = name.includes('.') ? name.split('.').at(-1)! : name
  return LANGUAGES[extension] ?? 'plaintext'
}

export function formatCount(value: number): string {
  return formatNumber(value)
}
