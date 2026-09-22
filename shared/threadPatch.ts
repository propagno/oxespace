import type { GitDiffHunk } from './types/git'
import type { ThreadFileChange } from './types/thread'

/** Parse a single native unified patch; never count file headers as edited lines. */
export function parseThreadPatch(content: string): { hunks: GitDiffHunk[]; additions: number; deletions: number } {
  const hunks: GitDiffHunk[] = []
  let oldLine = 0, newLine = 0, additions = 0, deletions = 0
  for (const line of content.split('\n')) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); hunks.push({ header: line, lines: [] }); continue }
    const hunk = hunks.at(-1)
    if (!hunk || line.startsWith('\\') || !['+', '-', ' '].includes(line[0])) continue
    if (line[0] === '+') { additions++; hunk.lines.push({ type: 'added', oldLineNo: null, newLineNo: newLine++, content: line.slice(1) }) }
    else if (line[0] === '-') { deletions++; hunk.lines.push({ type: 'removed', oldLineNo: oldLine++, newLineNo: null, content: line.slice(1) }) }
    else hunk.lines.push({ type: 'context', oldLineNo: oldLine++, newLineNo: newLine++, content: line.slice(1) })
  }
  return { hunks, additions, deletions }
}

/** The app server publishes an authoritative aggregate for repeated edits in a turn. */
export function splitThreadPatch(content: string): ThreadFileChange[] {
  const files: ThreadFileChange[] = []
  for (const section of content.split(/(?=^diff --git )/m)) {
    if (!section.trim()) continue
    const header = section.split(/^@@ /m)[0]
    const decode = (path: string, prefixed = true) => {
      let result = path.trim()
      if (result.startsWith('"')) { try { result = JSON.parse(result) as string } catch { result = result.slice(1, -1) } }
      return prefixed ? result.replace(/^[ab]\//, '') : result
    }
    const old = header.match(/^--- (.+)$/m)?.[1], next = header.match(/^\+\+\+ (.+)$/m)?.[1]
    const renameFrom = header.match(/^rename from (.+)$/m)?.[1], renameTo = header.match(/^rename to (.+)$/m)?.[1]
    const fallback = header.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1]
    const path = renameTo ? decode(renameTo, false) : next && next !== '/dev/null' ? decode(next) : old && old !== '/dev/null' ? decode(old) : fallback ? decode(fallback, false) : ''
    if (!path) continue
    files.push({ path, ...(renameFrom ? { previousPath: decode(renameFrom, false) } : {}), kind: renameTo ? 'rename' : old === '/dev/null' || /^new file mode /m.test(header) ? 'add' : next === '/dev/null' || /^deleted file mode /m.test(header) ? 'delete' : 'update', state: 'running', source: 'native-patch', authorship: 'provider', patch: section })
  }
  return files
}
