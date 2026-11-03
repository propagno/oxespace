# T58: OxeChat conversation redesign (1.5.0)

Status: **approved** (user, 03/11). Owner: DESIGN. Builds on FRONTEND's T57 (1.4.1).

The user asked for more color, a nicer look and compact buttons. The message box shows the model by its real name
(for example "Opus 5.5", never "default"), the effort and the permissions as compact chips.

T57 already ships the immediate fixes in 1.4.1: the person's bubble on the right, a compact bottom strip, a visible
Stop button and the model name. By the user's decision (2026-11-03), T57 also implements the composer chips of §4
(model, effort, permissions) in 1.4.1, and MCP health comes out of the composer. Everything else here is T58 in
1.5.0: the full visual pass on top of that. It changes no behavior: every control
keeps its shortcut, popover, aria label and confirmation (the full-access confirmation included).

Tokens are the Mandacaru roles from `src/design/tokens/semantic.ts`. The accent is caatinga green in light mode and
sertão sun in dark mode. No new hex values: every color below is a role that already exists, or a new role defined
here from an existing scale step.

## 1. Principles

1. **Color carries meaning, not decoration.** Color tells you who is speaking (you, the agent), what the agent is
   doing (reading, editing, running, asking) and how much the agent is allowed to do. Body text stays neutral.
2. **Your words stand out; the agent's words read like a document.** The person's message is a colored bubble. The
   agent's reply has no bubble: it is the page.
3. **Compact by default.** Controls are 24 px chips and 28 px icon buttons. Nothing in the strip wraps at the
   conversation's minimum width (360 px). See §5.
4. **The riskier the permission, the louder the chip.** Read-only is quiet; full access is danger-colored. The chip is
   always visible, never only in a menu.

## 2. Conversation

### 2.1 The person's message

| Part | Light | Dark |
|---|---|---|
| Bubble background | `accent-soft` (caatinga 3) | `accent-soft` (sun 3) |
| Bubble border | `accent-border` at 1 px | `accent-border` at 1 px |
| Text | `text-primary` | `text-primary` |
| Radius | `lg` (12 px), bottom-right corner `sm` (6 px): the tail points to the right edge | same |
| Width | up to 80% of the column; aligned right (T57) | same |
| Padding | `2` × `3` (8 × 12 px) | same |

Attachments sit inside the bubble, above the text, as 24 px chips (`fill-hover`, `radius-full`).

### 2.2 The agent's reply

- No bubble. Text on `surface-base`, `text-primary`, at the full column width up to 72ch.
- A 20 px **provider avatar** at the start of the first line of each turn: a circle filled with `provider-<id>` (the
  identity colors, the same in both modes) with the initial in `text-on-identity`. It shows who answered.
- Code blocks: `surface-sunken`, `radius-md`, the existing copy button.
- Hover over a turn shows its actions (copy, …) at the turn's top-right corner, `fill-hover` 28 px icon buttons.
  They are always reachable by keyboard focus too, not only on hover.

### 2.3 Tool activity

One compact row per tool call (28 px), grouped when consecutive. A 3 px colored bar at the left edge says what kind
of work it was. The row's text stays neutral (`text-secondary`); color is only on the bar and the icon.

| Kind | Bar and icon | Examples |
|---|---|---|
| Read | `intent-info-solid` | read file, search, list, fetch |
| Edit | `accent` | write, edit, create a file |
| Run | `intent-warning-solid` | shell command, script |
| Failed | `intent-danger-solid` | any tool that returned an error |
| Done/neutral | `border-strong` | everything else |

A row expands in place to show its detail (`surface-sunken`). A running row shows the `Spinner`, never a pulse.

### 2.4 Approval card

