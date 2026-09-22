# Thread corrective visual contract

Superseded for the next implementation by [Thread Desktop visual contract](thread-desktop-ui-contract.md) and [implementation plan](thread-desktop-redesign.md), following user feedback on 2026-09-17.

User rejected double-sidebar/form layout and OAuth failure shown as a chat reply.

- Mode-specific sidebar: Code workspaces/panes; Thread project conversations.
  Shared shell, no second permanent column. See thread-sidebar.md.
- History in Thread sidebar; new-thread configuration in a modal, accessible labels and visible focus.
- Existing bg/tx/bd/accent tokens; timeline/composer share readable centered width.
- Operational auth error is not assistant knowledge; sanitized error code and
  native login instruction, Agent Settings and explicit retry, no credential edits.
- Preserve history, cancel and drafts; narrow viewport retains composer.

Local Claude auth status reports loggedIn false/authMethod none. Official recovery:
https://code.claude.com/docs/en/errors . Authentication cannot be fixed by styling.
No automatic login/logout, token deletion or hidden prompt replay.

Verified: 12 focused tests passed, including native-shaped OAuth failure and legacy
history recovery/retry; typecheck/lint/build passed. Two Electron E2Es passed:
Thread fixture authentication/retry/draft retention and three-terminal resize.
Reviewed screenshots at 1280/900 and the authentication error state. Layout,
composer width and error actions match this corrective contract. Existing error
messages remain on disk but known OAuth assistant errors are hidden in rendering.
This is not a full accessibility/contrast audit or authenticated inference test.
Authenticated inference requires user completing native login and remains pending.
