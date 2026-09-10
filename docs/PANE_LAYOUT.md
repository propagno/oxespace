# Terminal layout

The split tree remains in localStorage (`oxe-pane-layout-trees-v1`). Pane identity,
processes and delegated-task ownership remain in the main process and SQLite.
Malformed trees are rejected and rebuilt from visible pane records. Helper panes
with negative grid coordinates do not enter the split tree.

New delegated panes carry an origin pane hint derived from the existing delegation
record. Reconciliation inserts them beside that origin, splitting along its longer
estimated screen axis. If the origin is gone, the largest remaining pane is used.
Existing tree membership is left untouched, including user rearrangements. Existing
three-column layouts are therefore not automatically migrated.

Use the pane's existing More actions menu to move it below/right of the preceding
pane in visual order, or to balance subdivisions. The first pane uses the last pane
as its preceding neighbour. Drag grips also support selecting any target edge.
Resize separators accept mouse dragging and arrow keys. Maximizing still preserves
mounted terminal components. Small subdivisions can be maximized for focused work.

Saving appearance or shell settings with an unchanged preset does not reconcile
the pane count. An explicitly changed preset retains the existing running-pane
protection. The alternate fixed grid expands to include dynamic pane coordinates.

## Validation

- Service/store tests cover preserving dynamic terminals, origin placement,
  repeated reconciliation, malformed storage and manual split deduplication.
- `e2e/pane-layout-resize.spec.ts` checks actual Electron hit testing, dragging in
  both axes, keyboard resize, preserved terminal DOM, persisted layout after
  renderer reload, and the menu at a compact viewport.
- `e2e/workspace-settings-design.spec.ts` checks existing settings at desktop and
  compact widths. Screenshots are emitted under `test-results`.

These E2E tests mock native processes. They do not certify authenticated agent
delegation or Linux packaged builds; those require their platform-specific runs.
Sizing uses window dimensions as an estimate, not a minimum terminal pixel size.
Centralizing tree persistence in SQLite and strict pixel minimums remain follow-up
work; this change does not introduce an automatic tab/focus fallback for dense trees.
