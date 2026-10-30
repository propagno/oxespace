import { describe, it } from 'vitest'

/**
 * B10 · Main-process routing of approvals (contract: shared/types/approvals.ts). Pending until the B10 impl PR; they run
 * under `npm run test:electron` with a live BrowserWindow and `dialog.showMessageBox` stubbed to throw, so any native
 * dialog while the window exists fails the test.
 */
describe('B10 impl · no native dialog while an app window exists (pending)', () => {
  it.todo('B10 impl: ApprovalBroker for an agent action (AgentActions confirm) emits approvals:requested and never calls showMessageBox')
  it.todo('B10 impl: ApprovalBroker for OxeQuery (agent-gateway approve) emits approvals:requested and never calls showMessageBox')
  it.todo('B10 impl: preview automation closeTab (preview-automation.ts:70) emits approvals:requested and never calls showMessageBox')
  it.todo('B10 impl: preview automation click/fill/navigate/scroll (preview-automation.ts:172) emits approvals:requested and never calls showMessageBox')
  it.todo('B10 impl: an uncaught main error (index.ts:98) emits a crash request with ackRequired; an ack within APPROVAL_ACK_TIMEOUT_MS keeps it in the window')
})

describe('B10 impl · native fallback (pending)', () => {
  it.todo('B10 impl: with every window destroyed, each path above asks with showMessageBox exactly once')
  it.todo('B10 impl: a crash request the window never acknowledges goes to showMessageBox after 3,000 ms')
  it.todo('B10 impl: approvals.unavailable for one request opens showMessageBox exactly once for it; the other pending requests stay in the window')
  it.todo('B10 impl: the native answer after approvals.unavailable follows the single-response and generation rules (a later respond is refused alreadyAnswered)')
  it.todo('B10 impl: a repeated approvals.unavailable is refused alreadyReported; one for a stale generation is refused staleGeneration')
  it.todo('B10 impl: the renderer-gone notice (index.ts:892) stays native: the renderer that would show the modal is gone')
})
