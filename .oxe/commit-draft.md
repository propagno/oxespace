feat: add editor pane and workspace tooling

Adds a real workspace editor pane backed by Monaco, a secure main-process
filesystem bridge, workspace file browsing, language detection, Ctrl+S save,
dirty state protection, and external-change conflict handling. The pane header
now exposes a visible Editor action so the generated app makes the feature
discoverable in normal terminal layouts.

Also includes the accumulated workspace delivery work from this cycle:
task/Kanban support, settings and agent configuration refinements, native
runtime handling for packaged builds, shell profile updates, and the 0.1.5
package version used for the latest generated installer.

Validation:
- npm test -- WorkspaceGrid
- npm run typecheck
- npm run build
- npm run dist
- oxe-cc runtime verify: 19/19 checks passed, 100% evidence coverage

Residual risk:
- EditorPane tests still emit React act(...) warnings although the suite passes.
- The installer is unsigned because no signing certificate is configured.

---
OXE: spec-driven workflow
