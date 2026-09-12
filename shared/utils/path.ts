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
