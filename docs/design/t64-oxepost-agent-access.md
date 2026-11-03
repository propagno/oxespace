# T64: Agent access in OxePost (1.5.0)

Status: **proposal**. Owner: DESIGN (product and UX). BACKEND builds it, SECURITY reviews it. The technical shape
(gateway, tool names, storage) is the TECH LEAD's.

Today agents have no HTTP tool: OxePost requests are only sent by the person. T64 lets an agent send requests from
OxePost, the same way OxeQuery lets it reach a database: **off by default, turned on by the person, per
collection, every request on the record**.

This follows OxeQuery's model on purpose (`AgentAccess = 'off' | 'read' | 'write'`, the per-environment ceiling, the
Agent activity panel), so a person who learned one already knows the other.

## 1. What a collection is

OxePost has no "collection" object today: requests live in folders under `.oxespace/requests/`. Here a
**collection is a top-level folder** of that tree. Access is set on it and covers every request inside it,
subfolders included. Requests at the root (outside any folder) form the collection "Ungrouped".

> Question for the TECH LEAD: if a per-request setting is simpler to store, the UI below still works, but per
> folder is what people will understand ("the Payments API"). Recommended: per top-level folder.

## 2. Turning it on

- In the request tree, each top-level folder's menu gets **Agent access…**. It opens a small dialog with the same
  three choices and the same wording as OxeQuery's connection dialog:
  - **No access (default)**
  - **Read**: agents may ask to send GET, HEAD and OPTIONS requests. Each one needs your approval.
  - **Read and write**: agents may also ask for POST, PUT, PATCH and DELETE. Every one needs your approval.
- A folder with access shows a 16 px agent badge after its name: `text-muted` for Read, `text-accent` for Read and
  write. The tooltip says "Agents: read" / "Agents: read and write" (OxeQuery's `agentsHint` strings).
- **Ceiling per environment**, like OxeQuery's `agentCeiling`. In OxePost settings, "The most an agent may be given
  in an environment that is…". The default is Read and write for ordinary environments and **Read for production
  ones** (`PostEnvironment.production`). The folder's setting can only be lower than the ceiling. Agents never
  write to a production environment, in any setting.
- Changing access is a person's action only. No agent tool can read or change it, and the change is itself
  recorded in Agent activity ("Access changed: Payments API → Read").

## 3. What an agent can send

- **Saved requests in an enabled collection**, by name, against an environment the person chose for that
  collection (or the active one). The agent can set the values of the request's variables, but it cannot add
  headers that carry auth. This is the main case.
- **New requests** only to the same origins (scheme + host + port) as the collection's saved requests in that
  environment. Never to any other host: an agent with a free HTTP client could send data anywhere. A request to
  another origin is **refused by policy**, without asking the person, and it shows in Agent activity as refused.
- Redirects are followed only within those origins.

## 4. Approval

| Method | Level | Approval |
|---|---|---|
| GET, HEAD, OPTIONS | read | asks every time; "Allow for this run" is offered (OxeQuery's "approved (run)") |
| POST, PUT, PATCH, DELETE | write | asks every time; no "for this run" |
| GET, HEAD, OPTIONS in a production environment | read | asks every time; no "for this run"; the card shows the production badge in danger |
| POST, PUT, PATCH, DELETE in a production environment | write | refused by policy |

The approval card is the same card as every other approval (deny is the default; the 1.4 rules hold). It shows:

- **Lead line**: "Send GET /v1/invoices to Payments API (staging)?". The method is in the method's color from the
  OxePost tree, the environment's name follows, and a production environment adds its danger badge.
- **Detail**: the full URL with variables resolved and **secrets shown as `•••• (secret name)`**, the headers with the
  same masking, and the body (first 20 lines, then "Show all").
- Buttons: **Deny** (default) · Allow · Allow for this run (read only).

## 5. Secrets

- Secret values never reach the agent: not in the request it sees, not in the approval it reads, not in the response.
  OXESpace fills them in main at send time.
- In the response returned to the agent, any secret value that appears in a header or the body is replaced by
  `•••• (secret name)`, and `Authorization`, `Cookie`, `Set-Cookie` and `Proxy-Authorization` headers are always
  masked.
- A secret that is "not set" makes the request fail before sending, with "The secret {{name}} is not set in
  {{environment}}". The agent gets that message, never a prompt to set it.
- The agent can list variable names and secret names (to know what a request needs), never their values.

## 6. Agent activity

The same panel as OxeQuery's (Settings › Agent activity), with an **OxePost** source next to Databases and
Containers. It uses the same columns and the same filters (All · Writes · Problems), and the same detail modal from
T63:

| Column | OxePost value |
|---|---|
| When | time |
| Agent | the conversation or terminal that asked |
| Connection | collection · environment (production in danger) |
| Request | `METHOD path` in mono; the method in its tree color |
| Decision | allowed for this run · approved · denied · refused by policy · waiting for you |
| Result | status code and duration, or "failed (code)", or "not run" |

- Intro: "Every HTTP request an AI agent made through OxePost, and what you decided."
- Empty state: "Agents only reach an API when you turn on agent access for a collection in OxePost. Every request
  they make appears here, with what you decided."
- Detail modal (T63): request and response with the same masking as §5, response body capped at 64 KB in the log.
  The log keeps the request and the status, and the body only for failures (it follows the audit retention days).
- Decision wording uses **Deny/denied**, not "declined" (the 1.4.1 consistency fix). The OxeQuery string
  `decision.denied: "declined"` changes with it.

## 7. Copy (en / pt-BR)

| Key | en | pt-BR |
|---|---|---|
| Menu item | Agent access… | Acesso de agentes… |
| Off | No access (default) | Sem acesso (padrão) |
| Read | Read: agents may ask to send GET requests. Each one needs your approval. | Leitura: agentes podem pedir para enviar requisições GET. Cada uma precisa da sua aprovação. |
| Write | Read and write: every change needs your approval. | Leitura e escrita: toda alteração precisa da sua aprovação. |
| Production | Agents can never send changes to a production environment. | Agentes nunca enviam alterações para um ambiente de produção. |
| Refused origin | Not sent: agents only reach the hosts this collection already uses. | Não enviado: agentes só acessam os hosts que esta coleção já usa. |

## 8. Out of scope

Agent-created collections, agents editing saved requests or environments, WebSocket/streaming requests, and
importing collections. Each one would be a later item with its own approval rules.
