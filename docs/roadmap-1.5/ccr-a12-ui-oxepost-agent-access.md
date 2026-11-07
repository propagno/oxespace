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

## 3. The badge

A folder with access shows a 16 px agent icon after its name: `text-muted` for Read, `text-accent` for Read and write.
Its accessible name and tooltip are OxeQuery's `agentsHint` words ("Agents: read" / "Agents: read and write"). No
access shows nothing.

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
   `[secret:API_KEY]`. **Red:** the card draws the text as is.
2. **Only OxePost:** an `action` approval with the same text shows it as written.
3. **Ops:** the OxePost renderer calls `agentAccessList`, `agentAccessSet` and `agentCeilingSet`, and nothing in
   `src/` passes an agent-access op to anything but `oxePost.call`. **Red:** none exists yet.
4. **Copy:** T64 §7's strings exist in en and pt-BR in the `post` catalog: Agent access…, No access (default), the Read
   and Read and write explanations, the production line, the refused-origin line. **Red:** not there yet.

Behavior beyond this (the dialog's disabled choices, the Undo on widening, the badge) is checked by the e2e the
executor writes, `e2e/oxepost-agent-access*.spec.ts`.

## 6. Questions for review

- **DESIGN:** the Undo on widening (§2) comes from A7's rule, not T64. Confirm it, or say T64 wants no toast here.
- **HML:** the e2e runs on CI with the mock OxePost tree; does it also cover the approval card in pt-BR?
