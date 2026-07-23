import { describe, expect, test } from 'vitest'
import { analyzeQualitySnapshot } from '../../electron/main/services/quality-controller.service'

describe('Quality Controller', () => {
  test('fails when a changed contract leaves exact-reference consumers outside the diff', () => {
    const report = analyzeQualitySnapshot({
      changedFiles: ['shared/types/ipc.ts', 'src/new-feature.ts'],
      contents: new Map([
        ['shared/types/ipc.ts', 'export interface SemanticReport { expanded: boolean }'],
        ['src/new-feature.ts', 'export function createSemanticReport() {}']
      ]),
      references: new Map([
        ['SemanticReport', ['src/consumer.ts', 'tests/consumer.test.ts']],
        ['createSemanticReport', []]
      ])
    })
    expect(report.verdict).toBe('fail')
    expect(report.impactedFiles).toEqual(['src/consumer.ts', 'tests/consumer.test.ts'])
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONTRACT_CONSUMERS_UNCHANGED', severity: 'high' })
    ]))
  })

  test('traces acceptance evidence and passes a focused source + test change', () => {
    const report = analyzeQualitySnapshot({
      changedFiles: ['src/login.ts', 'tests/login.test.ts'],
      contents: new Map([
        ['src/login.ts', 'export function enableLoginButton(valid: boolean) { return valid }'],
        ['tests/login.test.ts', 'test("enables login button for valid credentials", () => {})']
      ]),
      references: new Map([['enableLoginButton', []]]),
      acceptanceCriteria: ['Login button becomes enabled for valid credentials']
    })
    expect(report.verdict).toBe('pass')
    expect(report.evidence.acceptanceCriteria[0].status).toBe('evidenced')
  })

  test('requires database verification evidence for migrations', () => {
    const report = analyzeQualitySnapshot({
      changedFiles: ['electron/main/db/migrations/044_new.sql'],
      contents: new Map([['electron/main/db/migrations/044_new.sql', 'ALTER TABLE example ADD COLUMN value TEXT;']]),
      references: new Map()
    })
    expect(report.verdict).toBe('fail')
    expect(report.findings.some((finding) => finding.code === 'MIGRATION_WITHOUT_TEST')).toBe(true)
  })
})