No change in behavior or copy (deny is the default; the approval rules from 1.4 stand). Visual only:
`intent-warning-bg` background, `intent-warning-border` border, `radius-lg`, and the command block on
`surface-sunken` without clipping (the RC fix from 1.4.1, #533).

### 2.5 Turn status

The "working" line under the last turn: the `StatusDot` running pulse in `accent` and the elapsed time in
`text-muted`. The interrupted and error states use `intent-warning-fg` and `intent-danger-fg` text with an icon,
never color alone.

## 3. Message box

```
┌───────────────────────────────────────────────────────────────────┐
│ Ask, or type / for commands                                       │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ [/] [+]  [Plan|Agent]  (● Opus 5.5) (⏲ High) (✎ Can edit)   ◔ [■][↑] │
└───────────────────────────────────────────────────────────────────┘
```

- Box: `surface-raised`, `radius-xl` (16 px), 1 px `border-default`; on focus-within, `border-focus` and
  `elevation-2` (light mode only; dark mode keeps the border).
- Strip: one row, 36 px tall, inside the box under the text area, separated by nothing (no rule): the chips are
  enough structure.
- Left: commands `/` and add `+` as 28 px icon buttons (`fill-hover` on hover).
- Middle: the Plan/Agent segmented control and the three chips (§4).
- Right: the context ring (existing), then Stop and Send. MCP health is not in the composer (user decision,
  2026-11-03).
- **Send**: 28 px round, `accent` with `text-on-accent`; disabled is `fill-pressed` with `text-disabled`.
- **Stop** (while running): 28 px round, `intent-danger-solid` with `text-on-solid` and the square icon. It sits
  where Send is and Send moves left of it (queue). It is never hidden behind a menu (T57).
- Steer (when the provider supports it): a 28 px icon button left of Stop, as today.

## 4. Chips

All chips: 24 px tall, `radius-full`, padding 0 × `2` (8 px), gap `1` (4 px), `text-xs` (12 px) medium weight, a
14 px icon. Each one is a button that opens its existing popover (`thread.model`, `thread.effort`,
`thread.permissions` shortcuts unchanged). The aria label is "Model: Opus 5.5", "Effort: High",
"Permissions: Can edit the project".

### 4.1 Model

- A 8 px dot in `provider-<id>` (who runs it), then the model's display name from the catalog (`model.label`).
- **Never "default".** When the person didn't pick a model, the chip shows the name of the model the provider will
  use (`catalog.defaultModel`'s label). When the provider doesn't report it (`defaultKnown === false`), the chip
  shows "Provider's choice" until the first turn, and the real name once the session reports it.
- Fill `fill-hover`, text `text-primary`. Long names truncate with an ellipsis at 18ch; the full name is in the
  tooltip.

### 4.2 Effort

- A gauge icon and the level ("Low", "Medium", "High", "Max" as the catalog names them). Hidden when the model has
  no effort levels.
- Fill `fill-hover`, text `text-secondary`. The icon fills with the accent by level: one quarter per step, so
  the level reads at a glance without a new color.

### 4.3 Permissions

The one chip with intent color, by risk:

| Access | Icon | Label (en / pt-BR) | Fill / text / border |
|---|---|---|---|
| Read-only | eye | Read only / Só leitura | `intent-info-bg` / `intent-info-fg` / none |
| Workspace write | pencil | Can edit / Pode editar | `accent-soft` / `text-accent` / none |
| Full access | shield-alert | Full access / Acesso total | `intent-danger-bg` / `intent-danger-fg` / `intent-danger-border` |

When the conversation is in Plan mode, the Plan segment is `intent-warning-bg` / `intent-warning-fg`, so planning
reads as "nothing will change yet"; Agent uses `fill-selected`.

A pending configuration (applies at the next turn) shows the chip with a dashed border in its own color and the
tooltip "Applies to the next message" / "Vale a partir da próxima mensagem".

## 5. Narrow widths

| Column width | Strip |
|---|---|
| ≥ 560 px | everything as in §3 |
| 420–559 px | the chips drop their text except the model; effort and permissions show icon only (the color stays, the aria label carries the text, the tooltip shows it) |
| < 420 px | the model chip also drops to the dot and a 10ch name |

The permissions chip is never hidden at any width.

## 6. Contrast and accessibility

- Every chip's text against its fill meets AA (4.5:1) in both modes. The intent `-fg` on `-bg` pairs and
  `text-accent` on `accent-soft` are the same pairs the badges already use; FRONTEND checks them in the axe run.
- Color is never the only signal: every permission level has its own icon and label, every tool kind its own icon.
- Chips keep the 2 px `focus-ring` outline. Hit area is at least 24 × 24 px (WCAG 2.5.8).
- Reduced motion: the hover and focus transitions are instant (motion.md); the running pulse stands still.

## 7. Visual baselines

New shots in `e2e/visual` for light and dark, linux and win32: a conversation with one message from the person, one
reply with a code block, three tool rows (read, edit, run), an approval card, and the strip in each permission level
plus Plan mode. They are refreshed once per batch on main, not per PR.

## 7a. Conversation details panel

The side panel (`ThreadSessionPanel`, F14) has five sections: Environment, Context, Tools, Outputs and Background.
Today they are five equal cards with the same weight, every fact in the same gray-on-gray grid, and each card
carries a grip and a menu in its header. Nothing tells you where to look first. T57 (1.4.1) fixes only its scroll;
the redesign below is 1.5.0.

### Hierarchy

1. **Summary header** (new, not collapsible): one block at the top answering "what is this conversation running
   on and how full is it", without opening anything.
   - Line 1: provider avatar (§2.2), model chip and permissions chip, the same chips as the composer (§4), read-only
     here. A click opens the same popover as in the composer.
   - Line 2: branch (mono, `text-secondary`) and a worktree badge when the conversation has its own worktree.
   - Line 3: the context meter, full width, 6 px tall, `radius-full`. Track `fill-hover`, fill `accent`; from 80%
     `intent-warning-solid`, past the window `intent-danger-solid`. To its right, `62% · 124k / 200k` in
     `text-xs`, tabular numbers.
2. **Sections** below, in the person's order (reordering stays as it is).

### Sections

- Each section is a disclosure: a 32 px header button with a chevron, the title (`text-sm` semibold,
  `text-primary`) and a **summary on the right** in `text-muted` `text-xs`, so a closed section still says
  something. Summaries: Environment "main · own worktree"; Context "Messages 48%"; Tools "23 calls · 1 failed"
  (the failed count in `intent-danger-fg`); Outputs "4 files"; Background "2 running" (with the running
  `StatusDot`).
- The header is `aria-expanded` on a real button; the body is its region. Enter/Space toggles it. Open/closed is kept
  per viewer with the order.
- Defaults: Context and Tools open, the others closed. Since the summary header already shows the model, branch and
  meter, Environment is detail.
- The grip and the reorder menu stay, but they show only on header hover or focus-within (they are always reachable
  by keyboard through the menu, WCAG 2.5.7).
- No card per section. Sections are separated by a 1 px `border-subtle` rule on a single `surface-base` panel. This
  removes four nested borders and saves about 40 px of height.

### Density and content

- Facts (`dl`): label in `text-muted` `text-xs` above the value, `text-sm` `text-primary`, two columns when the
  panel is ≥ 320 px wide. Paths and branches are mono with a middle ellipsis and the full value in the tooltip.
- Context breakdown: each bucket is a row with an 8 px swatch, name, a thin share bar and tokens. Colors come from
  the existing intent and accent roles, the same in both modes: messages `accent`, tools `intent-info-solid`, MCP
  `intent-warning-solid`, system `border-strong`, skills `intent-success-solid`. Free, reserved and deferred are
  `text-muted` rows without a bar. "Compact now" is a secondary small button under the table.
- Tools: the top 5 tools by calls, each with its count; failed calls in `intent-danger-fg` with an icon; "Show all"
  expands in place. MCP servers are a row of 24 px chips with a status dot (`intent-success-solid` connected,
  `intent-danger-solid` failed, `border-strong` unknown).
- Outputs: changed files with `+n` in `intent-success-fg` and `−n` in `intent-danger-fg`, as in review; previews as
  links.
- Empty sections show one `text-muted` line, never an empty card.
- Spacing: `space-3` inside a section, `space-4` between sections, panel padding `space-3`.

### Light and dark

| Part | Light | Dark |
|---|---|---|
| Panel | `surface-base` | `surface-base` |
| Summary header | `surface-raised` with `elevation-1` | `surface-raised` with a `border-subtle` bottom rule |
| Section header hover | `fill-hover` | `fill-hover` |
| Section rule | `border-subtle` | `border-subtle` |
| Labels / values | `text-muted` / `text-primary` | same roles |

Visual baselines (§7) add the panel with all sections open and with the defaults, in both modes.

## 7b. Conversation menu (⋯, top right)

`ThreadConversationActions` already uses the app's `Menu` primitive (`src/ui/Overlay.tsx`). It looks poor because
it uses only part of that primitive: no shortcuts, an inconsistent group label ("current" heading over one group
only), and Archive sitting right next to Delete. The redesign keeps the primitive and its light/dark styles, adds no
new component, and changes no action.

### Grouping

Three groups separated by the primitive's `separator`, no group labels (the trigger already says "Conversation
actions"):

| Group | Items, in order | Icon | Shortcut column |
|---|---|---|---|
| This conversation | Rename · Status · Checkpoints | pencil · info · history | `/rename` · `/status` · `/checkpoint` |
| Move and copy | Open another conversation · Fork (Codex only) · Export · Import | folder-open · git-fork · download · upload | `/resume` · `/fork` · — · — |
| End | Archive · *(separator)* · Delete… | archive · trash-2 | `/archive` · `/delete` |

- The shortcut column uses the primitive's `shortcut` field. The value is the slash command (mono, `text-muted`), so
  the menu also teaches the composer commands. A real key combination wins when one exists; none does today.
- Archive is not destructive: it can be restored from Sidebar › Archived, so it uses the normal item colors.
- **Delete is alone in its own group at the bottom** with `danger: true` (`intent-danger-fg` text and icon, hover
  `intent-danger-bg`), and its label ends with an ellipsis because it opens a confirmation. The confirmation, where
  Cancel is the default, does not change.
- Disabled items (Export or Import without the API) stay visible and disabled with a tooltip saying why, never
  removed, so the menu keeps its shape.

### Spacing and look

Everything here comes from the primitive. FRONTEND changes it only if it differs, and then for every menu in the app:
28 px rows, `space-2` icon gap, 14 px icons in `text-secondary`, `space-1` vertical padding around separators,
`radius-md`, `surface-overlay` with `elevation-3` in light mode and `border-default` in dark mode, minimum width
220 px so the shortcut column lines up.

The trigger is a 28 px icon button (`fill-hover` on hover, `fill-selected` while open, `aria-expanded`), matching
the composer's icon buttons (§3).

## 7c. Side chat

The side chat (`side/ThreadSideChat.tsx`, B1.2, `Mod+.`) is a drawer where you ask about the conversation without
changing it. Today it reads as unfinished: a bare header, a gray "Read-only copy" tag that looks like a disabled
state, the explanation as a paragraph above the messages, and a plain text box. From T59 (BACKEND, 1.4.1) it no
longer runs in plan mode, so it answers directly. The design must not suggest "plan" anywhere.

### Panel

- A drawer on the right of the conversation, 360 px by default, resizable between 320 and 560 px, on
  `surface-base` with a 1 px `border-default` on its left edge (no shadow in either mode: it is part of the
  workbench, not floating).
- It enters with the tool panel's fade (`base`) and leaves at once (motion.md). Focus goes to its text box on open
  and back to the side chat button on close.
- Under 720 px of total width it covers the conversation as an overlay (`surface-overlay`, `elevation-3` in light
  mode) instead of squeezing it.

### Header

40 px, one row:

```
[⧉] Side chat  ·  Copy of "Fix login redirect"        $0.04   [⋯] [✕]
```

- A copy icon (14 px, `text-accent`), the title "Side chat" (`text-sm` semibold) and, after a `text-muted` dot, the
  conversation's title truncated with an ellipsis. The title is the link between the two, in place of the gray tag.
- On the right, the cost so far in `text-xs` `text-muted` (tokens when the provider has no price), then a ⋯ menu
  (the same `Menu` primitive as §7b: Copy all answers · *separator* · Discard and close…) and the close button.
- The close tooltip carries the shortcut (`Mod+.`), as today.

### Showing that it is a read-only copy

It must read as "a safe place to ask", not as an error, a warning or a plan:

- **No intent color.** Info, warning and danger fills are not used on the side chat chrome. The identity is the
  accent and the copy icon.
- An **accent top border**: 2 px `accent` across the top edge of the drawer, so the drawer is visibly a different
  place from the conversation next to it.
- The explanation moves from the paragraph to the **empty state**: the copy icon at 24 px, "Ask about this
  conversation" (`text-md`), and under it, in `text-secondary`: "Answers come from a copy. Nothing you ask here
  reaches the conversation or changes your files." It goes away with the first question. After that the header
  and the permissions chip below say the same thing.
- Busy state: the running `StatusDot` in `accent` and "Answering: reading files…" in `text-muted`, under the last
  message. The word "plan" never appears.

### Messages

The same rules as the conversation, scaled down: your questions in the `accent-soft` bubble on the right (§2.1);
answers without a bubble, with the provider avatar at 16 px (§2.2); code blocks with copy. Each answer has a Copy
action on hover and focus. There are no tool rows: the copy's activity shows only in the busy line.

### Composer

The same box as the conversation (§3) in its compact form: `radius-lg`, 2 to 6 lines, the strip below:

```
┌──────────────────────────────────────────────┐
│ Ask about this conversation…                 │
├──────────────────────────────────────────────┤
│ (● Opus 5.5) (⏲ High) (👁 Read only 🔒)  [↑] │
└──────────────────────────────────────────────┘
```

- **Model** and **effort** chips work as in §4 and start with the conversation's values. A change applies to the
  side chat only, and the chip's tooltip says so: "For the side chat only" / "Só para o chat lateral".
- **Permissions** is the read-only chip from §4.3 (`intent-info-bg` / `intent-info-fg`), **fixed**: it has a small
  lock, `aria-disabled`, and a tooltip "The side chat can only read" / "O chat lateral só pode ler". It is not a
  button that opens a popover. This is the one place info color appears, because it is the same chip as everywhere
  else.
- Send is the round `accent` button; Stop replaces it while answering (§3). No `/` or `+` buttons: the side chat
  takes no commands or attachments.

### Closing and discarding

Today closing (✕, Esc or `Mod+.`) throws the copy and its answers away at once. An irreversible action must never be
the default, and Esc is the easiest key to press by accident.

- **Close (✕, `Mod+.`) hides the drawer and keeps the copy** while the conversation stays open in this window.
  Reopening shows the same messages. Esc inside the drawer moves focus back to the conversation without closing it.
- **Discard and close…** in the ⋯ menu ends the copy. With at least one answer it asks first: "Discard the side
  chat? Its answers will be gone." [Keep] [Discard], with Keep as the default. With no answers it closes without
  asking.
- The copy also ends when the conversation is closed, archived or deleted, or when the app quits. It is never
  saved.

> **Decided (TECH LEAD, 2026-11-03), ships in 1.4.1 as FRONTEND's T60** with the tab-switch fix. It needs no
> new BACKEND work: main already keeps the side session alive until `sideClose`, and only the renderer called it on
> unmount. Close hides the drawer and keeps the copy while the conversation exists; Esc only returns focus;
> "Discard and close…" confirms when there are answers, with Keep as the default.

## 8. Decisions

**Decided by the user on 03/11** (relayed by the TECH LEAD): the recommended option in each case.

1. **Agent reply without a bubble** (§2.2).
2. **The permissions chip in danger color for full access** (§4.3).
3. **Tool rows color-coded by kind**, as a 3 px bar only (§2.3).
4. **"Provider's choice"** until the first turn when the provider doesn't report its default model (§4.1).

## 9. Out of scope

The sidebar, the header, the review panel and the Android conversation (`mobile-conversation.md`). The Android
conversation follows in a separate pass once this one is approved, through the C4 token export.
