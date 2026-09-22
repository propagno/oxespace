import { describe, expect, test } from 'vitest'
import { branchSlug, checkoutDirectoryName, renderDelegationBranch, validateExplicitBranchName } from '../electron/main/services/delegation/delegation-branch'

describe('delegation branch contract', () => {
  test('preserves exact explicit branch names', () => {
    expect(renderDelegationBranch({ strategy: 'existing', name: 'feature/CARD-142-login' }, { objective: 'ignored', taskId: '1234567890' }).branch)
      .toBe('feature/CARD-142-login')
    expect(renderDelegationBranch({ strategy: 'create', name: 'hotfix/auth.v2' }, { objective: 'ignored', taskId: '1234567890' }).branch)
      .toBe('hotfix/auth.v2')
  })

  test('renders generic local templates without a work-manager dependency', () => {
    const value = renderDelegationBranch({ strategy: 'generated', template: 'work/{reference}/{slug}-{shortId}-{date}', reference: 'CARD 142', workLabel: 'Fix OAuth callback' },
      { objective: 'ignored', taskId: 'ABCDEF123456', now: new Date(2026, 8, 21) })
    expect(value.branch).toBe('work/card-142/fix-oauth-callback-abcdef12-20260921')
  })

  test('fails closed for missing placeholders and invalid refs', () => {
    expect(() => renderDelegationBranch({ strategy: 'generated', template: 'work/{reference}/{slug}' }, { objective: 'Task', taskId: '12345678' }))
      .toThrow('BRANCH_REFERENCE_REQUIRED')
    expect(() => renderDelegationBranch({ strategy: 'generated', template: 'work/{unknown}' }, { objective: 'Task', taskId: '12345678' }))
      .toThrow('UNKNOWN_BRANCH_PLACEHOLDER')
    for (const invalid of ['bad branch', '../escape', 'feature//name', 'feature/name.lock', ' feature/name ', '-flag', '@']) expect(() => validateExplicitBranchName(invalid)).toThrow('INVALID_BRANCH_REF')
  })

  test('creates filesystem-safe checkout labels', () => {
    expect(branchSlug('Correção: autenticação')).toBe('correcao-autenticacao')
    expect(checkoutDirectoryName('feature/CARD-142', 'ABCDEF1234')).toBe('feature-card-142-abcdef12')
  })
})
