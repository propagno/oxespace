import { vi } from 'vitest'

/** Stands in for main's app:open-external (window.oxe.app.openExternal); every link that leaves the app calls it. */
export function stubOpenExternal(opened = true): ReturnType<typeof vi.fn<(url: string) => Promise<{ opened: boolean }>>> {
  const openExternal = vi.fn(async (_url: string) => ({ opened }))
  const current = (window as unknown as { oxe?: Record<string, unknown> }).oxe ?? {}
  ;(window as unknown as { oxe: unknown }).oxe = { ...current, app: { ...(current.app as object | undefined), openExternal } }
  return openExternal
}
