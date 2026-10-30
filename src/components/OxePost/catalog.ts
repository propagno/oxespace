import { use } from 'react'
import { currentLanguage, i18n, loadNamespace } from '../../i18n'

/** OxePost's text outside components (store, palette, toasts), in the language on screen when it is called. */
export const tpost = i18n.getFixedT(null, 'post')

let loading: Promise<void> | null = null

/** Loads OxePost's catalog; it is not part of the boot bundle. */
export function loadPostCatalog(): Promise<void> {
  return (loading ??= loadNamespace('post'))
}

/** The view and the sidebar call this first, so the first render waits (in App's Suspense) for the catalog. */
export function usePostCatalog(): void {
  if (!i18n.hasResourceBundle(currentLanguage(), 'post')) use(loadPostCatalog())
}
