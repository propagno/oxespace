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
| 2 | `oxepost/agent-gateway.ts`, `oxepost/address-policy.ts` and `oxepost/secret-forms.ts`; the MCP domain tool `oxespace_post`; the approval kind `oxepost`; mcp-coverage. **Also:** `'oxepost.approve'` in `REMOTE_FORBIDDEN` (`shared/remote/protocol.ts`) and its `'oxepost.approve': 'oxepostApprove'` entry in `DevicesSettings.tsx` `FORBIDDEN_KEYS` (a `satisfies Record<RemoteForbidden, string>`, so typecheck fails without it), plus `devices.scope.forbidden.oxepostApprove` in en and pt-BR, plus the `npm run android:generate` output (RemoteProtocol.kt only). **Decided (TECH LEAD, 07/11):** `undici` becomes a direct dependency, pinned exactly to `7.30.1` (the version already in the tree, transitive today), added without a full `npm install`. The gateway uses that package's own `fetch` and `Agent` together, never Node's global `fetch` with an npm `Agent`. | executor |
| 3 | The UI: the folder's "Agent access…" dialog, the badge, the ceiling in OxePost settings, and the approval card drawing `[secret:NAME]` as `•••• (NAME)`. FE's CCR is draft **#654** (`docs/roadmap-1.5/ccr-a12-ui-oxepost-agent-access.md`, with its frozen test). The card's `[secret:NAME]` marker is for kind `oxepost` only and is display only; the approved text and its hash are unchanged. | executor (FE reviews) |

