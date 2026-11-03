import { useCallback, useEffect, useState } from 'react'
import { i18n } from '../i18n'
import { toast } from '../ui'

/**
 * T52 · A module the first frame does not need, loaded right after it (on mount) instead of in the renderer entry. Null
 * until it arrives. If the import fails (a chunk missing after an update, a disk error), the person is told in words,
 * with a way to try again, and the rest of the app keeps working.
 */
export function useDeferredModule<M>(load: () => Promise<M>, missing: () => string = () => i18n.t('deferred.partMissing', { ns: 'common' })): M | null {
  const [module, setModule] = useState<M | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    let alive = true
    load().then(
      loaded => { if (alive) setModule(() => loaded) },
      () => {
        if (!alive) return
        toast({
          title: i18n.t('errors.generic', { ns: 'common' }),
          description: missing(),
          intent: 'warning',
          action: { label: i18n.t('ui.tryAgain', { ns: 'common' }), run: retry }
        })
      }
    )
    return () => { alive = false }
    // `load` is a module-level import thunk; a new attempt is the only reason to run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])
  return module
}
