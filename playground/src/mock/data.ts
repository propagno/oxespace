/* OXESpace 1.5.0 playground: mock data for one fictional company, Cajuí Pagamentos (a Pix payments startup).
   Everything here is invented. Nothing is read from a real profile, database or network. */
import type { Project, Provider, Task, ConvItem, Approval, Checkpoint, Connection, Query, Collection, Env, Req, Container, Term, FileChange, PR, Notice } from './types'

export const D = (function () {
  const company = { name: 'Cajuí Pagamentos', ws: 'cajui', user: 'Marina Sá' }
  const projects: Record<string, Project> = {
    api: { id: 'api', name: 'cajui-api', path: '~/code/cajui/cajui-api', stack: 'TypeScript · Node 22 · Postgres 16', branch: 'main', remote: 'github.com/cajui/cajui-api' },
    web: { id: 'web', name: 'cajui-web', path: '~/code/cajui/cajui-web', stack: 'Next.js 15 · React 19', branch: 'main', remote: 'github.com/cajui/cajui-web' },
    infra: { id: 'infra', name: 'cajui-infra', path: '~/code/cajui/cajui-infra', stack: 'Docker Compose · Terraform', branch: 'main', remote: 'github.com/cajui/cajui-infra' }
  }
  const providers: Record<string, Provider> = {
    claude: { id: 'claude', name: 'Claude Code', initial: 'C', account: 'marina@cajui.com.br', plan: 'Max', models: ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'], efforts: ['Low', 'Medium', 'High', 'Max'], status: 'ok', caps: { canSteer: true } },
    codex: { id: 'codex', name: 'Codex', initial: 'X', account: 'marina@cajui.com.br', plan: 'Pro', models: ['GPT-5 Codex', 'GPT-5', 'GPT-5 mini'], efforts: ['Low', 'Medium', 'High'], status: 'ok', caps: { canSteer: true } }
  }

  /* Tasks. In 1.5.0 (lite B) one task is one conversation; its tabs come from that conversation's agent activity. */
  const tasks: Task[] = [
    { id: 't143', key: 'T-143', title: 'Find why the monthly invoice report takes 40 s', project: 'api', prov: 'codex', model: 'GPT-5 Codex', effort: 'High', access: 'edit',
      status: 'needs', branch: 'oxe/t143-invoice-report', worktree: true, started: '14:05', mins: 37, cost: 0.84, costEst: true, ctx: [41, '82k', '200k'],
      counts: { terminal: 2, queries: 5, requests: 0, containers: 0, changes: 2, pr: 0 }, gate: 'ap_sql', now: 'Waiting for you: update 1,284 rows' },
    { id: 't144', key: 'T-144', title: 'Test Pix webhooks against the sandbox', project: 'api', prov: 'claude', model: 'Sonnet 5.5', effort: 'Medium', access: 'edit',
      status: 'needs', branch: 'oxe/t144-pix-webhooks', worktree: true, started: '14:11', mins: 31, cost: 0.37, ctx: [28, '56k', '200k'],
      counts: { terminal: 1, queries: 0, requests: 6, containers: 3, changes: 3, pr: 0 }, gate: 'ap_down', now: 'Waiting for you: remove a volume' },
    { id: 't142', key: 'T-142', title: 'Make charge creation idempotent', project: 'api', prov: 'claude', model: 'Opus 5.5', effort: 'High', access: 'edit',
      status: 'run', branch: 'oxe/t142-idempotent-charges', worktree: true, started: '13:58', mins: 44, cost: 1.92, ctx: [62, '124k', '200k'],
      counts: { terminal: 2, queries: 1, requests: 0, containers: 1, changes: 4, pr: 0 }, now: 'Running the charges tests' },
    { id: 't141', key: 'T-141', title: 'Add CSV export to the statements page', project: 'web', prov: 'claude', model: 'Sonnet 5.5', effort: 'Medium', access: 'edit',
      status: 'review', branch: 'oxe/t141-statements-csv', worktree: true, started: '11:20', mins: 52, cost: 0.71, ctx: [33, '66k', '200k'],
      counts: { terminal: 1, queries: 0, requests: 2, containers: 0, changes: 5, pr: 1 }, pr: 318, now: 'Pull request #318 is ready for review' },
    { id: 't145', key: 'T-145', title: 'Move docker-compose to Postgres 17', project: 'infra', prov: 'codex', model: 'GPT-5', effort: 'Medium', access: 'edit',
      status: 'err', branch: 'oxe/t145-pg17', worktree: true, started: '13:30', mins: 12, cost: 0.22, costEst: true, ctx: [18, '36k', '200k'],
      counts: { terminal: 1, queries: 0, requests: 0, containers: 1, changes: 1, pr: 0 }, now: 'Stopped: postgres-17 exited with code 1' },
    { id: 't139', key: 'T-139', title: 'Fix the login redirect loop on expired sessions', project: 'web', prov: 'claude', model: 'Opus 5.5', effort: 'High', access: 'edit',
      status: 'done', branch: 'oxe/t139-login-loop', worktree: false, started: '09:12', mins: 26, cost: 0.58, ctx: [21, '42k', '200k'],
      counts: { terminal: 1, queries: 0, requests: 1, containers: 0, changes: 2, pr: 1 }, pr: 315, now: 'Merged #315 at 10:04' },
    { id: 't138', key: 'T-138', title: 'Explain the settlement batch job', project: 'api', prov: 'claude', model: 'Haiku 5.5', effort: 'Low', access: 'read',
      status: 'done', branch: 'main', worktree: false, started: 'Yesterday', mins: 8, cost: 0.03, ctx: [9, '18k', '200k'],
      counts: { terminal: 0, queries: 2, requests: 0, containers: 0, changes: 0, pr: 0 }, now: 'Answered' },
    { id: 't137', key: 'T-137', title: 'Rate-limit the public status endpoint', project: 'api', prov: 'codex', model: 'GPT-5 Codex', effort: 'Medium', access: 'edit',
      status: 'done', branch: 'oxe/t137-rate-limit', worktree: false, started: 'Mon', mins: 19, cost: 0.31, costEst: true, ctx: [14, '28k', '200k'],
      counts: { terminal: 1, queries: 0, requests: 3, containers: 0, changes: 3, pr: 1 }, pr: 309, now: 'Merged #309' }
  ]

  /* Conversations. Tool rows: [kind, verb, target, meta, detail]. kind = read | edit | run | fail | done */
  const conv: Record<string, ConvItem[]> = {
    t143: [
      { you: 'The monthly invoice report on staging takes about 40 s for March. Find out why and fix it. You can run queries on billing-staging; ask me before anything that writes.', at: '14:05' },
      { tools: [['read', 'Read', 'src/reports/invoice-report.ts', '212 lines'], ['read', 'Search', '"invoice_items" in src/', '9 matches'], ['read', 'Read', 'src/db/schema/invoices.sql', '88 lines']] },
      { agent: 'The report runs one query per invoice to load its items, so March (1,284 invoices) makes 1,285 round trips. I\'ll confirm with the query plan before changing anything.', at: '14:08' },
      { tools: [['run', 'Query', 'billing-staging · EXPLAIN ANALYZE … invoice_items', '38.2 s · seq scan', 'Seq Scan on invoice_items (cost=0.00..48211.20 rows=1902114)\n  Filter: (invoice_id = $1)\n  Rows Removed by Filter: 1901930\nPlanning Time: 0.21 ms\nExecution Time: 29.7 ms   × 1,284 calls'], ['read', 'Query', 'billing-staging · indexes on invoice_items', '1 row'], ['run', 'Shell', 'npm run report:invoice -- --month 2026-03', 'exit 0 · 40.6 s']] },
      { agent: 'Two problems:<ol><li><b>N+1 queries.</b> Items are loaded per invoice inside a loop.</li><li><b>No index on <code>invoice_items.invoice_id</code>.</b> Each of those queries scans 1.9 M rows.</li></ol>I changed the report to load all items in one query and added a migration with the index. Locally the report now takes <b>1.3 s</b>.', at: '14:21' },
      { tools: [['edit', 'Edit', 'src/reports/invoice-report.ts', '+24 −31'], ['edit', 'Create', 'migrations/0043_invoice_items_invoice_id_idx.sql', '+3'], ['run', 'Shell', 'npm test -- reports', '14 passed · 3.1 s'], ['fail', 'Shell', 'npm run lint', '1 error', 'src/reports/invoice-report.ts:58:9  error  \'items\' is never reassigned. Use \'const\'  prefer-const'], ['edit', 'Edit', 'src/reports/invoice-report.ts', '+1 −1'], ['run', 'Shell', 'npm run lint', 'exit 0']] },
      { agent: 'While checking March I found 1,284 invoices on staging still marked <code>status = \'open\'</code> although their charges settled. The report counts them as unpaid. I want to mark them <code>paid</code> so staging matches production before you compare the numbers.', at: '14:38' },
      { gate: 'ap_sql' }
    ],
    t142: [
      { you: 'Charges created twice when the mobile app retries on a timeout. Make POST /charges idempotent with the Idempotency-Key header. Keep the API response the same.', at: '13:58', files: ['incident-2211.md'] },
      { tools: [['read', 'Read', 'src/charges/create.ts', '146 lines'], ['read', 'Read', 'incident-2211.md', '41 lines'], ['read', 'Search', '"Idempotency-Key" in src/', '0 matches'], ['read', 'Read', 'src/db/schema/charges.sql', '64 lines']] },
      { agent: 'Plan: store each key with a hash of the request body for 24 h. A retry with the same key and body returns the first response; the same key with a different body gets <code>409 Conflict</code>. The check and the insert run in one transaction so two parallel retries can\'t both create a charge.', at: '14:02' },
      { you: 'Go. 24 h is right. A replay must return the first response with the same status code.', at: '14:03' },
      { tools: [['edit', 'Create', 'migrations/0042_idempotency_keys.sql', '+14'], ['edit', 'Create', 'src/charges/idempotency.ts', '+64'], ['edit', 'Edit', 'src/charges/create.ts', '+38 −12'], ['run', 'Shell', 'npm run db:migrate', 'exit 0 · 1 migration']] },
      { agent: 'Done: the migration, the key store and the check in <code>create.ts</code>. A replay returns the stored body and status.', at: '14:19' },
      { you: 'Add a test where two retries with the same key arrive at the same time.', at: '14:20' },
      { tools: [['edit', 'Create', 'test/charges/create.idempotency.test.ts', '+51'], ['fail', 'Shell', 'npm test -- charges', '1 failed · 23 passed', 'FAIL test/charges/create.idempotency.test.ts\n  ✕ parallel retries create one charge (412 ms)\n    Expected: 1\n    Received: 2'], ['read', 'Read', 'src/charges/idempotency.ts', 'lines 20–48'], ['edit', 'Edit', 'src/charges/idempotency.ts', '+6 −2', 'Lock the key row with SELECT … FOR UPDATE before checking it.']] },
      { agent: 'The parallel test caught a race: both retries read "no key yet" before either inserted it. I now lock the key row with <code>SELECT … FOR UPDATE</code> inside the transaction. Running the suite again.', at: '14:40' },
      { tools: [['run', 'Shell', 'npm test -- charges', 'running', '', true]] }
    ],
    t144: [
      { you: 'Test our Pix webhook handler against the PSP sandbox. Use the docker-compose stack; don\'t touch production.', at: '14:11' },
      { tools: [['run', 'Container', 'docker compose up -d api postgres pix-mock', '3 started'], ['read', 'Read', 'src/webhooks/pix.ts', '118 lines'], ['run', 'Request', 'POST sandbox.pix-psp.com.br/v2/cob', '201 · 412 ms'], ['run', 'Request', 'POST localhost:3000/webhooks/pix', '200 · 38 ms']] },
      { agent: 'Happy path works: the sandbox charge settles and our handler marks it paid. Now the failure cases: duplicate delivery, a bad signature and a late webhook.', at: '14:19' },
      { tools: [['run', 'Request', 'POST localhost:3000/webhooks/pix (duplicate)', '200 · 22 ms'], ['fail', 'Request', 'POST localhost:3000/webhooks/pix (bad signature)', '500 · 9 ms', 'TypeError: Cannot read properties of undefined (reading \'split\')\n    at verifySignature (src/webhooks/signature.ts:14:31)'], ['edit', 'Edit', 'src/webhooks/signature.ts', '+7 −2'], ['run', 'Request', 'POST localhost:3000/webhooks/pix (bad signature)', '401 · 6 ms'], ['fail', 'Request', 'POST api.cajui.com.br/webhooks/pix', 'blocked by policy', 'Blocked: api.cajui.com.br is a production host. Policy allows sandbox and localhost only.']] },
      { agent: 'A missing signature header crashed the handler with a 500; it now answers 401. I tried to compare against production and the policy blocked it, as it should. To rerun from a clean database I need to remove the <code>pix-mock-data</code> volume.', at: '14:36' },
      { gate: 'ap_down' }
    ],
    t141: [
      { you: 'Add a "Download CSV" button to the statements page. Same columns as the table, dates in ISO, amounts with a dot.', at: '11:20' },
      { tools: [['read', 'Read', 'app/statements/page.tsx', '190 lines'], ['edit', 'Create', 'app/statements/export-csv.ts', '+48'], ['edit', 'Edit', 'app/statements/page.tsx', '+19 −2'], ['run', 'Shell', 'npm test', '61 passed']] },
      { agent: 'Done. The button streams the CSV, so 50k rows don\'t freeze the page. I opened <b>pull request #318</b>; checks are green and Rafael is asked to review.', at: '12:12' }
    ],
    t145: [
      { you: 'Move our docker-compose Postgres from 16 to 17 and check the API still starts.', at: '13:30' },
      { tools: [['edit', 'Edit', 'docker-compose.yml', '+1 −1'], ['run', 'Container', 'docker compose up -d postgres', 'started'], ['fail', 'Container', 'postgres-17', 'exited (1)', 'FATAL:  database files are incompatible with server\nDETAIL:  The data directory was initialized by PostgreSQL version 16, which is not compatible with this version 17.4.']] },
      { err: 'Codex stopped: postgres-17 exited with code 1. The data volume was created by Postgres 16. Upgrading needs pg_upgrade or a fresh volume.' }
    ],
    t139: [
      { you: 'Users with an expired session loop between /login and /dashboard. Fix it.', at: '09:12' },
      { tools: [['read', 'Read', 'middleware.ts', '64 lines'], ['edit', 'Edit', 'middleware.ts', '+9 −4'], ['run', 'Shell', 'npm test', '58 passed']] },
      { agent: 'The middleware treated an expired cookie as "logged in" while the page treated it as "logged out". It now clears the cookie and redirects once. Merged as <b>#315</b>.', at: '10:04' }
    ],
    t138: [
      { you: 'How does the settlement batch job decide which charges to settle?', at: 'Yesterday' },
      { agent: 'It runs at 02:00 and picks charges with <code>status = \'paid\'</code> and <code>settled_at IS NULL</code> older than D+1, grouped by merchant…', at: 'Yesterday' }
    ],
    t137: [{ you: 'Rate-limit GET /status to 60 requests a minute per IP.', at: 'Mon' }, { agent: 'Added a token bucket in Redis. Merged as #309.', at: 'Mon' }]
  }

  const approvals: Record<string, Approval> = {
    ap_sql: { id: 'ap_sql', task: 't143', kind: 'db', title: 'Update 1,284 invoices on billing-staging', verb: 'Run an UPDATE on billing-staging',
      why: 'Codex wants staging invoices to match their settled charges before comparing the report with production.',
      where: 'billing-staging', whereSub: 'Postgres 16 · staging', rows: '1,284', rowsSub: 'invoices', undo: false, undoSub: 'No snapshot yet', irreversible: true, risk: 'high',
      sql: 'UPDATE invoices i\n   SET status = \'paid\', paid_at = c.settled_at\n  FROM charges c\n WHERE c.invoice_id = i.id\n   AND c.status = \'settled\'\n   AND i.status = \'open\'\n   AND i.issued_at >= \'2026-03-01\'\n   AND i.issued_at <  \'2026-04-01\';',
      cols: ['id', 'customer', 'amount', 'status', 'paid_at'],
      sample: [['inv_8F2KQ', 'Padaria Boa Vista', 'R$ 1.240,00', ['open', 'paid'], ['—', '2026-03-04 10:12']], ['inv_8F2KR', 'Ótica Central', 'R$ 389,90', ['open', 'paid'], ['—', '2026-03-04 11:47']], ['inv_8F2M1', 'Studio Pilates Lis', 'R$ 2.100,00', ['open', 'paid'], ['—', '2026-03-05 09:03']], ['inv_8F2M7', 'Mercadinho São José', 'R$ 76,40', ['open', 'paid'], ['—', '2026-03-05 16:20']], ['inv_8F2N2', 'Clínica Sorriso', 'R$ 950,00', ['open', 'paid'], ['—', '2026-03-06 08:31']]],
      snapshot: 'OXESpace copies the 1,284 rows into its own snapshot store first (about 2 s), not into your database. Restore them from Checkpoints.' },
    ap_down: { id: 'ap_down', task: 't144', kind: 'box', title: 'Remove the pix-mock-data volume', verb: 'Run docker compose down -v',
      why: 'Sonnet wants to rerun the webhook tests from an empty mock database.',
      where: 'Local Docker', whereSub: 'cajui-api compose stack', rows: '3 + 1', rowsSub: 'containers + volume', undo: false, undoSub: 'Volume data is deleted', irreversible: true, risk: 'medium',
      sql: 'docker compose -f docker-compose.yml down -v\n# stops api, postgres, pix-mock\n# deletes volume pix-mock-data',
      lang: 'shell', snapshot: null },
    ap_fresh: { id: 'ap_fresh', task: 't145', kind: 'box', title: 'Recreate the pg-data volume for Postgres 17', verb: 'Run docker compose down -v, then up', why: 'The data volume was created by Postgres 16. A fresh one lets Postgres 17 start; the local data in it is lost.',
      where: 'Local Docker', whereSub: 'cajui-infra compose stack', rows: '1', rowsSub: 'volume', undo: false, undoSub: 'Volume data is deleted', irreversible: true, risk: 'medium', sql: 'docker compose down -v postgres\ndocker compose up -d postgres', lang: 'shell', snapshot: null },
    ap_push: { id: 'ap_push', task: 't142', kind: 'net', title: 'Push oxe/t142-idempotent-charges to origin', verb: 'Run git push',
      why: 'Opus finished the change and wants to open a pull request.',
      where: 'github.com/cajui/cajui-api', whereSub: 'new branch', rows: '6', rowsSub: 'commits', undo: true, undoSub: 'Delete the remote branch', irreversible: false, risk: 'low',
      sql: 'git push -u origin oxe/t142-idempotent-charges', lang: 'shell', snapshot: null }
  }

  const checkpoints: Record<string, Checkpoint[]> = {
    t142: [
      { n: 0, at: '13:58', label: 'Charges created twice when the mobile app retries on a ti…', files: 0 },
      { n: 1, at: '14:03', label: 'Go. 24 h is right. A replay must return the first respons…', files: 0 },
      { n: 2, at: '14:20', label: 'Add a test where two retries with the same key arrive at…', files: 3, state: 'failed' }
    ],
    t143: [{ n: 0, at: '14:05', label: 'The monthly invoice report on staging takes about 40 s fo…', files: 0 }],
    t144: [{ n: 0, at: '14:11', label: 'Test our Pix webhook handler against the PSP sandbox. Use…', files: 0 }]
  }

  /* OxeQuery */
  const connections: Connection[] = [
    { id: 'billing-staging', name: 'billing-staging', engine: 'Postgres 16.4', env: 'staging', host: 'staging-db.cajui.internal:5432', db: 'billing', agent: 'confirm', status: 'ok', tables: 42 },
    { id: 'billing-prod', name: 'billing-prod (replica)', engine: 'Postgres 16.4', env: 'production', host: 'prod-replica.cajui.internal:5432', db: 'billing', agent: 'off', status: 'ok', tables: 42 },
    { id: 'local', name: 'local', engine: 'Postgres 16.4 · Docker', env: 'local', host: 'localhost:5432', db: 'cajui_dev', agent: 'write', status: 'ok', tables: 39 },
    { id: 'analytics', name: 'analytics', engine: 'ClickHouse 24.8', env: 'production', host: 'ch.cajui.internal:8443', db: 'events', agent: 'read', status: 'err', tables: 0 }
  ]
  const tables = ['charges', 'customers', 'idempotency_keys', 'invoice_items', 'invoices', 'merchants', 'payouts', 'pix_keys', 'refunds', 'settlements', 'webhook_deliveries']
  const queries: Query[] = [
    { id: 'q1', task: 't143', by: 'codex', conn: 'billing-staging', at: '14:09:12', ms: 38204, rows: 1, kind: 'read', status: 'ok',
      sql: 'EXPLAIN ANALYZE\nSELECT * FROM invoice_items\n WHERE invoice_id = \'inv_8F2KQ\';', cols: ['QUERY PLAN'], data: [['Seq Scan on invoice_items  (cost=0.00..48211.20 rows=148 width=96) (actual time=0.031..29.702 rows=184 loops=1)'], ['  Filter: (invoice_id = \'inv_8F2KQ\'::text)'], ['  Rows Removed by Filter: 1901930'], ['Planning Time: 0.214 ms'], ['Execution Time: 29.744 ms']] },
    { id: 'q2', task: 't143', by: 'codex', conn: 'billing-staging', at: '14:10:40', ms: 41, rows: 1, kind: 'read', status: 'ok',
      sql: 'SELECT indexname, indexdef\n  FROM pg_indexes\n WHERE tablename = \'invoice_items\';', cols: ['indexname', 'indexdef'], data: [['invoice_items_pkey', 'CREATE UNIQUE INDEX invoice_items_pkey ON invoice_items USING btree (id)']] },
    { id: 'q3', task: 't143', by: 'codex', conn: 'billing-staging', at: '14:33:05', ms: 212, rows: 1, kind: 'read', status: 'ok',
      sql: 'SELECT count(*)\n  FROM invoices i JOIN charges c ON c.invoice_id = i.id\n WHERE c.status = \'settled\' AND i.status = \'open\'\n   AND i.issued_at >= \'2026-03-01\' AND i.issued_at < \'2026-04-01\';', cols: ['count'], data: [['1284']] },
    { id: 'q4', task: 't143', by: 'codex', conn: 'billing-staging', at: '14:34:51', ms: 96, rows: 5, kind: 'read', status: 'ok',
      sql: 'SELECT i.id, m.name AS customer, i.amount, i.status, c.settled_at\n  FROM invoices i\n  JOIN charges c ON c.invoice_id = i.id\n  JOIN merchants m ON m.id = i.merchant_id\n WHERE c.status = \'settled\' AND i.status = \'open\'\n LIMIT 5;',
      cols: ['id', 'customer', 'amount', 'status', 'settled_at'], data: [['inv_8F2KQ', 'Padaria Boa Vista', '1240.00', 'open', '2026-03-04 10:12:08'], ['inv_8F2KR', 'Ótica Central', '389.90', 'open', '2026-03-04 11:47:31'], ['inv_8F2M1', 'Studio Pilates Lis', '2100.00', 'open', '2026-03-05 09:03:12'], ['inv_8F2M7', 'Mercadinho São José', '76.40', 'open', '2026-03-05 16:20:44'], ['inv_8F2N2', 'Clínica Sorriso', '950.00', 'open', '2026-03-06 08:31:09']] },
    { id: 'q5', task: 't143', by: 'codex', conn: 'billing-staging', at: '14:38:02', ms: 0, rows: 1284, kind: 'write', status: 'pending',
      sql: 'UPDATE invoices i SET status = \'paid\', paid_at = c.settled_at FROM charges c WHERE …', cols: [], data: [] },
    { id: 'q6', task: 't142', by: 'claude', conn: 'local', at: '14:24:47', ms: 18, rows: 0, kind: 'ddl', status: 'ok',
      sql: 'CREATE TABLE idempotency_keys (\n  key text PRIMARY KEY,\n  request_hash text NOT NULL,\n  response jsonb,\n  created_at timestamptz NOT NULL DEFAULT now()\n);', cols: [], data: [] },
    { id: 'q7', task: 't138', by: 'claude', conn: 'billing-prod', at: 'Yesterday 16:02', ms: 0, rows: 0, kind: 'read', status: 'denied',
      sql: 'SELECT merchant_id, count(*) FROM charges WHERE settled_at IS NULL GROUP BY 1;', cols: [], data: [], note: 'Agent access is off for billing-prod.' }
  ]

  /* OxePost */
  const collections: Collection[] = [
    { id: 'pix', name: 'Pix PSP sandbox', agent: 'confirm', reqs: ['r1', 'r2', 'r6'] },
    { id: 'hooks', name: 'Our webhooks (local)', agent: 'write', reqs: ['r3', 'r4', 'r5'] },
    { id: 'public', name: 'Public API v2', agent: 'read', reqs: ['r7', 'r8'] }
  ]
  const envs: Env[] = [
    { id: 'sandbox', name: 'sandbox', vars: [['base_url', 'https://sandbox.pix-psp.com.br'], ['client_id', 'cajui-sbx-7731'], ['client_secret', '•••• (PIX_SBX_SECRET)']] },
    { id: 'local', name: 'local', vars: [['base_url', 'http://localhost:3000'], ['webhook_secret', '•••• (WEBHOOK_SECRET)']] },
    { id: 'prod', name: 'production', vars: [['base_url', 'https://api.cajui.com.br'], ['token', '•••• (CAJUI_PROD_TOKEN)']], locked: true }
  ]
  const requests: Record<string, Req> = {
    r1: { id: 'r1', name: 'Create charge (cob)', method: 'POST', url: '{{base_url}}/v2/cob', env: 'sandbox', task: 't144', by: 'claude', at: '14:13:40', status: 201, ms: 412, size: '1.2 kB',
      reqBody: '{\n  "calendario": { "expiracao": 3600 },\n  "valor": { "original": "149.90" },\n  "chave": "pix@cajui.com.br",\n  "solicitacaoPagador": "Pedido 55120"\n}',
      resBody: '{\n  "txid": "7f3c2a9be1d84c0f9a11",\n  "status": "ATIVA",\n  "valor": { "original": "149.90" },\n  "location": "sandbox.pix-psp.com.br/qr/v2/7f3c2a9b",\n  "criacao": "2026-11-03T14:13:40Z"\n}',
      headers: [['Authorization', 'Bearer •••• (PIX_SBX_SECRET)'], ['Content-Type', 'application/json']], resHeaders: [['content-type', 'application/json'], ['x-request-id', 'sbx-9a1f-22c0']] },
    r2: { id: 'r2', name: 'Get charge', method: 'GET', url: '{{base_url}}/v2/cob/7f3c2a9be1d84c0f9a11', env: 'sandbox', task: 't144', by: 'claude', at: '14:15:02', status: 200, ms: 188, size: '0.9 kB', reqBody: '', resBody: '{\n  "txid": "7f3c2a9be1d84c0f9a11",\n  "status": "CONCLUIDA"\n}', headers: [['Authorization', 'Bearer •••• (PIX_SBX_SECRET)']], resHeaders: [['content-type', 'application/json']] },
    r3: { id: 'r3', name: 'Deliver webhook', method: 'POST', url: '{{base_url}}/webhooks/pix', env: 'local', task: 't144', by: 'claude', at: '14:16:11', status: 200, ms: 38, size: '64 B', reqBody: '{\n  "pix": [{ "txid": "7f3c2a9be1d84c0f9a11", "valor": "149.90", "horario": "2026-11-03T14:16:09Z" }]\n}', resBody: '{ "ok": true }', headers: [['x-psp-signature', '•••• (WEBHOOK_SECRET)']], resHeaders: [] },
    r4: { id: 'r4', name: 'Deliver webhook (bad signature)', method: 'POST', url: '{{base_url}}/webhooks/pix', env: 'local', task: 't144', by: 'claude', at: '14:31:20', status: 401, ms: 6, size: '41 B', reqBody: '{ "pix": [] }', resBody: '{ "error": "invalid_signature" }', headers: [], resHeaders: [] },
    r5: { id: 'r5', name: 'Deliver webhook (duplicate)', method: 'POST', url: '{{base_url}}/webhooks/pix', env: 'local', task: 't144', by: 'claude', at: '14:22:40', status: 200, ms: 22, size: '28 B', reqBody: '{ "pix": [{ "txid": "7f3c2a9be1d84c0f9a11" }] }', resBody: '{ "ok": true, "duplicate": true }', headers: [], resHeaders: [] },
    r6: { id: 'r6', name: 'Compare with production', method: 'POST', url: 'https://api.cajui.com.br/webhooks/pix', env: 'prod', task: 't144', by: 'claude', at: '14:33:58', status: 0, ms: 0, size: '—', blocked: true, reqBody: '{ "pix": [] }', resBody: '', headers: [], resHeaders: [] },
    r7: { id: 'r7', name: 'List merchants', method: 'GET', url: '{{base_url}}/v2/merchants?limit=20', env: 'local', status: 200, ms: 54, size: '7.8 kB', reqBody: '', resBody: '{ "data": [ … 20 merchants … ], "next": "m_2Xk" }', headers: [], resHeaders: [] },
    r8: { id: 'r8', name: 'Status', method: 'GET', url: '{{base_url}}/status', env: 'local', status: 200, ms: 4, size: '52 B', reqBody: '', resBody: '{ "status": "ok", "version": "2026.11.2" }', headers: [], resHeaders: [] }
  }

  /* OxePod */
  const containers: Container[] = [
    { id: 'api', name: 'cajui-api-dev', image: 'node:22.11-alpine', status: 'running', up: '31 min', cpu: '4.2%', mem: '212 MB', ports: '3000→3000', stack: 'cajui-api', task: 't144' },
    { id: 'pg', name: 'postgres', image: 'postgres:16.4', status: 'running', up: '31 min', cpu: '1.1%', mem: '96 MB', ports: '5432→5432', stack: 'cajui-api', task: 't144', vol: 'pg-data' },
    { id: 'mock', name: 'pix-mock', image: 'wiremock/wiremock:3.9.1', status: 'running', up: '31 min', cpu: '0.6%', mem: '188 MB', ports: '8089→8080', stack: 'cajui-api', task: 't144', vol: 'pix-mock-data' },
    { id: 'redis', name: 'redis', image: 'redis:7.4', status: 'running', up: '3 h', cpu: '0.3%', mem: '9 MB', ports: '6379→6379', stack: 'cajui-api', task: 't142' },
    { id: 'pg17', name: 'postgres-17', image: 'postgres:17.4', status: 'exited', up: 'Exited (1) 12 min ago', cpu: '—', mem: '—', ports: '5433→5432', stack: 'cajui-infra', task: 't145', vol: 'pg-data' }
  ]
  const logs: Record<string, string[]> = {
    api: ['14:11:02  info  server listening on :3000', '14:13:41  info  POST /v2/cob → sandbox 201 (412 ms)', '14:16:11  info  webhook pix txid=7f3c2a9b… settled', '14:22:40  info  webhook pix txid=7f3c2a9b… duplicate, ignored', '14:31:19  error TypeError: Cannot read properties of undefined (reading \'split\')', '14:31:19  error     at verifySignature (src/webhooks/signature.ts:14:31)', '14:31:52  info  restarted after file change', '14:32:04  warn  webhook pix rejected: invalid_signature', '14:41:57  info  GET /status 200 (4 ms)'],
    pg17: ['2026-11-03 13:41:02 UTC [1] LOG:  starting PostgreSQL 17.4', '2026-11-03 13:41:02 UTC [1] FATAL:  database files are incompatible with server', '2026-11-03 13:41:02 UTC [1] DETAIL:  The data directory was initialized by PostgreSQL version 16, which is not compatible with this version 17.4.']
  }

  /* Terminals (OxeCode panes) */
  const terms: Record<string, Term[]> = {
    t142: [{ id: 'k1', name: 'tests', shell: 'bash', cwd: '~/.oxespace/worktrees/cajui-api/t142', by: 'agent', lines: [['$ ', 'npm test -- charges'], ['', ''], ['', ' PASS  test/charges/create.test.ts (1.9 s)'], ['', ' PASS  test/charges/refund.test.ts'], ['dim', ' RUNS  test/charges/create.idempotency.test.ts'], ['', ''], ['dim', 'Tests:       23 passed, 1 running']] },
      { id: 'k2', name: 'api', shell: 'bash', cwd: '~/.oxespace/worktrees/cajui-api/t142', by: 'you', lines: [['$ ', 'npm run dev'], ['', '> cajui-api@2026.11.2 dev'], ['', '> tsx watch src/server.ts'], ['ok', '✓ server listening on :3001'], ['', '[14:40:12] POST /charges 201 (idempotency-key=ab12…) 18 ms'], ['', '[14:40:12] POST /charges 200 (replayed) 4 ms']] }],
    t143: [{ id: 'k3', name: 'report', shell: 'bash', cwd: '~/.oxespace/worktrees/cajui-api/t143', by: 'agent', lines: [['$ ', 'npm run report:invoice -- --month 2026-03'], ['', 'Loading invoices… 1,284'], ['', 'Loading items… 1,902,114'], ['ok', '✓ report written to out/invoice-2026-03.csv in 1.3 s'], ['$ ', 'npm run lint'], ['ok', '✓ 0 problems']] }],
    t144: [{ id: 'k4', name: 'compose', shell: 'bash', cwd: '~/.oxespace/worktrees/cajui-api/t144', by: 'agent', lines: [['$ ', 'docker compose up -d api postgres pix-mock'], ['ok', ' ✔ Container postgres   Started'], ['ok', ' ✔ Container pix-mock   Started'], ['ok', ' ✔ Container cajui-api-dev  Started']] }],
    t145: [{ id: 'k5', name: 'compose', shell: 'bash', cwd: '~/.oxespace/worktrees/cajui-infra/t145', by: 'agent', lines: [['$ ', 'docker compose up -d postgres'], ['ok', ' ✔ Container postgres-17  Started'], ['$ ', 'docker compose ps'], ['err', 'postgres-17  exited (1)']] }]
  }

  /* Changes */
  const changes: Record<string, FileChange[]> = {
    t142: [
      { path: 'src/charges/create.ts', add: 38, del: 12, hunks: [['c', 'export async function createCharge(req: ChargeRequest, key?: string) {'], ['d', '  const charge = await db.charges.insert(toRow(req))'], ['d', '  return toResponse(charge)'], ['a', '  if (!key) return toResponse(await db.charges.insert(toRow(req)))'], ['a', '  return db.tx(async tx => {'], ['a', '    const prior = await idempotency.lock(tx, key, hash(req))'], ['a', '    if (prior?.conflict) throw new HttpError(409, \'idempotency_key_reused\')'], ['a', '    if (prior?.response) return prior.response'], ['a', '    const res = toResponse(await tx.charges.insert(toRow(req)))'], ['a', '    await idempotency.save(tx, key, res)'], ['a', '    return res'], ['a', '  })'], ['c', '}']] },
      { path: 'src/charges/idempotency.ts', add: 64, del: 0, isNew: true, hunks: [['a', 'export async function lock(tx: Tx, key: string, requestHash: string) {'], ['a', '  const row = await tx.one(SQL`SELECT * FROM idempotency_keys WHERE key = ${key} FOR UPDATE`)'], ['a', '  if (!row) { await tx.insertKey(key, requestHash); return null }'], ['a', '  if (row.request_hash !== requestHash) return { conflict: true }'], ['a', '  return { response: row.response }'], ['a', '}']] },
      { path: 'migrations/0042_idempotency_keys.sql', add: 14, del: 0, isNew: true, hunks: [['a', 'CREATE TABLE idempotency_keys ('], ['a', '  key text PRIMARY KEY,'], ['a', '  request_hash text NOT NULL,'], ['a', '  response jsonb,'], ['a', '  created_at timestamptz NOT NULL DEFAULT now()'], ['a', ');']] },
      { path: 'test/charges/create.idempotency.test.ts', add: 51, del: 0, isNew: true, hunks: [['a', 'it(\'parallel retries create one charge\', async () => {'], ['a', '  const [a, b] = await Promise.all([post(key), post(key)])'], ['a', '  expect(await countCharges()).toBe(1)'], ['a', '})']] }
    ],
    t143: [
      { path: 'src/reports/invoice-report.ts', add: 24, del: 31, hunks: [['d', 'for (const inv of invoices) {'], ['d', '  inv.items = await db.query(\'SELECT * FROM invoice_items WHERE invoice_id = $1\', [inv.id])'], ['d', '}'], ['a', 'const items = await db.query(\'SELECT * FROM invoice_items WHERE invoice_id = ANY($1)\', [invoices.map(i => i.id)])'], ['a', 'const byInvoice = groupBy(items, \'invoice_id\')'], ['a', 'for (const inv of invoices) inv.items = byInvoice[inv.id] ?? []']] },
      { path: 'migrations/0043_invoice_items_invoice_id_idx.sql', add: 3, del: 0, isNew: true, hunks: [['a', 'CREATE INDEX CONCURRENTLY invoice_items_invoice_id_idx'], ['a', '  ON invoice_items (invoice_id);']] }
    ],
    t144: [{ path: 'src/webhooks/signature.ts', add: 7, del: 2, hunks: [['d', '  const [algo, sig] = header.split(\'=\')'], ['a', '  if (!header) return false'], ['a', '  const [algo, sig] = header.split(\'=\')'], ['a', '  if (algo !== \'sha256\' || !sig) return false']] }, { path: 'test/webhooks/pix.test.ts', add: 33, del: 0, isNew: true, hunks: [['a', 'it(\'rejects a missing signature with 401\', …)']] }, { path: 'docker-compose.test.yml', add: 6, del: 1, hunks: [['a', '  pix-mock:'], ['a', '    image: wiremock/wiremock:3.9.1']] }],
    t141: [{ path: 'app/statements/export-csv.ts', add: 48, del: 0, isNew: true, hunks: [['a', 'export function toCsv(rows: Statement[]) {']] }, { path: 'app/statements/page.tsx', add: 19, del: 2, hunks: [['a', '<Button onClick={download}>Download CSV</Button>']] }],
    t145: [{ path: 'docker-compose.yml', add: 1, del: 1, hunks: [['d', '    image: postgres:16.4'], ['a', '    image: postgres:17.4']] }]
  }

  const prs: Record<number, PR> = {
    318: { n: 318, task: 't141', title: 'Add CSV export to the statements page', state: 'open', base: 'main', head: 'oxe/t141-statements-csv', commits: 3, files: 5, add: 112, del: 6,
      checks: [['lint', 'pass', '38 s'], ['typecheck', 'pass', '1 m 02 s'], ['unit (node 22)', 'pass', '2 m 14 s'], ['e2e (chromium)', 'pass', '4 m 51 s'], ['visual', 'pass', '1 m 40 s'], ['deploy preview', 'pass', '2 m 03 s']],
      reviewers: [['Rafael Moura', 'requested'], ['Code owners (web)', 'requested']], body: 'Adds a **Download CSV** button to Statements.\n\n- Streams rows, so 50k rows do not block the page\n- ISO dates, dot decimals, same columns as the table\n- Tests: `export-csv.test.ts` (8 cases)' },
    315: { n: 315, task: 't139', title: 'Fix the login redirect loop on expired sessions', state: 'merged', base: 'main', head: 'oxe/t139-login-loop', commits: 2, files: 2, add: 31, del: 8, checks: [['lint', 'pass', '35 s'], ['unit (node 22)', 'pass', '2 m 01 s'], ['e2e (chromium)', 'pass', '4 m 12 s']], reviewers: [['Rafael Moura', 'approved']], body: '' }
  }

  const notifications: Notice[] = [
    { id: 'n1', kind: 'attn', task: 't143', text: 'Needs you: <b>Update 1,284 invoices on billing-staging</b> · Codex · Find why the monthly invoice report takes 40 s', at: '14:38' },
    { id: 'n2', kind: 'attn', task: 't144', text: 'Needs you: <b>Remove the pix-mock-data volume</b> · Claude · Test Pix webhooks against the sandbox', at: '14:36' },
    { id: 'n3', kind: 'err', task: 't145', text: 'Failed: <b>Move docker-compose to Postgres 17</b> · postgres-17 exited with code 1', at: '13:42' },
    { id: 'n4', kind: 'ok', task: 't141', text: 'Checks passed on <b>#318</b> Add CSV export to the statements page', at: '12:19' },
    { id: 'n5', kind: 'ok', task: 't139', text: '<b>#315</b> was merged by Rafael Moura', at: '10:04' }
  ]

  const mcp = [
    { name: 'oxespace', desc: 'OXESpace tools: panes, scripts, code search', status: 'ok', tools: 17, builtin: true },
    { name: 'github', desc: 'Issues, pull requests and checks', status: 'ok', tools: 26 },
    { name: 'linear', desc: 'Issues and cycles for the Cajuí team', status: 'ok', tools: 12 },
    { name: 'sentry', desc: 'Errors and releases', status: 'err', tools: 0, err: 'Needs sign-in again' },
    { name: 'figma', desc: 'Read frames and variables', status: 'off', tools: 8 }
  ]
  const skills = [
    { name: 'pix-rules', desc: 'Banco Central Pix rules for txid, expiry and refunds', scope: 'project', on: true },
    { name: 'migrations', desc: 'How we write and review Postgres migrations', scope: 'project', on: true },
    { name: 'release-notes', desc: 'Write release notes in our voice', scope: 'user', on: false },
    { name: 'pdf', desc: 'Read and fill PDF forms', scope: 'user', on: true }
  ]
  const devices = [{ name: 'Pixel 9 · Marina', paired: '28/10', last: 'Active now', os: 'Android 16' }, { name: 'Galaxy Tab S9', paired: '12/10', last: '3 days ago', os: 'Android 15' }]

  const tokenChanges = [
    { tok: 'accent (dark)', sw: ['#f5a939', '#49a072'], what: 'Moves from sun to caatinga 9. One accent in both modes: green means the app, or go.' },
    { tok: 'attn · attn-bg / -fg / -border', sw: ['#dd9314', '#f5a939'], what: 'New. The sertão sun means "needs you" in both modes: approvals, questions, stalled agents. Nothing else is sun.' },
    { tok: 'k-file · k-db · k-box · k-net · k-shell', sw: ['#1174b4', '#7860b5', '#00858a', '#af4a88'], what: 'New resource kinds for tabs, chips and activity bars. db, box and net are new 12-step scales (hues 295, 200, 345) from the same OKLCH generator.' },
    { tok: 'fill-selected (dark)', sw: ['#27302a', '#122c1e'], what: 'Caatinga 4 instead of neutral 5 (X7, U4). Selection is visible in dark mode.' },
    { tok: 'font-display', sw: [], what: 'Bricolage Grotesque gets a bigger role: task titles, counts and impact facts. UI text stays IBM Plex Sans 13 px; numbers use Plex Mono with tabular figures.' },
    { tok: 'motion', sw: [], what: 'Two signatures: new activity slides in (320 ms ease-out) and the sun ring pulses on anything that needs you. Both stop with reduced motion.' },
    { tok: 'hold-to-confirm', sw: [], what: 'New interaction. An irreversible approval needs a 1.2 s hold (pointer or the A key). Deny is always the default focus.' }
  ]

  return { company, projects, providers, tasks, conv, approvals, checkpoints, connections, tables, queries, collections, envs, requests, containers, logs, terms, changes, prs, notifications, mcp, skills, devices, tokenChanges }
})()