The migration takes main's highest number plus 1 when PR 1 is written. Today that's 094 (main's highest is `093_workspace_color.sql`). If another migration lands first, renumber; the gap guard refuses gaps.

## 2. Storage (migration 094)

```sql
-- Agent access per collection (a top-level folder of .oxespace/requests; '' is "Ungrouped"). No row = off.
CREATE TABLE IF NOT EXISTS oxepost_agent_access (
  workspace_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('off', 'read', 'write')),
  environment_id TEXT,                 -- the environment the person chose for agents; NULL = none chosen, send refused
  folder_identity TEXT NOT NULL,       -- the folder itself at grant time: '<dev>:<ino>:<birthtimeMs>' from fs.stat (bigint)
  origins_json TEXT NOT NULL,          -- the sorted origins of the saved requests the person saw, resolved in that environment
  fingerprint TEXT NOT NULL,           -- sha256 of the sorted (relative path, method, origin) of those saved requests
  confirmed_at INTEGER NOT NULL,       -- when the person last set or re-confirmed this snapshot
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
  response_excerpt TEXT,               -- failures only: ≤ 4096 bytes, masked; NULL otherwise and for binary bodies
  access_from TEXT,                    -- access rows only: off | read | write
  access_to TEXT,
  access_event TEXT CHECK (access_event IS NULL OR access_event IN ('set', 'confirm', 'dropped'))
);
CREATE INDEX IF NOT EXISTS idx_oxepost_audit_ts ON oxepost_audit(ts DESC);
CREATE TRIGGER IF NOT EXISTS oxepost_audit_no_update BEFORE UPDATE ON oxepost_audit
BEGIN SELECT RAISE(ABORT, 'oxepost_audit is append-only'); END;
```

- **Retention:** 90 days, pruned with the other audits (`AUDIT_RETENTION_DAYS`).
- **Effective access** = the lower of the collection's access and the ceiling for the chosen environment's kind. In a production environment a write is refused whatever the setting.
- **An access row** in `oxepost_audit` has `access_from`/`access_to`/`access_event` set, method and url_path NULL, decision `auto`, outcome `ok`. The columns are structured so the window localizes the line (FE's M5 ask); no English is stored. A10 reads these rows as `accessChange: { from, to, event }`.
  - `set`: a person changes access (actor `person`). That's DESIGN's "Access changed" line.
  - `confirm`: a person re-confirms a changed collection (actor `person`).
  - `dropped`: OXESpace removes a grant whose folder is gone or isn't the same folder (actor `oxespace`, A10 kind `app`).
- **Decided here:** the grant lives in the DB, not in `.oxespace/requests`. A file in the repo could be committed by anyone; a person's grant must not come from a clone.

### 2b. A grant is a snapshot of what the person saw (TECH LEAD's amendment; HML-A12-2, HML-A12-3)

The files under `.oxespace/requests` are the repo's: anyone with a commit can add a request or replace a folder. A grant therefore never trusts the current files to say what the person allowed.

- **At grant and at re-confirm,** `setAgentAccess` / `confirmAgentAccess` read the collection in the chosen environment and store:
  - `folder_identity`;
  - `origins_json`, the origins the person saw;
  - `fingerprint`, over the sorted (relative path, method, origin) of the saved requests;
  - `confirmed_at`.

  The dialog shows those origins.
- **The origin pin (§4 step 7) uses `origins_json`,** never the current files. A saved request added later on a new host is refused there (`origin`), even though it's saved.
- **The same folder:** at every list and send, the folder must exist and its `folder_identity` must match.
  - Otherwise the row is dropped and the collection is `off`. The `access_event: 'dropped'` audit row carries the reason in `error_code`: `folder-recreated` (same name, another folder) or `folder-missing` (gone or renamed away).
  - **The person is told why** (TECH LEAD): a branch switch, a clone or a worktree can recreate a folder, and access must not vanish silently.
    - Until the person sets access again, an agent send to that collection gives `access-dropped`, not `access-off`.
    - The dialog and A11 show the message `oxepost.agent.access-dropped`, en: "Access was turned off because this folder was recreated (for example by a branch switch). Allow it again in OxePost."; pt-BR: "O acesso foi desligado porque esta pasta foi recriada (por exemplo, numa troca de branch). Permita de novo no OxePost." So a deleted folder, or one recreated under the same name, starts at `off`.
  - A rename gives a new name with no row, so it's `off` too. The person grants it again, deliberately. A grant never follows a name.
  - Decided over "move on rename" because nothing proves a renamed folder is the one the person granted; a folder's name is just a file path anyone can change.
  - **Identity limit:** on Windows (NTFS) a recreated folder gets a new file index and birth time (checked 07/11). On a Linux filesystem without birth times, the identity falls back to `dev:ino`, and a reused inode is caught only by the fingerprint, which still refuses writes and keeps reads to the snapshot's origins.
- **A changed collection** (the fingerprint differs, the folder identity is the same):
  - a **write** is refused with `access-changed`;
  - a **read** keeps working, but only to origins already in `origins_json`;
  - `requests` marks the collection `changed: true`, and the dialog shows "Changed since you allowed it" with a **Confirm access** button (`agentAccessConfirm`), which stores a new snapshot and is audited `confirm`.
- **The environment** (HML-A12-3):
  - It's referenced by its id, which is stable across a rename (`saveEnvironment` keeps the id it's given), so a renamed environment keeps the grant. The snapshot's origins were resolved with its variables then; a changed `host` variable only shows up as a changed fingerprint.
  - A deleted environment gives `no-environment` until the person picks another. The dialog says "The environment agents used was removed; pick another".
  - `production` is read at send time, so turning it on applies the production ceiling and the no-write rule at once.

## 3. The agent tool: `oxespace_post` (domain tool)

| Action | Level | Input | Output |
|---|---|---|---|
| `requests` | read | `workspace?` (defaults to the caller's) | `{ collections: [...] }`, one entry per enabled collection: `{ collection, access, changed, environment: { name, production } \| null, requests: [{ path, name, method, url }], variables: string[], secrets: string[] }`. `url` is the saved template with `{{names}}` unresolved. Names only, never values. |
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
- **No secret in agent text** (SECURITY must-fix 1): in a new request's `url`, in agent `headers` and in `body`, a placeholder that names one of the environment's secrets gives `invalid` before anything else. The match is case-insensitive and allows whitespace inside the braces, so it is looser than the resolver on purpose. Placeholders for ordinary variables stay allowed. `variables` values may not contain `{{` at all. Otherwise an agent could have the secret filled into a request it wrote, then echoed or stored by the same origin. A saved request's own placeholders are the person's and keep working.
- **Agent headers** (SECURITY must-fix 3) give `invalid` when the name is any of:
  - auth: `Authorization`, `Proxy-Authorization`, `Cookie`, or any name `isSensitiveName` flags;
  - routing: `Host`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `X-Original-URL`, `X-Rewrite-URL`;
  - hop-by-hop and framing: `Connection`, `Keep-Alive`, `Proxy-Connection`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`, `Content-Length`.

  A name that isn't an RFC 7230 token, or a name or value with CR, LF or NUL, is also `invalid`. The saved request's own auth and headers are kept as saved.

## 4. Policy, in this order (first match wins)

Each step that refuses writes an audit row with `decision: 'refused'`, `outcome: 'skipped'` and the code. None of them asks the person or calls the network.

| # | Check | Code | Message the agent gets |
|---|---|---|---|
| 1 | rate: 30 calls a minute per execution (OxeQuery's `RATE_PER_MINUTE`) | `rate-limit` | Too many requests from this run; try again in a minute. |
| 2 | collection exists, its row exists, the folder is the same (§2b: identity), and effective access is not `off` | `access-off`, or `access-dropped` when its last access row is `dropped` | Agent access to "<collection>" is off. A person can turn it on in OxePost. / Access was turned off because this folder was recreated (for example by a branch switch). Allow it again in OxePost. |
| 3 | an environment is chosen for the collection, and it still exists | `no-environment` | Agents can't send from "<collection>" until a person picks an environment for them in Agent access. |
| 4 | method is GET/HEAD/OPTIONS, or access is `write` | `access-read-only` | Agent access to "<collection>" is read only, so it can't send <METHOD>. |
| 5 | not a write to a production environment | `prod-write` | Agents can never send changes to a production environment. |
| 6 | a write needs an unchanged collection (the fingerprint matches; §2b) | `access-changed` | This collection changed since access was given. Confirm access again in OxePost. |
| 7 | origin (scheme+host+port, after variables) is in the grant's `origins_json`, never read from the current files | `origin` | Not sent: agents only reach the hosts this collection already used when access was given. |
| 8 | every secret the request uses is set | `secret-missing` | The secret {{NAME}} is not set in <environment>. |
| 9 | the approval (§6) | `denied` / `approval-pending` / the broker's refusal | OxeQuery's wording |
| 10 | one call at a time per collection | `busy` | Another request from this collection is still running. |
| 11 | at connect: each resolved IP is not blocked, unless the allowed origin's host is itself literally one (`localhost`, `*.localhost`, or a blocked IP literal). A public name that resolves to a blocked address is always refused, saved or not. | `private-address` | Not sent: <host> points to a private address, which agents can't reach. |
| 12 | redirects: manual, at most 5, each hop re-runs 7 and 11, never https → http | `redirect` | Not sent: the server redirected to <origin>, which agents can't reach. |
| 13 | time limit 20 s | `timeout` | No answer from <host> in 20 s. |

- **Messages** (HML-A12-1): the agent gets the English sentence above. The audit stores only the code, and A11 words it in en and pt-BR from `oxepost.agent.<code>` message codes (C3), written by PR 2 in both locales. `OXEPOST_AGENT_REFUSALS` (exported by `agent-access.ts`) lists every code. The frozen test pins the list and the wording of `no-environment`, `access-read-only`, `private-address`, `access-changed` and `access-dropped`.

- **Decided here (step 11):** the check runs in the connection's `lookup`, through an undici `Agent` whose `connect.lookup` wraps `dns.lookup` and checks every address, so a DNS rebind between the check and the connect fails. The gateway takes `lookup` as a dependency so tests can inject it.
  - **All addresses:** every address in the answer is checked, `all: true`, and one blocked address refuses the request (no "pick the good one").
- **Blocked ranges** (SECURITY must-fix 4): `isBlockedAddress(ip)` in `oxepost/address-policy.ts`, from Node's `net.BlockList`.
  - IPv4:
    - `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`;
    - `169.254/16` (link-local and cloud metadata);
    - `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`;
    - `224/4`, `240/4`, `255.255.255.255`.
  - IPv6:
    - `::`, `::1`;
    - `fc00::/7`, `fe80::/10`, `ff00::/8`.
  - **Embedded IPv4** is checked by its IPv4 address, against the IPv4 list:
    - IPv4-mapped `::ffff:0:0/96`, in both dotted and hex form;
    - NAT64 `64:ff9b::/96`.
  - Anything that doesn't parse as an IP is blocked.
- **Transport** (TECH LEAD's pins):
  - The gateway makes **one** undici `Agent` of its own, through `makeDispatcher({ connect: { lookup, rejectUnauthorized: true } })` (a dependency, defaulting to `new Agent(options)`), and passes it as `dispatcher` on every send.
  - It never uses the global dispatcher, `ProxyAgent` or `EnvHttpProxyAgent`, so `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` have no effect: a direct connection only.
  - `rejectUnauthorized: true` is explicit, so `NODE_TLS_REJECT_UNAUTHORIZED=0` can't turn certificate checks off. There's no per-collection override.
  - `redirect: 'manual'`.

## 5. Secrets

- **Values are filled in main,** at send time only, from `SecretStore.values(root, environmentId)`.
- **Mask:** `maskSecretForms(text, secrets)` in `oxepost/secret-forms.ts`, built on the existing `maskValues` label `[secret:NAME]`; the approval card draws the label as `•••• (NAME)` (DESIGN §4).
  - **Forms masked** (SECURITY must-fix 2), each of a value of 4 or more characters, longest first:
    - the plain value;
    - URL-encoded: `encodeURIComponent`, and the form encoding with `+` for spaces, matched case-insensitively on the `%XX` hex;
    - base64: standard, standard without padding, and base64url;
    - JSON-escaped: `JSON.stringify(value).slice(1, -1)`.
  - **Known limit (residual risk, §9):** base64 of a secret that sits inside a larger base64 blob at an offset not divisible by 3 isn't a substring of any form, so it isn't caught. The origin pin (§4 step 7) and the no-secret-in-agent-text rule (§3) are what keep that case from being agent-driven.
  - It applies to:
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
- **Structured spans, the only thing the card renders** (TECH LEAD, HML-654-3):
  - The approval request for kind `oxepost` carries `textSpans: Array<{ kind: 'text' | 'secret'; value: string }>` next to the hashed `text`. For a `secret` span, `value` is the secret's NAME.
  - Main builds the secret spans from its own masking, at the exact places it put a vaulted value. Everything else, including anything the agent wrote, is `text`.
  - The card (#654) renders `kind: 'secret'` spans as "•••• (NAME)" and **never pattern-matches `[secret:` in text**. Otherwise an agent could write the literal `[secret:API_KEY]` and make plain bytes look like a vaulted secret, or the other way round.
  - The joined span values equal `text` with main's own markers expanded. The shared approval types gain the optional field; other kinds don't set it.
- **Defense in depth, in the hashed text:** in agent-authored text (url, header values, body), every `[secret:` is written as `[[secret:` in the approval `text`. So main's single-bracket marker can only come from main, and the hash covers the escaped text. The **bytes sent are never changed**: the request carries exactly what the agent wrote.
- **Presentation:**
  - title `approvals.title.oxepost`;
  - target `<collection> · <environment>`;
  - `environment: { kind: production ? 'prod' : 'dev', name, production }`;
  - the production note when production.

## 7. Surface

- **IPC (person-only, never MCP):** `oxePost.call` gets the ops `agentAccessList`, `agentAccessSet`, `agentAccessConfirm` and `agentCeilingSet`. FE uses them in PR 3 (#654). **Return shapes,** frozen on both sides: here, and in #654's dialog test.

  ```ts
  type AgentAccess = 'off' | 'read' | 'write'
  interface AgentAccessRow {
    collection: string              // a top-level folder name; '' is "Ungrouped"
    access: AgentAccess             // the person's setting (the ceiling caps it for agents; the dialog shows both)
    environmentId: string | null
    changed: boolean                // the fingerprint differs from the grant's (§2b)
    lastEvent: 'set' | 'confirm' | 'dropped' | null   // the latest access row in oxepost_audit for this collection
    origins: string[]               // origins_json; [] when off
  }
  // agentAccessList({ workspaceId }) → { collections: AgentAccessRow[], ceilings: { ordinary: AgentAccess, production: 'off' | 'read' } }
  //   one row per top-level folder that exists now; a folder with no grant is access 'off' (lastEvent can still be 'dropped').
  // agentAccessSet({ workspaceId, collection, access, environmentId }) → AgentAccessRow (the updated one)
  // agentAccessConfirm({ workspaceId, collection }) → AgentAccessRow
  // agentCeilingSet({ kind: 'ordinary' | 'production', access }) → { ordinary, production }
  ```

  Every op that names a collection takes `workspaceId`, like every other `oxePost.call` op. Person-only signatures in `agent-access.ts`: `setAgentAccess(db, { workspaceId, root, collection, access, environmentId })` and `confirmAgentAccess(db, { workspaceId, root, collection })`, both async (they read the collection to take the snapshot), plus `setAgentCeiling(db, kind, access)`.
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
15. **Access change:** `setAgentAccess` writes the `person` audit row with `access_from`/`access_to`. An agent's `handle` can't reach it.
15b. **Person-only ops** (FE's M5 ask):
    - through `OxePostService.call`, `agentCeilingSet` refuses production → write;
    - `agentAccessSet` refuses an unknown access and records the person row;
    - `agentAccessList` lists the collection;
    - a lowered ordinary ceiling caps a write collection to read for agents;
    - none of the three is an MCP tool.
S1. **No secret in agent text:** a secret placeholder in a new request's URL, an agent header or the body, and `{{` in a variables value, give `invalid`. A saved request's own secret still works.
S5. **Marker spoofing (HML-654-3):**
    - a new request whose body and header hold the literal `[secret:API_KEY]` is approved with no `secret` span, and the literal shows as text;
    - the hashed text has `[[secret:API_KEY]`;
    - the bytes sent are unchanged.
S5b. **A real secret:** a saved request that uses API_KEY has exactly one `secret` span, `{ kind: 'secret', value: 'API_KEY' }`, and no value anywhere.
S2. **Encoded forms:** the plain, URL, form, base64 (padded, unpadded, url) and JSON-escaped forms of a secret that needs escaping and padding never reach the result (body, URL, headers) or the audit (url_path, excerpt).
S3. **Agent headers:** every routing, hop-by-hop, framing and auth name, and any CR/LF/NUL in a name or value, gives `invalid`. An ordinary `X-Request-Id` is sent.
S4. **Blocked ranges:** the table of blocked and allowed addresses, including mapped and NAT64 forms. A DNS answer with one blocked address among public ones is refused, and so is a mapped loopback.
P1. **No proxy, TLS verified:** with `HTTPS_PROXY`/`HTTP_PROXY` set and `NODE_TLS_REJECT_UNAUTHORIZED=0`:
    - one dispatcher is made per gateway, with `connect.rejectUnauthorized: true`, a `connect.lookup`, and no proxy option;
    - every fetch gets that dispatcher.
N1. **Snapshot origins:** a saved request added after the grant, on a new host, gives `origin`. So does a new agent request there.
N2. **Changed collection:**
    - a write gives `access-changed`;
    - a read to an old origin still works;
    - `requests` says `changed: true`;
    - `confirmAgentAccess` restores writes and is audited `confirm`.
N3. **Same folder:**
    - a folder deleted and recreated under the same name gives `access-dropped` with its message, its row is dropped, and it's audited `dropped` with `error_code: 'folder-recreated'`;
    - a renamed folder gives `access-dropped` (`folder-missing`) under the old name and `access-off` under the new one.
N4. **Environment:**
    - a renamed environment (same id) keeps the grant;
    - turning `production` on makes a POST `prod-write` at once;
    - a deleted environment gives `no-environment` with its message.
N5. **Messages:** `OXEPOST_AGENT_REFUSALS` lists every code, and the wording of `no-environment`, `access-read-only`, `private-address` and `access-changed` is pinned.

**Real network (HML-A12-4, M10):** the frozen tests fake `fetch` and `lookup`, which proves the contract but not the wire. HML writes a CI acceptance spec on the real app once PR 2 is on a branch (BACKEND tells HML when):
- a local server on the runner, and a collection whose saved origin is `http://localhost:<port>`;
- a stand-in agent through the internal MCP;
- (1) an approved GET returns 200, and the server saw the real secret;
- (2) a 302 to another origin gives `redirect` after one hop at the server;
- (3) a hostname resolving to 127.0.0.1 with no saved origin of its own gives `private-address`, and the server sees nothing;
- (4) with `HTTP_PROXY` at a dead port, the send still reaches the server directly;
- (5) a saved request added on a new host after the grant is refused, and the server on that host sees nothing (TECH LEAD's case; N1 is its unit form).

It runs on CI (`acceptance.yml`), and A12 isn't done until it's green.
16. **Surface:**
    - the mcp-coverage entries of §7;
    - `oxepost.agent_access` is forbidden;
    - `APPROVAL_KINDS` has `oxepost`;
    - `APPROVAL_KINDS_REMOTE_FORBIDDEN.oxepost` is `'oxepost.approve'`.

## 9. For SECURITY review

| Topic | Where |
|---|---|
| SSRF and DNS rebinding | §4 steps 7, 11, 12 |
| Exfiltration through a new request, or a committed one | §4 step 7: origins are the grant-time snapshot (§2b), so neither the agent nor a pulled commit can widen them |
| Secrets in the result, approval, audit and logs | §5, tests 3, 12, 13, 14 |
| Auth smuggling through headers or variables | §3, test 11 |
| A grant coming from a repo file | §2 "decided here" |
| The phone answering | §6, `REMOTE_FORBIDDEN` |
| Response size, prompt injection | 64 KB cap plus the untrusted notice (§3) |
| Secret reflection through an agent-written request | §3 "No secret in agent text", test S1 |
| A faked secret marker on the approval card | §6 structured spans + escaped `[[secret:`, tests S5, S5b; the card renders spans only (#654) |
| Encoded secrets in a response | §5 forms, test S2; residual: offset base64 inside a larger blob |
| Header smuggling and routing (Host, X-Forwarded-*, CRLF) | §3 agent headers, test S3 |
| Metadata, CGNAT, mapped IPv6 | §4 blocked ranges, test S4 |
| Proxy and TLS downgrade from the environment | §4 transport, test P1 |
| A pulled commit widening origins, or a folder replaced under the same name | §2b snapshot (origins, fingerprint, folder identity), tests N1–N3 |
| The wire really behaving as the fakes say | HML's real-network acceptance spec (§8) |

## Out of scope

DESIGN §8 (agents creating collections, editing requests or environments, WebSockets, imports), and the Agent activity page (A10/A11).
