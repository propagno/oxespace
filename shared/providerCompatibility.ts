/**
 * The nightly provider contract check (.github/workflows/provider-contract.yml) publishes its summary,
 * and Settings compares it with the CLI installed here.
 */
export interface ProviderCompatibility {
  checkedAt: string | null
  ok: boolean
  providers: Record<string, { versions: Record<string, string | null>; ok: boolean }>
}

export type CompatibilityState = 'verified' | 'newer' | 'failing' | 'unknown'
export interface CompatibilityBadge { state: CompatibilityState; label: string; title: string }

const parse = (value: string | null | undefined): number[] | null => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value ?? '')
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}
const compare = (a: number[], b: number[]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const when = (checkedAt: string | null): string => {
  if (!checkedAt) return 'in the last check'
  const date = new Date(checkedAt)
  return Number.isNaN(date.getTime()) ? 'in the last check' : `on ${date.toISOString().slice(0, 10)}`
}

/** How the installed CLI stands against the last nightly check, for the providers the check covers. */
export function compatibilityBadge(provider: string, installed: string | undefined, summary: ProviderCompatibility | null): CompatibilityBadge | null {
  const entry = summary?.providers[provider]
  if (!summary || !entry) return null
  const checked = Object.values(entry.versions).map(parse).filter((value): value is number[] => value !== null).sort(compare).at(-1)
  const checkedLabel = checked ? checked.join('.') : 'an unknown version'
  if (!entry.ok) return { state: 'failing', label: 'Contract check failing', title: `The OXESpace check against ${checkedLabel} failed ${when(summary.checkedAt)}; Thread mode may not work with that version.` }
  const local = parse(installed)
  if (!local || !checked) return { state: 'unknown', label: 'Not checked', title: `Checked ${checkedLabel} ${when(summary.checkedAt)}; the installed version could not be read.` }
  if (compare(local, checked) > 0) return { state: 'newer', label: 'Newer than checked', title: `Installed ${local.join('.')} is newer than ${checkedLabel}, the version OXESpace checked ${when(summary.checkedAt)}.` }
  return { state: 'verified', label: 'Checked', title: `OXESpace checked Thread mode against ${checkedLabel} ${when(summary.checkedAt)}.` }
}
