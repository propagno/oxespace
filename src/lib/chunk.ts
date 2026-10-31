import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** A lazily loaded module (or set of modules) that is requested once and remembered once it has arrived. */
export interface Chunk<M> {
  /** Starts loading (once; a failed load can be retried) and resolves with the module. */
  load: () => Promise<M>
  /** The module, when it has already arrived. */
  get: () => M | undefined
}

export function chunk<M>(load: () => Promise<M>): Chunk<M> {
  let module: M | undefined
  let pending: Promise<M> | undefined
  return {
    load: () => pending ??= load().then(value => (module = value), error => { pending = undefined; throw error }),
    get: () => module
  }
}

/**
 * React.lazy over a shared chunk. Components picked from the same chunk resolve in the same tick, so a view whose
 * sidebar and work area load together reveals them in one commit (React holds a revealed fallback about 300 ms; two
 * boundaries resolving apart can pay that twice). When the chunk has already arrived (preloaded at idle), the
 * component renders at once without suspending: the thenable handed to React resolves synchronously.
 */
export function lazyFrom<M, P extends object>(source: Chunk<M>, pick: (module: M) => ComponentType<P>): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => {
    const ready = source.get()
    if (ready) return { then: (resolve: (value: { default: ComponentType<P> }) => void) => resolve({ default: pick(ready) }) } as unknown as Promise<{ default: ComponentType<P> }>
    return source.load().then(module => ({ default: pick(module) }))
  })
}
