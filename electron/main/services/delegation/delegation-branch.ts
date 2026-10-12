import type { DelegationBranchIntent } from '../../../../shared/types/delegation'

const DEFAULT_TEMPLATE = 'oxe/{slug}-{shortId}'
const PLACEHOLDERS = new Set(['reference', 'slug', 'shortId', 'date'])

export function branchSlug(value: string, max = 48): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.\/-]+|[.\/-]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, max) || 'task'
}

export function validateExplicitBranchName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 240) throw new Error('BRANCH_NAME_REQUIRED')
  const value = name
  if (value !== value.trim() || value.startsWith('-') || value === '@') throw new Error(`INVALID_BRANCH_REF: ${value}`)
  if (/\s|[~^:?*\\\[\]]|\.\.|@\{|\/\/|^\/|\/$|^\.|\.$|\.lock(?:\/|$)/.test(value)) {
    throw new Error(`INVALID_BRANCH_REF: ${value}`)
  }
  if (value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.'))) throw new Error(`INVALID_BRANCH_REF: ${value}`)
  return value
}

export function renderDelegationBranch(
  intent: DelegationBranchIntent | undefined,
  input: { objective: string; taskId: string; now?: Date }
): { intent: DelegationBranchIntent; branch: string } {
  const normalized: DelegationBranchIntent = intent ?? { strategy: 'generated' }
  if (typeof normalized !== 'object' || Array.isArray(normalized) || Object.keys(normalized).some(key => !['strategy', 'name', 'baseRef', 'remote', 'fetchBase', 'reuseExistingWorktree', 'reference', 'workLabel', 'template'].includes(key))) throw new Error('INVALID_BRANCH_INTENT')
  if (!['existing', 'create', 'generated'].includes(normalized.strategy)) throw new Error('INVALID_BRANCH_STRATEGY')
  for (const field of ['name', 'baseRef', 'remote', 'reference', 'workLabel', 'template'] as const) {
    const value = normalized[field]
    if (value !== undefined && (typeof value !== 'string' || value.length > 240 || value.includes('\0'))) throw new Error(`INVALID_BRANCH_${field.toUpperCase()}`)
  }
  for (const field of ['fetchBase', 'reuseExistingWorktree'] as const) {
    if (normalized[field] !== undefined && typeof normalized[field] !== 'boolean') throw new Error(`INVALID_BRANCH_${field.toUpperCase()}`)
  }
  if (normalized.strategy !== 'generated') {
    return { intent: normalized, branch: validateExplicitBranchName(normalized.name) }
  }

  const template = normalized.template?.trim() || DEFAULT_TEMPLATE
  const unknown = [...template.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).filter(name => !PLACEHOLDERS.has(name))
  if (unknown.length) throw new Error(`UNKNOWN_BRANCH_PLACEHOLDER: ${unknown[0]}`)
  const requiredReference = template.includes('{reference}')
  const reference = normalized.reference?.trim()
  if (requiredReference && !reference) throw new Error('BRANCH_REFERENCE_REQUIRED')
  const now = input.now ?? new Date()
  const values: Record<string, string> = {
    reference: reference ? branchSlug(reference, 64) : '',
    slug: branchSlug(normalized.workLabel?.trim() || input.objective),
    shortId: input.taskId.slice(0, 8).toLowerCase(),
    date: [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('')
  }
  const branch = template.replace(/\{([^{}]+)\}/g, (_match, name: string) => values[name] ?? '')
  return { intent: normalized, branch: validateExplicitBranchName(branch) }
}

export function checkoutDirectoryName(branch: string, taskId: string): string {
  return `${branchSlug(branch.replaceAll('/', '-'), 72)}-${taskId.slice(0, 8).toLowerCase()}`
}
