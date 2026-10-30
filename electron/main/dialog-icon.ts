import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'

/**
 * The app icon for native error dialogs. Loaded when a dialog needs it (index.ts imports this on demand), once.
 *
 * Packaged, the icons sit in the resources folder (electron-builder extraResources); in a dev run, in the
 * repository's resources/. The brand set (resources/icons/<size>.png) comes first when it is there; then the
 * single icon each platform ships (icon.png; icon.ico on Windows, which only ships that one). A missing or
 * unreadable file gives an empty image, and the dialog then shows without an icon rather than failing.
 */
export function dialogIconCandidates(input: { platform: NodeJS.Platform; packaged: boolean; resourcesPath: string; appPath: string }): string[] {
  const base = input.packaged ? input.resourcesPath : join(input.appPath, 'resources')
  const files = [join('icons', '256x256.png'), 'icon.png', ...(input.platform === 'win32' ? ['icon.ico'] : [])]
  return files.map(file => join(base, file))
}

/** The first candidate that loads, or undefined. `load` is nativeImage.createFromPath outside tests. */
export function loadDialogIcon(candidates: readonly string[], load: (path: string) => NativeImage): NativeImage | undefined {
  for (const path of candidates) {
    try {
      const image = load(path)
      if (!image.isEmpty()) return image
    } catch { /* try the next one */ }
  }
  return undefined
}

let cached: NativeImage | undefined | null = null

export function dialogIcon(): NativeImage | undefined {
  if (cached === null) {
    cached = loadDialogIcon(dialogIconCandidates({ platform: process.platform, packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }), path => nativeImage.createFromPath(path))
  }
  return cached
}

/** Options for an error dialog with the app icon when one loads. */
export function withDialogIcon<T extends Electron.MessageBoxOptions>(options: T): T {
  const icon = dialogIcon()
  return icon ? { ...options, icon } : options
}
