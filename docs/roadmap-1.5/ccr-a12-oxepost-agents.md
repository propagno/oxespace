# CCR A12 (T64): agents send OxePost requests (1.5.0, phase F2)

- **Owner:** BACKEND (technical shape).
- **Product and UX:** DESIGN's spec, `docs/design/t64-oxepost-agent-access.md` (#561, approved by TECH LEAD 2026-11-03). This CCR does not change any product rule from it; where it says "decided here", that's a technical choice it left open.
- **Built by:** the OXE executor, from the F2 PLAN.json.
- **SECURITY review:** mandatory (TECH LEAD) before the execute. §9 lists what to look at.
- **Frozen test:** `tests/acceptance/f2/a12-oxepost-agents.test.ts`. It is red today because the module does not exist.
- **Reviews (M5):** DESIGN, HML and FE review the frozen test.
- **A10** reads this item's `oxepost_audit`, so PR 1 comes before A10 in the plan.

## 1. Pieces, in plan order

| PR | What | Who |
|---|---|---|
| 1 | Migration **094** (`oxepost_agent_access`, `oxepost_agent_ceiling`, `oxepost_audit`), plus `electron/main/services/oxepost/agent-access.ts` (person-only reads and writes) and `oxepost/audit.ts` | executor |
| 2 | `electron/main/services/oxepost/agent-gateway.ts` plus the MCP domain tool `oxespace_post`, the approval kind `oxepost`, and mcp-coverage | executor |
| 3 | The UI: the folder's "Agent access…" dialog, the badge, the ceiling in OxePost settings | executor (FE reviews) |

