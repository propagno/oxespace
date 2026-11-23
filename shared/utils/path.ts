/**
 * Root-path identity, shared by the main process and the sidebar.
 *
 * Two places need to agree on whether two workspaces sit on the same folder:
 * `WorkspaceService.create`, which activates the existing workspace instead of
 * opening a second one, and the sidebar, which numbers the duplicates that
 * predate that rule. If they disagree, the app argues with itself — the
 * sidebar showing two rows the main process treats as one, or the reverse.
 *
 * Case folding is deliberately platform-dependent. Windows and macOS resolve
 * paths case-insensitively, so `C:\Repo` and `c:\repo` are one folder. Linux
 * resolves them as two, and folding there would merge distinct directories.
 * Hence the explicit `platform` argument rather than a `process.platform` read:
 * the renderer has no `process`, and takes `window.oxe.app.platform` — the same
 * shape `buildScriptCommand` already uses.
 */

/**
 * The root as the person meant it: surrounding spaces trimmed, and one pair of matching quotes removed when they wrap
 * the whole text, as Explorer's "Copy as path" gives it. Quotes inside a name, or unbalanced ones, are kept, so such
 * a path is then refused as it stands. Main stores the root this way, and the New workspace dialog compares with it
 * (OXE-367), so a pasted path in quotes finds the workspace already open.
 */
export function normalizeWorkspaceRoot(rootPath: string): string {
  const trimmed = rootPath.trim()
  const quoted = trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === '\'') && trimmed.at(-1) === trimmed[0]
  return quoted ? trimmed.slice(1, -1).trim() : trimmed
}

/** Separator style and trailing slashes only. Never case — see the note above. */
export function normalizeRootPath(value: string): string {
  const unified = value.replace(/\\/g, '/').replace(/\/+$/, '')
  // A root of `/` normalises to the empty string, which would collide with
  // every other empty-ish value. Keep the separator in that one case.
  return unified || '/'
}

export function isCaseInsensitiveFs(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/** Comparable key for grouping workspaces by folder. */
export function rootPathKey(value: string, platform: string): string {
  const normalized = normalizeRootPath(value)
  return isCaseInsensitiveFs(platform) ? normalized.toLowerCase() : normalized
}

export function isSameRootPath(a: string, b: string, platform: string): boolean {
  return rootPathKey(a, platform) === rootPathKey(b, platform)
}
