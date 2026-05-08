style: align workspace UI with reference design

Redesigns the Electron workspace shell toward the provided dark reference:
compact black sidebar, colored workspace rows, pill-style pane headers, pure
black terminal surfaces, and a darker blue modal/control system.

Preserves the workspace creation flow, native folder picker, claude/copilot
shell choices, pane split controls, and terminal autostart behavior.

Validation:
- npm run typecheck
- npm run test -- --runInBand tests/integration/Sidebar.test.tsx tests/integration/WorkspaceGrid.test.tsx tests/integration/TerminalPane.test.tsx tests/integration/NewWorkspaceModal.test.tsx
- npm run build
- npm run test:e2e

Known residual:
- Full npm test currently has unrelated agent discovery expectation failures in agent.service.test.ts.

---
OXE: spec-driven workflow
