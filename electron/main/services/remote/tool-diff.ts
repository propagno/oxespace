import { REMOTE_DIFF_LIMITS, type RemoteToolDiff, type RemoteToolDiffFile } from '../../../../shared/remote/protocol'
import type { ThreadFileChange } from '../../../../shared/types/thread'
import { redactCounted, relativeTo, scrubPaths } from './text'

/** A file Git or a provider reports as binary: listed with zero counts and never sent as text. */
const BINARY = /^(?:Binary files .* differ|GIT binary patch)$/m
/** Where a unified diff may be cut: before a file header or a hunk header. */
const BOUNDARY = /^(?:diff --git |--- |@@ )/gm
const PATH = 1_000

/**
 * A tool step's diff for the phone (CCR #509 §3). Paths are relative to a registered project root; a file outside
 * every root is dropped. At most `REMOTE_DIFF_LIMITS.files` files are listed. The patch is the files' own evidence
 * (`patchOf` reads it), redacted like tool output, with any absolute path scrubbed, and cut at a hunk boundary to
 * `REMOTE_DIFF_LIMITS.patchBytes`. A file whose evidence is binary gets zero counts and no patch.
 */
export function toToolDiff(files: readonly ThreadFileChange[], roots: readonly string[], patchOf?: (artifactId: string) => string | undefined): { diff?: RemoteToolDiff; redacted: number } {
  const listed: RemoteToolDiffFile[] = []
  const patches: string[] = []
  let truncated = false
  let redacted = 0
  for (const file of files) {
    const path = projectPath(file.path, roots)
    if (path === undefined) continue
    if (listed.length >= REMOTE_DIFF_LIMITS.files) { truncated = true; continue }
    let content: string | undefined
    try { content = file.artifactId && patchOf ? patchOf(file.artifactId) : undefined } catch { content = undefined }
    const binary = content !== undefined && (content.includes('\0') || BINARY.test(content))
    const name = redactCounted(path)
    redacted += name.redacted
    listed.push({ path: name.text, additions: binary ? 0 : count(file.additions), deletions: binary ? 0 : count(file.deletions) })
    if (content && !binary) patches.push(content.endsWith('\n') ? content : `${content}\n`)
    if (file.truncated) truncated = true
  }
  if (!listed.length) return { redacted: 0 }
  if (!patches.length) return { diff: { files: listed, ...(truncated ? { truncated: true } : {}) }, redacted }
  const safe = redactCounted(patches.join(''))
  redacted += safe.redacted
  const fitted = cutAtBoundary(scrubPaths(safe.text, roots), REMOTE_DIFF_LIMITS.patchBytes)
  return { diff: { files: listed, ...(fitted.text ? { patch: fitted.text } : {}), ...(truncated || fitted.truncated ? { truncated: true } : {}) }, redacted }
}

function projectPath(path: string, roots: readonly string[]): string | undefined {
  if (!path || path.length > 4096 || path.includes('\0')) return undefined
  for (const root of roots) {
    const relative = relativeTo(root, path)
    if (relative && relative !== '.') return relative.length > PATH ? undefined : relative
  }
  return undefined
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), 1_000_000) : 0
}

/** The longest prefix of `text` that fits `maxBytes` and ends right before a file or hunk header; empty when none does. */
export function cutAtBoundary(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false }
  // A cut is valid only where the kept text ends with a whole hunk: before the next file's header, or before a
  // file's second or later hunk. Never inside a header, and never right after a header that has no hunk yet.
  let best = 0
  let hunks = 0
  for (const match of text.matchAll(BOUNDARY)) {
    const at = match.index ?? 0
    // A `---` line inside a `diff --git` header is part of that header, not a new file.
    // A `---` not followed by `+++` is a removed line whose text starts with `--` (an SQL comment, say): hunk content.
    if (match[0] === '--- ' && /^(?:diff --git |index |new file|deleted file|similarity|rename |old mode|new mode)/.test(text.slice(text.lastIndexOf('\n', at - 2) + 1, at))) continue
    if (match[0] === '--- ' && !text.startsWith('+++ ', text.indexOf('\n', at) + 1)) continue
    const valid = at > 0 && hunks > 0
    if (match[0] === '@@ ') hunks += 1
    else hunks = 0
    if (!valid) continue
    if (Buffer.byteLength(text.slice(0, at)) > maxBytes) break
    best = at
  }
  return { text: text.slice(0, best), truncated: true }
}
