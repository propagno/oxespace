/**
 * F8 A30: prefilled safe git branch name for branching a conversation from a checkpoint (`oxe/<slug>-from-HHMM`,
 * ASCII lowercase, at most 60 characters, always a valid git ref).
 */
const MAX_BRANCH_LENGTH = 60

export function branchNameFor(title: string, at: number): string {
  const date = new Date(Number.isFinite(at) ? at : 0)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const prefix = 'oxe/'
  const suffix = `-from-${hh}${mm}`
  const maxSlug = MAX_BRANCH_LENGTH - prefix.length - suffix.length

  const ascii = (title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const base = /[a-z]/.test(ascii) ? ascii : 'conversation'
  const slug = base.slice(0, maxSlug).replace(/-+$/g, '') || 'conversation'
  return `${prefix}${slug}${suffix}`
}
