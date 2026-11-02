# Approving what agents ask for

> Every agent action that matters asks once, clearly, inside OXESpace, and never hangs or slips past you.

<!-- About this page: Slice S1 · Filled by: BACKEND (contract) + FRONTEND (F18) · Items: B10, F18, B7.3, B16, B12, B6 · partial: describes what is on main on 10/31 (OxeChat request card, permission rules, B10, B16). The app's approval modal (F18, #243) and the risk levels join this page when it merges. -->

Also in: [pt-BR](../pt-BR/01-acoes-confiaveis.md)

## What you can do

- Read an agent's request in an OxeChat conversation
- Approve, allow this turn, allow for the session, or decline
- Save a rule so you aren't asked again
- Approve read-only commands automatically
- Hide a request to read the conversation

## How to

### Read an agent's request in an OxeChat conversation

When the agent needs your permission, the conversation shows a request card above the message box, and OxeChat in
the mode switch gets a count.

1. Read the first line: it says what the agent wants to do, for example **Review the command before allowing it to
   run.**
2. Check the **Command** (or the tool, the plan, or the proposed **File changes**).
3. Read the **Agent reason**. It is what the agent says; OXESpace hasn't verified it.
4. To read more comfortably, click **Expand**. To give the space back to the conversation, click **Shrink**.

### Approve, allow this turn, allow for the session, or decline

1. Pick one of the card's answers:
   - **Approve**: this request only.
   - **Allow this turn**: the same requests until the agent ends its turn.
   - **Allow session**: the same requests for this agent session.
   - **Decline**: the agent gets the refusal and carries on without doing it.
2. The card closes and the conversation continues. If another request is waiting, it shows next.

Answers the provider doesn't offer for that request aren't shown.

### Save a rule so you aren't asked again

1. On the card, choose **Always allow …** (the text says what the rule covers).
2. The rule is saved for this project.
3. To see or delete rules, open **Permissions** in the conversation (`Ctrl+Shift+M`).

### Approve read-only commands automatically

1. Open **Permissions** (`Ctrl+Shift+M`).
2. Turn on **Approve read-only commands automatically**.

Commands such as `ls`, `cat`, `grep`, `git status` and `git diff` run without asking when they only read files inside
the project. A command that reads outside the project, writes a file, runs another program or uses the network still
asks.

### Hide a request to read the conversation

1. Click **Hide**. The request keeps waiting, and the note at the top says **The agent is waiting for your answer**.
2. Click **Show** to go back to it.

## What OXESpace guarantees

- An allow rule only approves when it covers **every** command of a line, or every file; anything else still asks you.
- Commands that touch OXESpace's protected files, or that switch, undo or delete what is in Git (`checkout`, `reset`,
  `clean`, `rebase`…), are **never** approved by a rule: they always ask.
- A denied MCP tool leaves the agent's tools when its next session starts.
- An app request nobody answers is denied when it expires (5 minutes); nothing waits forever.

## If something goes wrong

- **"The provider is waiting for input, but its request is unavailable."** The agent stopped on a request the
  conversation couldn't show. Refresh the request, or stop the turn with the stop button and ask again.
- **"Could not load permission rules"** or **"The change was not saved"**: close and reopen **Permissions**. If it
  keeps happening, report it from **Help › Diagnostics**.
- **"Blocked by permissions"** on a conversation: its access doesn't allow the action. Review the conversation's
  access and saved rules; OXESpace never widens access on its own.

## On the phone

Nothing changes on the phone yet. Answering requests from the phone comes with the Android app (see
[Following and answering from your phone](04-phone.md)).

## Known limits

- The app's approval modal, with the risk in words (Low, Medium, High, Critical) and the decision history, arrives
  with F18 in this release; this page is updated when it lands.

<!-- Screenshots: `docs/guide/assets/S1/<name>.en.<light|dark>.png`. -->
