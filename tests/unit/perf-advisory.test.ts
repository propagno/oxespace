import { describe, expect, it } from 'vitest'
import { PERF_ADVISORY, blockingRef, perfAdvisoryApplies } from '../../e2e/helpers/perfAdvisory'

const oxeChat = `${PERF_ADVISORY.label} against the 335 ms baseline`

describe('the F7.3 perf advisory (e2e/perceived-perf.spec.ts)', () => {
  it('warns on any run that is not for main or a tag: a pull request, and the merge train dispatching a PR branch', () => {
    expect(perfAdvisoryApplies(oxeChat, { GITHUB_REF: 'refs/pull/358/merge' })).toBe(true)
    expect(perfAdvisoryApplies(oxeChat, { GITHUB_REF: 'refs/heads/feat/f6-i18n-complete' })).toBe(true)
    expect(perfAdvisoryApplies(oxeChat, { GITHUB_REF: 'refs/heads/perf/bisect-main-preload-off' })).toBe(true)
  })

  it('blocks on main, on release tags and outside CI', () => {
    expect(perfAdvisoryApplies(oxeChat, { GITHUB_REF: 'refs/heads/main' })).toBe(false)
    expect(perfAdvisoryApplies(oxeChat, { GITHUB_REF: 'refs/tags/v1.4.0' })).toBe(false)
    expect(perfAdvisoryApplies(oxeChat, {})).toBe(false)
    expect(blockingRef('')).toBe(true)
    // A branch merely named like main is not main.
    expect(perfAdvisoryApplies(oxeChat, { GITHUB_REF: 'refs/heads/main-fix' })).toBe(true)
  })

  it('covers only OxeChat cold first content; every other check blocks everywhere', () => {
    for (const label of ['OxeChat (Thread) warm: first content against the 22 ms baseline', 'OxeQuery cold: first content against the 335 ms baseline', 'OxeChat (Thread) cold: first feedback', 'OxeChat (Thread) cold: main region blank']) {
      expect(perfAdvisoryApplies(label, { GITHUB_REF: 'refs/pull/1/merge' })).toBe(false)
    }
  })
})
