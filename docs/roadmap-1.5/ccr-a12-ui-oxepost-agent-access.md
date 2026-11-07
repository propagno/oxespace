# CCR A12 · PR 3: the OxePost agent-access UI and the masked approval card (1.5.0 F2, T64)

Owner: FRONTEND. Status: design for review (M5: DESIGN, HML, then TECH LEAD puts it in the F2 PLAN.json). No product
code here. Frozen test: `tests/acceptance/f2/a12-ui-oxepost-agent-access.test.tsx`, red today (section 5).
The product and copy are DESIGN's T64 spec (`docs/design/t64-oxepost-agent-access.md`, #561, approved 2026-11-03).
BACKEND's A12 CCR (#653) is PRs 1–2 and names this PR 3: "the folder's Agent access… dialog, the badge, the ceiling in
OxePost settings", over the person-only `oxePost.call` ops `agentAccessList`, `agentAccessSet` and `agentCeilingSet`
(A12 §7). This CCR adds nothing to the product rules; it pins how the renderer meets them.

## 1. The approval card draws a secret as `•••• (NAME)`

- Main sends the approval text with each secret already masked as `[secret:NAME]` (A12 §5). That text is what the
  hash covers, and the renderer never changes it.
- The card draws each `[secret:NAME]` as a marker, `•••• (NAME)`: one `<span data-secret="NAME">`, like the hidden-
  character markers. It's display only. `request.agentText.text` stays byte-identical, and the answer carries the id
  and generation, never text.
- **Only for `kind: 'oxepost'`.** In any other kind the agent text is the agent's own words, shown exactly as written,
  so an agent can't make a string look like a masked secret.
- The marker's accessible name is "secret API_KEY, hidden" (pt-BR "segredo API_KEY, oculto"), so a screen reader
  never reads four bullets (DESIGN).
- `NAME` is `[A-Za-z_][A-Za-z0-9_]*` (an OxePost secret name). A bracket that doesn't match stays as text.
- The lead line, the production badge (danger) and the buttons are T64 §4: Deny is the default, Allow, and Allow for
  this run for reads outside production only.

## 2. Agent access… (per top-level folder)

- Each top-level folder's menu in the request tree gets **Agent access…**. It opens a `Dialog` (`size="sm"`) with three
  choices, OxeQuery's connection-dialog pattern: No access (default), Read, Read and write.
- **Choices above the ceiling are disabled, with the reason.** In a production environment that's "Agents can never
  send changes to a production environment." Read and write is never offered there.
- **It applies at once** through `agentAccessSet`. Widening (off → read, read → write) toasts with Undo (A7's risk list
  rule). Narrowing doesn't toast.
- The tree reads the current access through `agentAccessList`, one call when the tree loads and again after a change.
  The renderer never stores access itself.
- **Changed since you allowed it** (A12 #653 at 8145df66). When `agentAccessList` marks a folder `changed: true` (its
  requests changed after access was given), the dialog shows a warning Notice, "Changed since you allowed it", above
  the choices, and a primary **Confirm access** that calls `agentAccessConfirm`. Until it is confirmed, the badge shows
  the warning state, and agents get no access to that folder (main's rule). A grant OXESpace dropped because the folder
  was deleted, recreated or renamed shows in Agent activity as "Access removed: the folder changed" (A11).

- **The environment agents use** (DESIGN gap 1; #653 `environmentId`). Under the choices, a select "Environment agents
  use", defaulting to the active environment. When `no-environment` applies, a warning Notice says "The environment
  agents used was removed; pick another" (pt-BR "O ambiente usado pelos agentes foi removido; escolha outro"), and
  the select takes focus.
- **What the person agrees to** (DESIGN gap 2; #653 §2b). Below the choices: "Agents can reach:" (pt-BR "Agentes
  podem acessar:") and the grant's origins (`scheme://host:port`, mono), then the refused-origin rule in words: "Not
  sent: agents only reach the hosts this collection already uses." They are on screen when the person chooses.
- **Access that OXESpace turned off** (DESIGN gap 3; #653 §2b `access-dropped`). When the folder's last event is
  `dropped`, the dialog shows one warning Notice with `oxepost.agent.access-dropped` ("Access was turned off because
  this folder was recreated (for example by a branch switch). Allow it again in OxePost."), the choices start at No
  access, and the folder has no badge (one alert).
- Widening keeps its Undo (DESIGN confirmed: the same rule as A7's R5).

## 3. The badge

A folder with access shows a 16 px agent icon after its name: `text-muted` for Read, `text-accent` for Read and write.
Its accessible name and tooltip are OxeQuery's `agentsHint` words ("Agents: read" / "Agents: read and write"). No
access shows nothing. A changed folder (§2) shows the badge in the warning color, named "Agents: paused — changed
since you allowed it" (pt-BR "Agentes: pausado — mudou desde que você permitiu").

## 4. The ceiling in OxePost settings

- "The most an agent may be given in an environment that is…". Ordinary: No access / Read / Read and write (default
  Read and write). Production: No access / Read (default Read). Read and write is never offered for production;
  main refuses it too (A12 §2).
- It applies at once through `agentCeilingSet`. Lowering a ceiling caps the folders above it, and says so in the
  toast.

## 5. Frozen test (red today)

`tests/acceptance/f2/a12-ui-oxepost-agent-access.test.tsx`:

1. **Mask:** an `oxepost` approval whose text holds `[secret:API_KEY]` shows `•••• (API_KEY)` in the agent block and
   never the bracket form. The marker is `data-secret="API_KEY"`, and the stored request text still holds
   `[secret:API_KEY]`, and the marker's accessible name is "secret API_KEY, hidden". **Red:** the card draws the text
   as is.
2. **Only OxePost:** an `action` approval with the same text shows it as written.
3. **Ops:** the OxePost renderer calls `agentAccessList`, `agentAccessSet`, `agentAccessConfirm` and `agentCeilingSet`, and nothing in
   `src/` passes an agent-access op to anything but `oxePost.call`. **Red:** none exists yet.
4. **Copy:** T64 §7's strings exist in en and pt-BR in the `post` catalog: Agent access…, No access (default), the Read
   and Read and write explanations, the production line, the refused-origin line, and "Changed since you allowed it" / "Confirm access" (pt-BR "Mudou desde que
   você permitiu" / "Confirmar acesso"), "Agents can reach:", the `no-environment` line, the `access-dropped` line
   (#653's wording, in the `post` or `main` catalog), and the paused badge name. **Red:** not there yet.

Behavior beyond this (the dialog's disabled choices, the Undo on widening, the badge) is checked by the e2e the
executor writes, `e2e/oxepost-agent-access*.spec.ts`.

## 6. Questions for review

- **DESIGN:** the Undo on widening (§2) comes from A7's rule, not T64. Confirm it, or say T64 wants no toast here.
- **HML:** the e2e runs on CI with the mock OxePost tree; does it also cover the approval card in pt-BR?
