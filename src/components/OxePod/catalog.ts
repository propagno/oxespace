import { i18n, loadNamespace, useNamespace } from '../../i18n'

/** OxePod's text outside components (store, palette, toasts), in the language on screen when it is called. */
export const tp = i18n.getFixedT(null, 'pods')

let loading: Promise<void> | null = null

/** Loads OxePod's catalog; it is not part of the boot bundle. */
export function loadPodsCatalog(): Promise<void> {
  return (loading ??= loadNamespace('pods'))
}

/** The view and the sidebar call this first, so the first render waits (in App's Suspense) for the catalog. */
export function usePodsCatalog(): void {
  useNamespace('pods')
}
