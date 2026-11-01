/**
 * F7.3's temporary exception to the perceived-perf gate (e2e/perceived-perf.spec.ts): OxeChat (Thread) cold first
 * content is advisory (a warning annotation, never a failure) on every CI run, main included, and blocking on release
 * tags. On main too since SRE-01: a main that is always red on this one known check would hide a new regression.
 * Keyed on the ref, not on the event (the merge train dispatches ci.yml on the PR's branch). Outside CI (no
 * GITHUB_REF) it blocks. Past `expires` the whole gate fails everywhere until the fix lands and this goes.
 */
export const PERF_ADVISORY = { item: 'F7.3', label: 'OxeChat (Thread) cold: first content', expires: '2026-11-07' } as const

/** Whether this run is a release (a tag) or not on CI: there every check blocks. */
export function blockingRef(ref: string | undefined): boolean {
  if (!ref) return true
  return ref.startsWith('refs/tags/')
}

/** Whether a failed check with this label only warns on this run. `env` is the run's environment (process.env by default). */
export function perfAdvisoryApplies(label: string, env: { GITHUB_REF?: string } = process.env): boolean {
  return label.startsWith(PERF_ADVISORY.label) && !blockingRef(env.GITHUB_REF)
}
