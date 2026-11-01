// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest } from '../../shared/types/approvals'

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showMessageBox: vi.fn(async () => { throw new Error('the dialog could not be shown') }) }
}))
vi.mock('../../electron/main/i18n', () => ({ mainLanguage: () => 'en', tMain: (key: string) => key }))

describe('the native fallback (B7.4 review L2)', () => {
  it('answers nothing when the dialog fails, so a failure is never the person\'s Deny', async () => {
    const { nativeApproval } = await import('../../electron/main/services/approvals/native-approval')
    const request = {
      schemaVersion: 1, id: 'r', generation: 1, kind: 'policyChange', risk: 'high',
      requester: { kind: 'app', id: 'oxespace', label: { code: 'approvals.requester.app', params: {} } },
      title: { code: 'approvals.title.policyChange', params: {} }, summary: { code: 'approvals.summary.policyChange.widened', params: { file: 'f' } },
      appNotes: [], agentText: { text: '', untrusted: true, length: 0, truncated: false },
      options: [{ id: 'deny', label: { code: 'approvals.option.deny', params: {} }, intent: 'deny' }], defaultOptionId: 'deny',
      ackRequired: true, allowDelayMs: 0, enterDisabled: false, createdAt: 0, expiresAt: 1
    } as unknown as ApprovalRequest
    await expect(nativeApproval(request, 'no-window', new AbortController().signal)).resolves.toBeNull()
  })
})
