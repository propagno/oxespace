import type { GitDiffFile, GitDiffHunk, GitDiffLine } from '../../../shared/types/git'

export function parseDiff(raw: string): GitDiffFile[] {
  const files: GitDiffFile[] = []
  if (!raw.trim()) return files

  let current: GitDiffFile | null = null
  let currentHunk: GitDiffHunk | null = null
  let oldLineNo = 0
  let newLineNo = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line)
      current = { path: match?.[1] ?? '', additions: 0, deletions: 0, hunks: [], mtime: null }
      currentHunk = null
      oldLineNo = 0
      newLineNo = 0
      continue
    }

    if (!current) continue

    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      continue
    }

    if (line.startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLineNo = m ? parseInt(m[1], 10) : 1
      newLineNo = m ? parseInt(m[2], 10) : 1
      currentHunk = { header: line, lines: [] }
      current.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) continue

    let diffLine: GitDiffLine | null = null

    if (line.startsWith('+')) {
      diffLine = { type: 'added', oldLineNo: null, newLineNo: newLineNo++, content: line.slice(1) }
      current.additions++
    } else if (line.startsWith('-')) {
      diffLine = { type: 'removed', oldLineNo: oldLineNo++, newLineNo: null, content: line.slice(1) }
      current.deletions++
    } else if (line.startsWith(' ')) {
      diffLine = { type: 'context', oldLineNo: oldLineNo++, newLineNo: newLineNo++, content: line.slice(1) }
    } else if (line === '\\ No newline at end of file') {
      continue
    }

    if (diffLine) currentHunk.lines.push(diffLine)
  }

  if (current) files.push(current)
  return files
}
