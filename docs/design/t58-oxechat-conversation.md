# T58: OxeChat conversation redesign (1.5.0)

Status: **proposal, waiting for the user's approval**. Owner: DESIGN. Builds on FRONTEND's T57 (1.4.1).

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

## 8. Decisions for the user

1. **Agent reply without a bubble** (§2.2), or a light `surface-raised` bubble on the left too? Recommended: no bubble.
2. **The permission chip in danger color for full access** (§4.3). Recommended: yes. It is the riskiest state and
   should be impossible to miss.
3. **Tool rows color-coded by kind** (§2.3). Recommended: yes, as a 3 px bar only.
4. **Name when the provider doesn't report its default model**: "Provider's choice" until the first turn
   (recommended), or keep the strip empty until it is known.

## 9. Out of scope

The sidebar, the header, the review panel and the Android conversation (`mobile-conversation.md`). The Android
conversation follows in a separate pass once this one is approved, through the C4 token export.
