/* T-147: one thread that shows every part of an OxeChat conversation, the way Claude Code and Codex desktop
   run: thinking, todos, a subagent, web and MCP calls, an approved plan, command and edit approvals, a
   background shell, a retried API error, compaction, a queued message, and a pending interactive question. */
import type { ConvItem, Task } from './types'

export const T147: Task = {
  id: 't147', key: 'T-147', title: 'Add a Pix refund endpoint', project: 'api', prov: 'claude', model: 'Opus 5.5', effort: 'High', access: 'edit',
  status: 'needs', branch: 'oxe/t147-pix-refunds', worktree: true, started: '14:46', mins: 9, cost: 0.61, ctx: [38, '76k', '200k'],
  counts: { terminal: 0, queries: 0, requests: 0, containers: 0, changes: 5, pr: 0 }, now: 'Waiting for your answer: 2 questions', gate: null, ask: 'q147'
}

export const T147_CONV: ConvItem[] = [
  { you: 'Add POST /charges/:id/refunds for Pix devolução. Partial refunds are allowed, within 90 days of payment. The PSP docs are in the screenshot.', at: '14:46', images: ['psp-devolucao.png'] },
  { think: [14, 'The PSP calls it "devolução" and identifies each one by an e2eid plus our own id. Partial refunds are fine as long as the sum stays at or below the original amount. I need to know how charges and settlements are stored before designing a refunds table, so I\'ll send an explore agent first and read the PSP docs in parallel.'] },
  { todos: [['done', 'Read the PSP refund docs'], ['done', 'Find how charges and settlements are stored'], ['run', 'Design the refunds table and endpoint'], ['todo', 'Write the endpoint with validation'], ['todo', 'Tests: partial, full, over the limit, after 90 days'], ['todo', 'Open a pull request']] },
  { sub: { name: 'Explore', task: 'Find how charges and settlements are stored', secs: 41, rows: [['read', 'Search', '"settled_at" in src/', '12 matches'], ['read', 'Read', 'src/db/schema/charges.sql', '64 lines'], ['read', 'Read', 'src/settlements/batch.ts', '188 lines'], ['read', 'Search', '"refund" in src/', '0 matches']], result: 'Charges keep amount_cents and settled_at. Settlements batch by merchant at 02:00. There is no refunds table and no refund code yet.' } },
  { tools: [['read', 'Fetch', 'developers.pix-psp.com.br/api/v2/devolucao', '200 · 18 kB'], ['read', 'MCP', 'linear · get_issue CAJ-412', 'Pix refunds for merchants'], ['read', 'Read', 'psp-devolucao.png', 'image · 1280×720']] },
  { plan: { steps: ['Migration: refunds (id, charge_id, amount_cents, e2eid, status, requested_at)', 'POST /charges/:id/refunds: amount optional (defaults to what is left), 90-day check, sum check in one transaction', 'Call the PSP PUT /pix/{e2eid}/devolucao/{id}; store the PSP status', 'Webhook: mark the refund DEVOLVIDO or NAO_REALIZADO', 'Tests for partial, full, over the limit and after 90 days'], state: 'approved', at: '14:49' } },
  { cmd: { cmd: 'npm run db:migrate', cwd: 'cajui-api (worktree)', why: 'Create the refunds table in the local database.', state: 'once', at: '14:50' } },
  { tools: [['edit', 'Create', 'migrations/0044_refunds.sql', '+16'], ['run', 'Shell', 'npm run db:migrate', 'exit 0 · 1 migration'], ['edit', 'Create', 'src/refunds/create.ts', '+72']] },
  { agent: 'The refund runs inside one transaction that locks the charge, so two refunds sent at the same time can\'t go over the original amount:', at: '14:52',
    code: ['ts', 'src/refunds/create.ts', 'export async function createRefund(chargeId: string, amountCents?: number) {\n  return db.tx(async tx => {\n    const charge = await tx.one(SQL`SELECT * FROM charges WHERE id = ${chargeId} FOR UPDATE`)\n    if (daysSince(charge.settled_at) > 90) throw new HttpError(422, \'refund_window_closed\')\n    const left = charge.amount_cents - await refundedCents(tx, chargeId)\n    const amount = amountCents ?? left\n    if (amount <= 0 || amount > left) throw new HttpError(422, \'refund_exceeds_charge\')\n    return tx.refunds.insert({ charge_id: chargeId, amount_cents: amount, status: \'EM_PROCESSAMENTO\' })\n  })\n}'] },
  { edit: { path: 'src/charges/routes.ts', diff: '@@ -41,6 +41,9 @@ router.post(\'/charges\', createCharge)\n router.get(\'/charges/:id\', getCharge)\n+router.post(\'/charges/:id/refunds\', requireScope(\'refunds:write\'),\n+  validate(RefundBody), createRefundHandler)\n+router.get(\'/charges/:id/refunds\', listRefunds)\n router.delete(\'/charges/:id\', cancelCharge)', state: 'allowed', at: '14:53' } },
  { bg: { id: 'bg1', cmd: 'npm run dev', started: '14:53', lines: ['> cajui-api@2026.11.2 dev', '> tsx watch src/server.ts', '✓ server listening on :3002', '[14:54:10] POST /charges/ch_9Qx/refunds 201 (31 ms)', '[14:54:12] POST /charges/ch_9Qx/refunds 422 refund_exceeds_charge'] } },
  { tools: [['run', 'Request', 'POST localhost:3002/charges/ch_9Qx/refunds', '201 · 31 ms'], ['run', 'Request', 'POST localhost:3002/charges/ch_9Qx/refunds (again)', '422 · 12 ms']] },
  { agent: 'I also left a backfill script for staging outside the repository, so it can\'t be committed by mistake. The steps are in the runbook:', at: '14:54', paths: ['~/cajui-scripts/refunds-0311/backfill-refunds.js', 'ROTEIRO.md', 'src/refunds/create.ts', 'gravar-poc-prd.js'] },
  { retry: 'Claude\'s API was overloaded (529). Retried after 8 s; attempt 2 of 5 worked.' },
  { compact: 'Older turns were compacted to make room: 151k → 76k tokens. The plan, todos and files are kept.' },
  { agent: 'The endpoint works locally: the first refund returns 201 and a second one over the remaining amount returns 422. Two product questions before I write the tests:', at: '14:55' },
  { ask: 'q147' }
]

export const QUESTIONS = {
  q147: [
    { q: 'A refund request is larger than what is left on the charge. What should happen?', multi: false, opts: [['Reject it with 422', 'The merchant sends a new request with the right amount. Recommended.'], ['Refund what is left', 'Silently lower the amount to the remainder.'], ['Ask the merchant to confirm', 'Return 409 with the remainder; they resend with confirm=true.']] },
    { q: 'Which events should notify the merchant?', multi: true, opts: [['Refund requested', 'When we accept the request.'], ['Refund completed', 'When the PSP says DEVOLVIDO.'], ['Refund failed', 'When the PSP says NAO_REALIZADO.']] }
  ] as { q: string; multi: boolean; opts: [string, string][] }[]
}
