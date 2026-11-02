# F1/F2 · Live catalog and primitives audit (design spec)

Status: draft for review · Owner: DESIGN/PRODUCT · Implements: F1 (states and live catalog), F2 (brand touchpoints)
· FRONTEND picks from §6 · Date: 2026-10-31 · Measured on origin/main 21fc9fab

The "not beta" bar means **every state on every screen comes from a primitive**, so the app reads as one product.
This audit lists what each primitive in `src/ui` still lacks and which hand-made components must become primitives.
It also lists what the live catalog (`DesignSystemPage`) must show, and ranks the work so FRONTEND can pick items
one PR at a time.

## 1. Where we are (numbers)

| Measure | Now | Ratchet in `tests/design-lint.test.ts` | Notes |
|---|---|---|---|
| Raw `<button>` outside `src/ui` | 512 | ≤ 513 | Threads 127, OxeQuery 101, Workspace 57, GitHub 23, Review 18, Sidebar 17, WebPreview 16, MCP 16, Integration 15, Grid 15 |
| Raw `<input>` | 104 | none | OxeQuery 41, Threads 12, Workspace 8, Settings 7 |
| Raw `<select>` | 5 | none | Integration 3, Review 1, Linear 1 |
| `role="alert"` outside primitives | 11 | ≤ 11 | Settings 6 (#176 removes most), Workspace 2, Threads/OxePost/OxePod 1 each (#173) |
| Hand-made `role="tab"` | 12 | none | OxeQuery 5, MCP 5, Workspace 1, Editor 1 |
| Hand-made `role="menu"` | 9 | none | 8 areas, 1 each |
| Hand-made `role="dialog"` | 6 | none | WebPreview 2, SlashOverlay, Keyboard, DesignSystem |
| Hand-made chips/pills/badges | ≥ 16 class families | none | `mcp-server-tag` 12, `oq-badge` 7, `new-workspace-agent-chip` 6, `settings-status-pill` 5, `github-repo-badge` 4, `worktree-tag`, `statusbar-chip`, `panel-scope-badge`, `memory-badge`, `diagnostics-badge`, `pane-agent-chip`, `integration-handoff-pill`… plus F32's new chip (#311) |
| `<dl>` / `<table>` / `<pre>` / `<details>` by hand | 20 / 21 / 45 / 33 | none | no primitive exists for any of them |
| Legacy (non-module) CSS | 61 files, 17,500 lines | colours and `!important` ≤ 59 ratcheted | biggest: `components.css` 2,090, `layout.css` 1,716, `github.css` 1,346, `integration.css` 1,069 |
| Primitives shown in the live catalog | 27 of 39 exports | none | missing: Avatar, Popover, ConfirmDialog, ToolPanel, Splitter, CommandDialog, SidebarSkeleton, Separator, SwatchPicker, FieldError, Toast, BrandMark |

The stale F1 PRs:
- **#171** (OxeQuery) is merged.
- **#173** (Thread, OxePod, OxePost) is mergeable. It adds `icon`, `heading` and `children` to `ErrorState`, which this audit builds on, so **merge it first**.
- **#176** (Settings) is conflicting, small (+33/−97), and lowers `role="alert"` to about 5. Rebase it next.

## 2. Primitive by primitive (what is missing)

Priority: **P0** blocks S7 or a screen in the review queue · **P1** needed for the "not beta" bar ·
**P2** polish.

| Primitive | Missing | Why / who needs it | P |
|---|---|---|---|
| `Badge` | `icon` slot, `size` (`sm` 18 px / `md` 20 px), accessible name (`label`) when the visible text is short, `solid` style for critical (`--intent-danger-solid` + `--text-on-solid`) | F32 chip (#311), risk levels (#243, glossary §6), S7 rows, and the 16 chip families | P0 |
| `StatusDot` | `unknown` status (dashed ring, glossary §5), `estimated` flag (weaker), `pulse` driven by `--duration-pulse` (none under reduced motion), forced-colours border | S7 seven states; UX-07 estimated pane states | P0 |
| `Notice` | distinct **danger icon** (today danger and warning share `AlertTriangle`, so only the colour tells them apart), `onDismiss`, and **`announce` control**: a warning that is present when the page opens should be `status`, not `alert`, so it isn't read out assertively on every visit | F32 hooks notice (#311), S7 partial-source notice, #176 settings notices | P0 |
| `Skeleton` | `variant="row"` (icon + 2 lines, the height of a list row) | S7 loading, sidebars, activity panel cold open (#302 IDEA) | P1 |
| `EmptyState` | `heading` level (same as #173 gives `ErrorState`), for empties that replace a whole view | Thread/OxeChat empty, S7 empty | P1 |
| `ErrorState` | (after #173) `retrying` state: the retry button shows a spinner and is disabled while the retry runs | #305 save retry, S7, #302 chunk fallback | P1 |
| `Button` | `pressed`/toggle state (`aria-pressed` styling) for toolbar toggles; nothing else is missing (sizes `sm/md/lg`, `loading`, five variants) | the toggles in Review, Grid and Editor headers are raw buttons today | P1 |
| `IconButton` | `size="sm"` keeps the 24 px target (`design-lint-target-size` already tests `md`) | pane and row headers at 240 px (#310) | P1 |
| `Checkbox` | `indeterminate` | bulk select (S7 v1.1, sections) | P2 |
| `Tabs` | a variant without coupled `content` (tabs that drive a router or a list) | the 12 hand-made `role="tab"` (OxeQuery, MCP) can't use today's API | P1 |
| `Meter` | `intent` thresholds (warning at ≥ 80 %, danger at ≥ 95 %) | context usage ring, quota, the 3 hand-made progress bars in Settings | P2 |
| `Avatar` | `color` takes a token name (`avatar-1…8`), not any CSS string | a raw colour can reach `style` today | P2 |
| `Toast` | nothing structural. Add a usage rule to the catalog: batch repeated notices (#311: six toasts on restore) | — | P2 (doc) |
| `Dialog` / `ConfirmDialog` | shown in the catalog; ConfirmDialog's `danger` style shown with Cancel focused | the approval modal (#243) is the reference | P1 (catalog) |
| `Tooltip` | nothing | — | — |
| `Spinner`, `LoadingState`, `BrandLoader` | nothing; catalog shows `LoadingState` inside a popover (the #302 case) | — | P2 (catalog) |

## 3. New primitives (ad-hoc patterns that must move into `src/ui`)

| New primitive | Replaces | Spec | P |
|---|---|---|---|
| **`ListRow`** (with `ListRowSkeleton`) | sidebar pane rows, conversation rows, activity rows, S7 agent rows, delegation and job rows; each area draws its own today | Leading slot (icon + `StatusDot`), title (1 line, ellipsis), meta line, optional third line, trailing action slot, overflow menu. Heights 56/76 comfortable, 44/60 compact (density tokens), indent 16 px per level, selected and focus states, roving tabindex inside a `role="tree"` or `listbox` parent. | P0 (S7.2 needs it) |
| **`Chip`** (removable / selectable tag) | `mcp-server-tag`, `worktree-tag`, `integration-handoff-pill`, filter pills | Badge's look + `onRemove` (× with label "Remover {name}") or `selected` (`aria-pressed`). Static labels stay `Badge`. | P1 |
| **`PermissionState`** (the 6th state) | the "no permission" case is drawn by hand where it exists (OxePod engine, phone "only on the computer") | Like `ErrorState`, but with a lock icon, `reason` and an optional `action` ("Abrir Configurações"). The checklist's sixth state ("no permission") has no primitive today. | P1 |
| **`InlineConfirm`** | none yet; S7 Stop needs it, and #310's IDEA | A button that becomes "Confirmar {verb}" for 3 s, then reverts. `aria-live` polite says "Pressione de novo para confirmar". Enter confirms within the window. | P0 (S7.3) |
| **`DescriptionList`** | 20 hand-made `<dl>` (approval requester, diagnostics, explain dialog) | `items: {term, detail}[]`, `layout="stacked\|inline"`, tokens for term/detail colour | P1 |
| **`CodeBlock`** | 45 hand-made `<pre>` (agent text, commands, logs) | Mono, scrollable, `tabIndex=0` with a label, optional copy button, `maxHeight`, wrap toggle. Revealing hidden characters (#243) stays a feature of the approval modal on top of it. | P1 |
| **`Disclosure`** | 33 hand-made `<details>` ("Detalhes técnicos", folds) | Summary + chevron that rotates on `--duration-fast`, keyboard, remembers state when given a key. It's the standard home of "Detalhes técnicos" (glossary §1). | P1 |
| **`DataTable`** (light) | 21 `<table>` (approval history, diagnostics, settings lists); OxeQuery's grid stays its own | Sticky header, `th scope`, sortable header button, empty row, density | P2 |
| **`Banner`** | the production band in #243, the update banner | A full-width band in a surface: intent, icon, text, action; never colour alone | P2 |
| **`SearchField`** | `src/components/Navigation/SearchField.tsx` (a primitive in practice) plus raw search inputs | Move it to `src/ui`: clear button, `/` hint (`Kbd`), result count via a live region | P1 |

## 4. Ad-hoc migration by area (largest first)

Each line is about one PR for FRONTEND. Lower the matching ratchet in the same PR.

| Area | What to move | Size |
|---|---|---|
| Threads (OxeChat) | 127 raw buttons → `Button`/`IconButton`; composer and card chips → `Badge`/`Chip`; 12 inputs → `TextField`; `<pre>` → `CodeBlock` | L, split by surface: composer, cards, sidebar |
| OxeQuery | 101 buttons, 41 inputs (the grid's cell editors excepted), 5 tabs → `Tabs`, `oq-badge` → `Badge` | L |
| Workspace and Sidebar | 57 + 17 buttons, `new-workspace-agent-chip`/`fleet-badge` → `Badge`, sidebar rows → `ListRow` (P0 with S7) | M |
| MCP | `mcp-server-tag` (12) → `Badge`/`Chip`, 5 tabs → `Tabs`, 16 buttons | M |
| GitHub, Review, Changes | 23 + 18 + 13 buttons, `github-repo-badge` → `Badge`, view toggles → `Button pressed` | M |
| Settings | #176 (rebase), `settings-status-pill` → `Badge`, 3 progress bars → `Meter` | S |
| Grid / Panes | `pane-agent-chip`, F32 chip → `Badge`; the pane menu's `role="menu"` → `Menu` | S |
| WebPreview, SlashOverlay, Keyboard | 4 hand-made dialogs → `Dialog`/`ModalSurface` | S each |
| Integration | 3 raw selects → `Select`, `integration-handoff-pill` → `Badge` | S |

## 5. The live catalog (`DesignSystemPage`) must show

1. **Every export of `src/ui/index.ts`.** A test fails when an export has no catalog section, the same way the
   tool catalog is checked today. Add the 12 missing ones (§1).
2. **The six states side by side** (empty, loading, error, offline, success, no permission), in light **and** dark,
   which it already does, and in **en and pt-BR**: a language toggle in the catalog header, using the real catalogs.
   This is F1's acceptance ("os 6 estados no visualizador, nos dois modos e nos dois idiomas").
3. Per primitive: each variant, size and state (hover, focus-visible, pressed, disabled, loading), with **compact
   density**, **forced colours** (a toggle that emulates `forced-colors: active`) and **reduced motion**.
4. **Usage rules** in one line under each primitive, for example: "Notice: stays until its cause goes away; for a
   failed view use ErrorState", "Toast: batch repeated notices", "Badge vs Chip: Chip only when it can be removed or
   selected".
5. Its own copy translated. The page's lead is English-only today ("Mandacaru, the OXESpace design system…"); move
   it to the catalog. The page stays dev-only (#197 exception), but it is our reference for pt-BR too.
6. **F2 brand touchpoints**: a "Marca" section listing every touchpoint in `docs/design/brand.md` (boot, loading,
   empty, error, about, installer, tray, notifications, phone splash), each with its live render or a screenshot,
   as F2's acceptance asks.

## 6. Prioritized backlog for FRONTEND

| # | Item | Unblocks | Size |
|---|---|---|---|
| 1 | Merge #173, rebase and merge #176 | the `ErrorState` API; `role="alert"` → ~5 | S |
| 2 | `Badge`: icon, size, label, solid. Migrate the F32 chip (#311) and the risk badge (#243). | #311, #243, S7 | S |
| 3 | `StatusDot`: unknown, estimated, pulse, forced colours | S7, sidebars | S |
| 4 | `Notice`: danger icon, dismiss, announce control | #311 hooks notice, S7, #176 | S |
| 5 | `ListRow` + `ListRowSkeleton`; move PaneSessionRow and the activity rows onto it | S7.2 | M |
| 6 | `InlineConfirm` | S7.3 Stop | S |
| 7 | Catalog: every export + test, en/pt-BR toggle, six states, forced-colours toggle | F1 acceptance | M |
| 8 | `PermissionState` | the sixth state, F1 | S |
| 9 | `Disclosure`, `DescriptionList`, `CodeBlock` (+ migrate the approval modal's pieces) | "Detalhes técnicos" everywhere | M |
| 10 | `Tabs` without content; migrate OxeQuery and MCP tabs | 12 hand-made tabs | S |
| 11 | `Chip`; migrate the tag/pill families | 16 chip families | M |
| 12 | Area migrations (§4), largest first | raw `<button>` from 512 toward 0 | L (many PRs) |
| 13 | `Skeleton row`, `EmptyState heading`, `ErrorState retrying`, `Button pressed`, `IconButton sm` | polish | S each |
| 14 | `SearchField` to `src/ui`, `DataTable`, `Banner`, `Meter` thresholds, `Avatar` tokens, `Checkbox` indeterminate | P2 | S each |
| 15 | F2 "Marca" section in the catalog | F2 acceptance | S |

## 7. New ratchets (add with the item that starts lowering them)

- Raw `<input>` outside `src/ui` ≤ 104; raw `<select>` ≤ 5.
- Hand-made `role="tab"` ≤ 12, `role="menu"` ≤ 9, `role="dialog"` ≤ 6.
- Classes matching `/-(chip|pill|tag|badge)\b/` in TSX ≤ today's count.
- Hand-made `<details>` ≤ 33, `<dl>` ≤ 20.
- Every `src/ui` export has a catalog section (exact, not a ratchet).

## 8. Out of scope

- OxeQuery's data grid cells and Monaco: specialised components, not primitives.
- The phone. Its Compose components follow `OxeTokens.kt`. The same audit for Android is a separate MOBILE item
  (M7 "Visual consistente").
- Legacy CSS rewrite. Files shrink as their areas migrate (§4); there is no big-bang rewrite.
