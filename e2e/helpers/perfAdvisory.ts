/**
 * F7.3's temporary exception to the perceived-perf gate (e2e/perceived-perf.spec.ts): OxeChat (Thread) cold first
 * content is advisory (a warning annotation, never a failure) on every CI run that is not for main or a release tag,
 * and blocking on main and tags. Keyed on the ref, not on the event: the merge train dispatches ci.yml with
 * workflow_dispatch on the PR's branch, whose event is not `pull_request`. Outside CI (no GITHUB_REF) it blocks.
 */
export const PERF_ADVISORY = { item: 'F7.3', label: 'OxeChat (Thread) cold: first content', expires: '2026-11-07' } as const

/** Whether this run is for main or a release: there every check blocks. */
export function blockingRef(ref: string | undefined): boolean {
  if (!ref) return true
  return ref === 'refs/heads/main' || ref.startsWith('refs/tags/')
}

/** Whether a failed check with this label only warns on this run. `env` is the run's environment (process.env by default). */
export function perfAdvisoryApplies(label: string, env: { GITHUB_REF?: string } = process.env): boolean {
  return label.startsWith(PERF_ADVISORY.label) && !blockingRef(env.GITHUB_REF)
}
