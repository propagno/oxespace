/* Where each task's changes live. In real use one task can touch several checkouts: its own worktree, the main
   checkout, another worktree a terminal switched, and folders outside any repository. Changes are grouped by
   place, each against the base the task started from, not against whatever HEAD is now. */
import type { FileChange } from './types'

export interface Place {
  id: string; kind: 'worktree' | 'main' | 'checkout' | 'outside'; path: string; branch?: string
  base?: string; head?: string; drift?: { from: string; to: string; pane?: string; at: string; dirty?: boolean; kept: boolean; switchFiles: FileChange[] }; files: FileChange[]
}

export const PLACES: Record<string, Place[]> = {
  t143: [
    { id: 'w', kind: 'worktree', path: '~/.oxespace/worktrees/cajui-api/t143', branch: 'oxe/t143-invoice-report', base: '9bb5339', head: 'mig-prd @ a12f0c4',
      drift: { from: 'oxe/t143-invoice-report @ 3e81d2a', to: 'mig-prd @ a12f0c4', pane: 'report', at: '14:31', dirty: true, kept: true, switchFiles: [{ path: 'migrations/0039_prd_flags.sql', add: 12, del: 0, isNew: true, hunks: [['a', 'INSERT INTO flags (key, enabled) VALUES (\'simulador-rebate\', false);']] }, { path: 'src/flags/defaults.ts', add: 3, del: 1, hunks: [['d', 'export const DEFAULTS = { rebate: true }'], ['a', 'export const DEFAULTS = { rebate: false, simulador: false }']] }] }, files: [] }
  ],
  t147: [
    { id: 'w', kind: 'worktree', path: '~/.oxespace/worktrees/cajui-api/t147', branch: 'oxe/t147-pix-refunds', base: '9bb5339', head: 'oxe/t147-pix-refunds @ 5c0e9b1', files: [] },
    { id: 'c', kind: 'checkout', path: '~/code/cajui/cajui-ops', branch: 'main', base: '71bd02e', head: 'main @ 71bd02e', files: [
      { path: 'jobs/refunds-backfill.yaml', add: 18, del: 0, isNew: true, hunks: [['a', 'name: refunds-backfill'], ['a', 'schedule: "once"'], ['a', 'env: staging'], ['a', 'command: node ~/cajui-scripts/refunds-0311/backfill-refunds.js --dry-run']] }
    ] },
    { id: 'o', kind: 'outside', path: '~/cajui-scripts/refunds-0311', files: [
      { path: 'ROTEIRO.md', add: 22, del: 0, isNew: true, hunks: [['a', '# Refund backfill, staging only'], ['a', '1. node precheck-refunds.js  (read only)'], ['a', '2. node backfill-refunds.js --dry-run'], ['a', '3. node backfill-refunds.js --apply   # asks first']] },
      { path: 'backfill-refunds.js', add: 64, del: 0, isNew: true, hunks: [['a', 'const DRY = !process.argv.includes(\'--apply\')'], ['a', 'for (const row of await openRefunds()) {'], ['a', '  if (DRY) console.log(\'would refund\', row.id, row.amount_cents)'], ['a', '  else await api.post(`/charges/${row.charge_id}/refunds`, { amount: row.amount_cents })'], ['a', '}']] }
    ] }
  ]
}

export const T147_CHANGES: FileChange[] = [
  { path: 'migrations/0044_refunds.sql', add: 16, del: 0, isNew: true, hunks: [['a', 'CREATE TABLE refunds ('], ['a', '  id text PRIMARY KEY,'], ['a', '  charge_id text NOT NULL REFERENCES charges(id),'], ['a', '  amount_cents integer NOT NULL CHECK (amount_cents > 0),'], ['a', '  e2eid text, status text NOT NULL,'], ['a', '  requested_at timestamptz NOT NULL DEFAULT now()'], ['a', ');']] },
  { path: 'src/refunds/create.ts', add: 72, del: 0, isNew: true, hunks: [['a', 'export async function createRefund(chargeId: string, amountCents?: number) {'], ['a', '  return db.tx(async tx => {'], ['a', '    const charge = await tx.one(SQL`SELECT * FROM charges WHERE id = ${chargeId} FOR UPDATE`)'], ['a', '    if (daysSince(charge.settled_at) > 90) throw new HttpError(422, \'refund_window_closed\')']] },
  { path: 'src/charges/routes.ts', add: 3, del: 0, hunks: [['c', 'router.get(\'/charges/:id\', getCharge)'], ['a', 'router.post(\'/charges/:id/refunds\', requireScope(\'refunds:write\'),'], ['a', '  validate(RefundBody), createRefundHandler)'], ['a', 'router.get(\'/charges/:id/refunds\', listRefunds)']] }
]
