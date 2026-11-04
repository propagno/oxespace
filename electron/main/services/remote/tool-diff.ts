import { REMOTE_DIFF_LIMITS, type RemoteToolDiff, type RemoteToolDiffFile } from '../../../../shared/remote/protocol'
import type { ThreadFileChange } from '../../../../shared/types/thread'
import { redactCounted, relativeTo, scrubPaths } from './text'

/** A file Git or a provider reports as binary: listed with zero counts and never sent as text. */
const BINARY = /^(?:Binary files .* differ|GIT binary patch)$/m
/** Where a patch may be cut: before a file header (always the one written here) or a hunk header. */
const BOUNDARY = /^(?:diff --git |@@ )/gm
/** Path characters a phone list must not carry: control characters break the row and its byte budget. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const PATH_BYTES = 512
/** Raw evidence read per file and per item, before redaction; the cap plus room for the redactor's context. */
const READ_FILE_BYTES = REMOTE_DIFF_LIMITS.patchBytes * 4
const READ_ITEM_BYTES = REMOTE_DIFF_LIMITS.patchBytes * 2
/** Key material: a marker, or a run of base64-only lines (a key body without its markers). */
const KEY_MATERIAL = /PRIVATE KEY|^[-+ ][A-Za-z0-9+/=]{40,}\r?\n[-+ ][A-Za-z0-9+/=]{40,}\r?\n[-+ ][A-Za-z0-9+/=]{40,}$/m

/**
 * A tool step's diff for the phone (CCR #509 §3).
 * - Paths are relative to a registered project root; a file outside every root, or a path with control characters
 *   or over 512 bytes, is dropped. At most `REMOTE_DIFF_LIMITS.files` files are listed.
 * - The patch comes only from provider or working-tree evidence that is a unified diff. A `tool-input` artifact is the
 *   tool's raw input (JSON for Claude's Edit and Write), never a diff, and is never sent (SECURITY H1 on #585).
 * - Each file's own header lines are replaced by one written from its validated path, so nothing the evidence says
 *   about where the file lives (absolute, `--no-index`, a path with spaces) reaches the phone.
 * - A file with key material, binary content or more than one file in its evidence sends no patch.
 * - At most `READ_ITEM_BYTES` of evidence are read per item, cut at a hunk boundary before redaction; the result is
 *   redacted, path-scrubbed and cut again to `REMOTE_DIFF_LIMITS.patchBytes`.
 */
export function toToolDiff(files: readonly ThreadFileChange[], roots: readonly string[], patchOf?: (artifactId: string) => string | undefined): { diff?: RemoteToolDiff; redacted: number } {
  const listed: RemoteToolDiffFile[] = []
  const patches: string[] = []
  let truncated = false
  let redacted = 0
  let read = 0
  for (const file of files) {
    const path = projectPath(file.path, roots)
    if (path === undefined) continue
    if (listed.length >= REMOTE_DIFF_LIMITS.files) { truncated = true; continue }
    let content: string | undefined
    if (file.artifactId && patchOf && file.source !== 'tool-input' && read < READ_ITEM_BYTES) {
      try { content = patchOf(file.artifactId) } catch { content = undefined }
    }
    const binary = content !== undefined && (content.includes('\0') || BINARY.test(content))
    const name = redactCounted(path)
    redacted += name.redacted
    listed.push({ path: name.text, additions: binary ? 0 : count(file.additions), deletions: binary ? 0 : count(file.deletions) })
    if (file.truncated) truncated = true
    if (!content || binary) continue
    const hunks = hunksOf(content)
    if (hunks === undefined) continue
    const header = `diff --git a/${name.text} b/${name.text}\n--- a/${name.text}\n+++ b/${name.text}\n`
    const fitted = cutAtBoundary(header + hunks, READ_FILE_BYTES)
    if (!fitted.text) { truncated = true; continue }
    if (fitted.truncated) truncated = true
    patches.push(fitted.text)
    read += Buffer.byteLength(fitted.text)
  }
  if (!listed.length) return { redacted: 0 }
  if (!patches.length) return { diff: { files: listed, ...(truncated ? { truncated: true } : {}) }, redacted }
  const safe = redactCounted(patches.join(''))
  redacted += safe.redacted
  const fitted = cutAtBoundary(scrubPaths(safe.text, roots), REMOTE_DIFF_LIMITS.patchBytes)
  return { diff: { files: listed, ...(fitted.text ? { patch: fitted.text } : {}), ...(truncated || fitted.truncated ? { truncated: true } : {}) }, redacted }
}

/**
 * The hunks of one file's unified diff, without its header lines; undefined when it has no hunk, describes more
 * than one file, or carries key material.
 */
function hunksOf(content: string): string | undefined {
  const text = content.replace(/\r\n/g, '\n')
  const first = text.search(/^@@ /m)
  if (first < 0) return undefined
  const body = text.slice(first)
  if (/^diff --git /m.test(body) || /^--- .*\n\+\+\+ /m.test(body) || KEY_MATERIAL.test(body)) return undefined
  return body.endsWith('\n') ? body : `${body}\n`
}

function projectPath(path: string, roots: readonly string[]): string | undefined {
  if (!path || path.length > 4096 || CONTROL.test(path)) return undefined
  for (const root of roots) {
    const relative = relativeTo(root, path)
    if (relative && relative !== '.') return Buffer.byteLength(relative) > PATH_BYTES ? undefined : relative
  }
  return undefined
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), 1_000_000) : 0
}

/**
 * The longest prefix of `text` that fits `maxBytes` and ends with a whole hunk: before the next file's header, or
 * before a file's second or later hunk. Empty when none does.
 */
export function cutAtBoundary(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false }
  let best = 0
  let hunks = 0
  for (const match of text.matchAll(BOUNDARY)) {
    const at = match.index ?? 0
    const valid = at > 0 && hunks > 0
    if (match[0] === '@@ ') hunks += 1
    else hunks = 0
    if (!valid) continue
    if (Buffer.byteLength(text.slice(0, at)) > maxBytes) break
    best = at
  }
  return { text: text.slice(0, best), truncated: true }
}
