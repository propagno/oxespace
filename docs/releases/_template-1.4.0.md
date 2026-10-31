<!--
Release notes template for 1.4.0. Named _template so the release pipeline (ci.yml reads docs/releases/<version>.md) never
publishes it by accident: at the cut the release session copies it to 1.4.0.md, fills it from the roadmap rows, and
DESIGN reviews voice.
Keep the house style of docs/releases (1.3.x): English, outcome first, bold lead-in per bullet, what the person
does or sees, never internal ids, PR numbers or codes. The pt-BR version for the GitHub release is
_template-1.4.0.pt-BR.md (copied to 1.4.0.pt-BR.md at the cut), with the same sections in the same order. Terms follow docs/design/glossary.md.
One section per user outcome (the guide's pages); a section with nothing shipped is deleted, not left empty.
Each section links its guide page. Delete this comment before publishing.
-->
# OXESpace 1.4.0

<!-- One or two sentences: what 1.4 means for the person. Then the update line, as in 1.3.x. -->
… Installs of 1.3.x on Windows update automatically; on Linux, install the new package (the AppImage updates
itself).

## Approving what agents ask for

<!-- S1 · guide: docs/guide/en/01-trustworthy-actions.md -->
- **…**

## Closing and coming back without losing your agents

<!-- S2 · guide: docs/guide/en/02-sessions-that-survive.md -->
- **…**

## Organizing many conversations

<!-- S3 · guide: docs/guide/en/03-conversations.md -->
- **…**

## Your phone

<!-- S4 · guide: docs/guide/en/04-phone.md. Include the install and pairing line and where to get the app. -->
- **…**

## OXESpace's tools for your agents

<!-- S5 · guide: docs/guide/en/05-agent-tools.md. Give token numbers as measured (T8), like 1.3.3 does. -->
- **…**

## All your agents in one place

<!-- S7 · guide: docs/guide/en/07-agents.md -->
- **…**

## OXESpace your way

<!-- S6 · guide: docs/guide/en/06-your-way.md: language, accessibility, open in your editor, diagnostics. -->
- **…**

## What moved or was removed

<!-- Required in 1.4. Say where things went, so nobody hunts for them. -->
- **OXEVoice was removed.** OXESpace no longer records speech; your operating system's dictation still types into
  any field, and the downloaded voice model is deleted on the first start. Native voice is planned for a later
  version.
- **Team moved off the title bar.** Open it from **Tools › Project team…**, the command palette or `Ctrl+Shift+T`.
- **…**

## Security

<!-- Dependency and platform fixes, with advisory ids as 1.3.3 does. -->
- **…**

## Known limits

<!-- One line each, from the guide pages' "Known limits". Link the previous list if it still applies. -->
- …
