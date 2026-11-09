import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { Button, ErrorState, LoadingState, Notice, copyText } from '../../ui'
import type { ThreadPathResolution, ThreadPlace, ThreadPlaceReadResult, ThreadPlaces } from '../../../shared/types/thread-places'

/** A16/A17 on the window bridge: main resolves a path the conversation named and reads a file of a place, read only. */
export interface ThreadPlaceApi {
  places?(id: string): Promise<ThreadPlaces>
  resolvePath?(id: string, raw: string, at?: { turnId?: string }): Promise<ThreadPathResolution>
  placeRead?(id: string, placeId: string, relativePath: string): Promise<ThreadPlaceReadResult>
}

export function placeApi(): ThreadPlaceApi | undefined {
  return (window as unknown as { oxe?: { thread?: ThreadPlaceApi } }).oxe?.thread
}

const slashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** `path` relative to the place's folder, forward slashes; null when it is not under it. Windows roots ignore case. */
export function relativeToPlace(root: string, path: string): string | null {
  const base = slashes(root), full = slashes(path)
  const caseless = /^[a-z]:\//i.test(base) || base.startsWith('//')
  const key = (value: string): string => caseless ? value.toLowerCase() : value
  if (!base || !key(full).startsWith(`${key(base)}/`)) return null
  return full.slice(base.length + 1) || null
}

/** The place's folder and a path relative to it, with the folder's own separator. */
export function joinPlace(root: string, relativePath: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/[\\/]/g, separator)}`
}

/**
 * A17: a file of an outside (or another repository's) place, shown read only. There is no editable surface and no
 * Save, Rename or Open in editor: the band says where the file is, and Copy path is the one action.
 */
export function OutsideFileTab({ threadId, placeId, relativePath }: { threadId: string; placeId: string; relativePath: string }): ReactElement {
  const { t } = useTranslation('thread')
  const [state, setState] = useState<{ file?: ThreadPlaceReadResult; place?: ThreadPlace | null; failed?: boolean }>({})
  useEffect(() => {
    let live = true
    const api = placeApi()
    const read = api?.placeRead ? api.placeRead(threadId, placeId, relativePath) : Promise.reject(new Error('thread.place.unavailable'))
    void Promise.all([api?.places ? api.places(threadId).catch(() => null) : Promise.resolve(null), read]).then(
      ([places, file]) => { if (live) setState({ file, place: places?.places.find(entry => entry.id === placeId) ?? null }) },
      () => { if (live) setState({ failed: true }) }
    )
    return () => { live = false }
  }, [threadId, placeId, relativePath])
  const absolute = state.place ? joinPlace(state.place.path, state.file?.relativePath ?? relativePath) : relativePath
  const band = state.place?.kind === 'checkout' ? t('outsideFile.bandCheckout', { path: absolute }) : t('outsideFile.band', { path: absolute })
  return <section className="thread-outside-file" aria-label={t('outsideFile.label', { path: absolute })}>
    <Notice intent="info" actions={<Button size="sm" variant="ghost" icon={<Copy size={12} aria-hidden="true" />}
      onClick={() => void copyText(absolute, t('outsideFile.path'), t('outsideFile.pathCopied'))}>{t('outsideFile.copyPath')}</Button>}>{band}</Notice>
    {state.failed
      ? <ErrorState compact title={t('outsideFile.failed', { path: relativePath })} />
      : state.file
        ? <pre className="thread-outside-file-content" tabIndex={0}><code>{state.file.content}</code></pre>
        : <LoadingState label={t('outsideFile.loading', { path: relativePath })} />}
  </section>
}
