# View skeletons (F7.2 follow-up, L1)

> The shape each view shows when it takes more than 300 ms to load. These are rule 3 of
> [motion.md](motion.md#switching-views-and-loading-perceived-performance): the shape of the view's content, never
> the brand loader and never a bare spinner. Owner: FRONTEND. The follow-up to #363 replaces the generic
> `ViewSkeleton` with one shape per view.

## 1. Rules for every shape

- **Primitives only:** `Skeleton` (text lines, `variant="block"`) and `SidebarSkeleton`, plus two small additions
  (§3). No new colours, no new keyframes: the shimmer is `oxe-shimmer`, and it stands still under reduced motion.
- **The same frame as the real view:** the skeleton fills the view's own regions (header, toolbar, body) at the same
  heights, so the content doesn't jump when it arrives. Heights are tokens (`--control-sm/md/lg`, `--space-*`), never
  pixels.
- **Static chrome is real, not grey:** a view header, a tab label or a button that doesn't depend on data is drawn for
  real and disabled (for example OxePost's **Send**). Only data-dependent parts are skeleton.
- **One announcement:** the root keeps `role="status"`, `aria-label="Loading {view}"` and `data-view-skeleton`. Every
  part inside is `decorative`. #363's focus rule waits for `data-view-skeleton` to go.
- **No more than the screen holds:** row counts below are for a 720 px-high work area. Fewer rows show when it's
  shorter; it never scrolls.
- **One component per view:** `ViewSkeleton` takes the view (`<ViewSkeleton view="data" />`) and renders the shape
  below. Unit tests snapshot each view's structure, and one visual baseline per view goes in the next baseline batch.

## 2. Shapes

### OxeCode (opening a workspace whose terminals aren't ready)

```
┌ pane header ─────────────┐┌ pane header ─────────────┐
│ ▭▭▭▭▭▭▭▭        ▭        ││ ▭▭▭▭▭▭▭▭        ▭        │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ ││ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬            ││ ▬▬▬▬▬▬▬▬▬▬▬▬▬            │
```
- One cell per pane of the workspace's **saved layout** (the count and the split are known before the terminals
  start), so the grid doesn't reflow when they arrive.
- Each cell has a real pane header frame with a title line skeleton, and a body of 3 short text lines on the terminal
  background token. No fake prompt or fake text.

### OxeQuery

```
[tabs: ▭▭▭▭ ▭▭▭▭]                                   (real tab strip; tab names are skeleton)
┌ editor ────────────────────────────────────────┐  block, 40% of the height
└────────────────────────────────────────────────┘
[Run] [Run all] [Limit ▭]                           (real toolbar, disabled)
▭▭▭▭  ▭▭▭▭▭▭  ▭▭▭▭  ▭▭▭▭▭                           grid header: 4 column lines
▬▬▬▬  ▬▬▬▬▬▬  ▬▬▬▬  ▬▬▬▬▬   × 6 rows
```
- The sidebar is the existing `SidebarSkeleton` (connections).
- The grid rows use the grid's own row height token, so the first real row lands where the skeleton row was.

### OxePod

```
[Containers | Images | Volumes | Networks]          (real tabs; the selected one is the last opened)
▭▭▭▭▭▭▭  ▭▭▭▭  ▭▭▭▭▭▭▭▭▭  ▭▭▭▭                       header: name · status · image · ports
●  ▬▬▬▬▬▬▬  ▬▬▬  ▬▬▬▬▬▬▬▬▬  ▬▬▬   × 8 rows           a status-dot-sized circle per row, neutral fill
```
- The leading circle is neutral, never a state colour, so no state is implied before it's known.

### OxePost

```
[▭▭▭ ▾] [▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬]  [Send]      method chip · URL bar · real Send, disabled
[Params | Headers | Body | Auth]                    (real tabs)
┌ body ──────────────────────────────────────────┐  block, 30% of the height
└────────────────────────────────────────────────┘
Response ─────────────────────────────────────────  real label; below it 4 text lines
```
- The request list sidebar is `SidebarSkeleton`.

### OxeChat (a conversation opening, and a mode switch into OxeChat)

```
▭▭▭▭▭▭▭▭▭▭▭▭                         ▭  ▭           header: title line · two action placeholders
                ┌──────────────────────┐            the person's message: right-aligned block, 2 lines
                └──────────────────────┘
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                  the agent's answer: 4 text lines, full width
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
┌ composer ──────────────────────────────────────┐  real composer frame, disabled, at the bottom
└────────────────────────────────────────────────┘
```
- It replaces today's `.thread-opening` (2 lines + block + 3 lines). The composer frame stays at the bottom, so the
  page doesn't move when the conversation arrives.
- **Conversation switches** (#363) show the same shape after their 300 ms hold.

### Settings page (first open)

- The page title is real (the page name is known). Below it go 6 field rows, each a label line and a control-height
  bar (`--control-md`), in the page's own column width.

## 3. Primitive additions (small)

- `Skeleton` gets a `height` prop that takes a token name (`'control-sm' | 'control-md' | 'control-lg'`), for bars that
  stand in for controls. The default stays the current text height.
- `SkeletonDot`: a circle the size of `StatusDot`, neutral fill (`--fill-hover`), decorative. Used only by OxePod's
  rows.

## 4. Acceptance

1. Each view, loaded cold past 300 ms, shows its own shape. When the content arrives, nothing above the fold moves by
   more than one line (checked on the view's first real row and its toolbar).
2. One announcement per load ("Loading OxeQuery"), and focus moves when the content arrives (#363).
3. Reduced motion: no shimmer. Forced colours: the bars keep an edge (`CanvasText` outline on `.skeletonBar`, as for
   the dots in V1).