The migration takes main's highest number plus 1 when PR 1 is written. Today that's 094 (main's highest is `093_workspace_color.sql`). If another migration lands first, renumber; the gap guard refuses gaps.

## 2. Storage (migration 094)

```sql
-- Agent access per collection (a top-level folder of .oxespace/requests; '' is "Ungrouped"). No row = off.
CREATE TABLE IF NOT EXISTS oxepost_agent_access (
  workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('off', 'read', 'write')),
  environment_id TEXT,                 -- the environment the person chose for agents; NULL = none chosen, send refused
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, collection)
);
-- The most an agent may be given in an environment of each kind. Production can never be above read.
CREATE TABLE IF NOT EXISTS oxepost_agent_ceiling (
  kind TEXT PRIMARY KEY CHECK (kind IN ('ordinary', 'production')),
  access TEXT NOT NULL CHECK (access IN ('off', 'read', 'write')),
  CHECK (kind <> 'production' OR access <> 'write')
);
INSERT OR IGNORE INTO oxepost_agent_ceiling (kind, access) VALUES ('ordinary', 'write'), ('production', 'read');
-- Append-only trail of every agent request and every access change. Text is masked before it is written.
CREATE TABLE IF NOT EXISTS oxepost_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,                 -- thread:<id> | pane:<id> | agent | person (access changes)
  workspace_id TEXT,
  collection TEXT,
  request_name TEXT,
  environment TEXT,                    -- the environment's name
  method TEXT,                         -- '' for an access change
  url_path TEXT,                       -- path and query, secrets masked, credential-like query values redacted
  status INTEGER,
  text_hash TEXT,                      -- sha256 of the exact approved text
  decision TEXT NOT NULL,              -- auto | approved | approved-session | denied | refused | pending
  outcome TEXT NOT NULL,               -- ok | error | skipped
  duration_ms INTEGER,
  error_code TEXT,
  response_excerpt TEXT                -- failures only: ≤ 4096 bytes, masked; NULL otherwise and for binary bodies
);
CREATE INDEX IF NOT EXISTS idx_oxepost_audit_ts ON oxepost_audit(ts DESC);
CREATE TRIGGER IF NOT EXISTS oxepost_audit_no_update BEFORE UPDATE ON oxepost_audit
BEGIN SELECT RAISE(ABORT, 'oxepost_audit is append-only'); END;
```

- **Retention:** 90 days, pruned with the other audits (`AUDIT_RETENTION_DAYS`).
- **Effective access** = the lower of the collection's access and the ceiling for the chosen environment's kind. In a production environment a write is refused whatever the setting.
- **An access change** writes an `oxepost_audit` row: actor `person`, method `''`, url_path `Access: <old> → <new>`, decision `auto`, outcome `ok`. That's DESIGN's "Access changed" line. A10 reads it as actor kind `person`.
- **Decided here:** the access is keyed on the workspace and the folder name, not stored in `.oxespace/requests`. A file in the repo could be committed by anyone; a person's grant must not come from a clone.

## 3. The agent tool: `oxespace_post` (domain tool)

| Action | Level | Input | Output |
|---|---|---|---|
| `requests` | read | `workspace?` (defaults to the caller's) | `{ collections: [...] }`, one entry per enabled collection: `{ collection, access, environment: { name, production } \| null, requests: [{ path, name, method, url }], variables: string[], secrets: string[] }`. `url` is the saved template with `{{names}}` unresolved. Names only, never values. |
| `send` | confirm | `workspace?`, `collection`, then either `path` (a saved request) or `method` + `url` (a new request); optional `variables: Record<string,string>`, `headers: [{name, value}]`, `body` | `{ status, statusText, ms, size, headers, body, truncated, binary, contentType, url }`, all masked (§5), body capped at 64 KB for the agent, behind the untrusted-output notice |

- **An HTTP error status is a result, not a refusal:** a 4xx or 5xx response is returned to the agent, and its audit row has `outcome: 'error'`, `error_code: 'http-<status>'`, and the masked `response_excerpt`. A network, TLS or timeout failure throws with `SendError`'s code (`network`, `tls`, `timeout`), and its message is masked.
- **Gateway dependencies** (the frozen test injects them all): `{ db, rootOf(workspaceId), secrets: { values(root, environmentId) }, broker: { require(key, scope, request) }, fetchImpl, lookup(host): Promise<string[]>, log(line), now? }`. `handle('oxespace_post', args, actor: AgentActor)` resolves with the result or throws `AgentToolError` with the codes in §4. Person-only, in `agent-access.ts`: `setAgentAccess(db, { workspaceId, collection, access, environmentId })` and `setAgentCeiling(db, kind, access)`.
- **There is no action** to read or change access, the ceiling, environments, secrets or saved requests. An unknown action is refused (`invalid`).
- **Argument names** pass `FORBIDDEN_ARGUMENT` and the action names pass `FORBIDDEN_NAME` (so no `access` action and no `secret` argument).
- **Input caps:**
  - `variables`: ≤ 64 entries, names `^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`, values ≤ 2000 characters, no NUL;
  - `headers`: ≤ 32;
  - `body`: ≤ 1 MB;
  - `url`: ≤ 2048.
- **`variables`** may only set a name the request uses that is not one of the environment's secrets (else `invalid`), and it never overrides a secret.
- **`headers`** may not carry auth: `Authorization`, `Proxy-Authorization`, `Cookie`, or any name `isSensitiveName` flags, gives `invalid`. The saved request's own auth and headers are kept as saved.

## 4. Policy, in this order (first match wins)

Each step that refuses writes an audit row with `decision: 'refused'`, `outcome: 'skipped'` and the code. None of them asks the person or calls the network.

| # | Check | Code | Message the agent gets |
|---|---|---|---|
| 1 | rate: 30 calls a minute per execution (OxeQuery's `RATE_PER_MINUTE`) | `rate-limit` | — |
| 2 | collection exists and effective access is not `off` | `access-off` | Agent access to "<collection>" is off. A person can turn it on in OxePost. |
| 3 | an environment is chosen for the collection | `no-environment` | — |
| 4 | method is GET/HEAD/OPTIONS, or access is `write` | `access-read-only` | — |
| 5 | not a write to a production environment | `prod-write` | Agents can never send changes to a production environment. |
| 6 | origin (scheme+host+port, after variables) is one of the collection's saved requests' origins in that environment | `origin` | Not sent: agents only reach the hosts this collection already uses. |
| 7 | every secret the request uses is set | `secret-missing` | The secret {{NAME}} is not set in <environment>. |
| 8 | the approval (§6) | `denied` / `approval-pending` / the broker's refusal | OxeQuery's wording |
| 9 | one call at a time per collection | `busy` | — |
| 10 | at connect: each resolved IP is not private, loopback or link-local, unless the allowed origin's host is itself literally one (`localhost`, `*.localhost`, or a private, loopback or link-local IP literal). A public name that resolves to a private address is always refused, saved or not. | `private-address` | — |
| 11 | redirects: manual, at most 5, each hop re-runs 6 and 10, never https → http | `redirect` | — |
| 12 | time limit 20 s | `timeout` | — |

- **Decided here (step 10):** the check runs in the connection's `lookup`, through an undici `Agent` whose `connect.lookup` wraps `dns.lookup` and checks every address, so a DNS rebind between the check and the connect fails. The gateway takes `lookup` as a dependency so tests can inject it.

## 5. Secrets

- **Values are filled in main,** at send time only, from `SecretStore.values(root, environmentId)`.
- **Mask:** the existing `maskValues`, which writes `[secret:NAME]`; the approval card draws it as `•••• (NAME)` (DESIGN §4). It applies to:
  - the approval text;
  - the response URL, headers and body returned to the agent;
  - the audit `url_path` and `response_excerpt`;
  - every log line.
- **Response headers** `Authorization`, `Proxy-Authorization`, `Cookie` and `Set-Cookie` are always `[redacted]` for the agent and the audit, whatever their value.
- **`requests`** returns secret names only. No result, error or log ever carries a value; §8 checks all three.

## 6. Approval

- **Kind:** a new `ApprovalKind` `oxepost`, added to `APPROVAL_KINDS_REMOTE_FORBIDDEN` as `oxepost.approve`. The phone never answers it, the same rule as OxeQuery. This adds `'oxepost.approve'` to `REMOTE_FORBIDDEN` in `shared/remote/protocol.ts`, so the PR runs `npm run android:generate` and commits the Kotlin.
- **Broker scope:** `oxepost:<workspace>:<collection>`.
- **Risk:** `read` for GET/HEAD/OPTIONS, `write` otherwise. "Allow for this run" (`allow-session`) only covers reads outside production. In production, a session grant is not reused: every read asks.
- **Text:** exactly what will be sent, masked:

  ```
  METHOD url
  header: value …
  (blank line)
  body
  ```

  It's hashed into `text_hash`, and the hash must match on the retry. Text longer than `MAX_REVIEWABLE` is refused (`too-long`), never shortened.
- **Presentation:**
  - title `approvals.title.oxepost`;
  - target `<collection> · <environment>`;
  - `environment: { kind: production ? 'prod' : 'dev', name, production }`;
  - the production note when production.

## 7. Surface

- **IPC (person-only, never MCP):** `oxePost.call` gets the ops `agentAccessList`, `agentAccessSet` and `agentCeilingSet`. FE uses them in PR 3.
- **mcp-coverage:**
  - `oxepost.all` (planned H8) splits into:
    - `oxepost.agent_send` with tools `{ 'oxespace_post#requests': 'read', 'oxespace_post#send': 'confirm' }`;
    - `oxepost.person` (`excluded`, the rest of `oxePost.call`).
  - `oxepost.agent_access` is added to `FORBIDDEN_CAPABILITIES` as a `forbidden` capability.

## 8. Frozen test (`tests/acceptance/f2/a12-oxepost-agents.test.ts`, `npm run test:electron`)

It uses an in-memory database, a temp request tree (`RequestStore`), a fake secret source, a fake broker, a fake `fetchImpl` and a fake `lookup`. It never touches the network, the vault or the user's files. It checks:

1. **Migration:**
   - the three tables and their columns;
   - `oxepost_audit` is append-only;
   - a production ceiling of `write` is refused;
   - the ceiling defaults are ordinary `write`, production `read`.
2. **Off by default:**
   - `requests` lists nothing;
   - `send` gives `access-off`, with no approval asked, no fetch, and one refused audit row.
3. **Read access, GET:**
   - it asks with kind `oxepost` and risk `read`;
   - the approval text has `[secret:API_KEY]` and not the value;
   - approved, the fetch gets the real value;
   - the result echoes no secret, and `Set-Cookie` is redacted;
   - the audit row is approved/ok/200 with no secret and no excerpt.
4. **Read access, POST:** `access-read-only`, with no approval and no fetch.
5. **Write access, POST:**
   - risk `write`;
   - denied gives `denied`, no fetch, and an audit row denied/skipped;
   - pending gives `approval-pending`.
6. **Production:** POST is refused (`prod-write`) without asking, even with write access. A GET asks with `environment.production: true`.
7. **Origin:** a new request to another host is refused (`origin`) without asking. One to the same origin asks.
8. **Private addresses:** a public origin that resolves to 127.0.0.1 is refused (`private-address`), while a collection whose saved origin is `http://localhost:3000` is sent.
9. **Redirects:** a 302 to another origin gives `redirect`, after one fetch only.
10. **Missing secret:** `secret-missing` names the secret and the environment, with no fetch.
11. **Arguments:**
    - a `variables` entry naming a secret gives `invalid`;
    - an `Authorization` header gives `invalid`;
    - unknown actions (`access`, `setAccess`) give `invalid`.
12. **Failure excerpt:** a 500 whose body echoes the secret leaves a masked `response_excerpt` of at most 4096 bytes.
13. **`requests`** lists variable and secret names, and its JSON has no variable or secret value.
14. **Logs:** nothing the `log` dependency received contains a secret value.
15. **Access change:** `setAgentAccess` writes the `person` audit row. An agent's `handle` can't reach it.
16. **Surface:**
    - the mcp-coverage entries of §7;
    - `oxepost.agent_access` is forbidden;
    - `APPROVAL_KINDS` has `oxepost`;
    - `APPROVAL_KINDS_REMOTE_FORBIDDEN.oxepost` is `'oxepost.approve'`.

## 9. For SECURITY review

| Topic | Where |
|---|---|
| SSRF and DNS rebinding | §4 steps 6, 10, 11 |
| Exfiltration through a new request | §4 step 6: origins are only the saved ones, and the agent can't add a saved request |
| Secrets in the result, approval, audit and logs | §5, tests 3, 12, 13, 14 |
| Auth smuggling through headers or variables | §3, test 11 |
| A grant coming from a repo file | §2 "decided here" |
| The phone answering | §6, `REMOTE_FORBIDDEN` |
| Response size, prompt injection | 64 KB cap plus the untrusted notice (§3) |

## Out of scope

DESIGN §8 (agents creating collections, editing requests or environments, WebSockets, imports), and the Agent activity page (A10/A11).
