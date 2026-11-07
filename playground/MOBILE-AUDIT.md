# 1.5.0 phone audit against the Mandacaru 1.5 identity (DESIGN)

**Inputs (read-only):**
- the screenshot goldens on main (`mobile/android/app/src/test/snapshots/images`, 154 files: 43 states × en/pt-BR × light/dark, plus 6 a11y overlays);
- `ui/theme/OxeTheme.kt` and `OxeTokens.kt` (generated from the desktop tokens);
- `res/drawable` and `res/font`;
- the approved desktop playground (#577) with FIDELITY and HANDOFF.

No AVD was run. Contact sheets are in the DESIGN scratchpad.

**The user's complaint:** "nothing references the OXESpace theme". It holds, with one nuance: the plumbing is already
there, but nothing on screen shows it.
- **Tokens:** every Material 3 slot is filled from the Mandacaru roles (`oxeColorScheme`), and the three families
  ship in `res/font` (Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono).
- **What fails is how they're used.** The screens are stock Material layouts:
  - no brand mark;
  - no hierarchy beyond one heading;
  - no status glyphs;
  - no workspace identity;
  - no surfaces of their own;
  - generic icons;
  - the "needs you" color used for every error.

So the phone reads as a generic green Material app, not as OXESpace.

## Findings that cut across every screen (MG = mobile global)

| Id | Finding | Desktop reference |
|---|---|---|
| MG-1 | **No brand.** The only branding is the launcher icon. No screen shows the Mandacaru mark, the "OXESpace" wordmark or the sun; the top bar shows just the computer's name ("Studio"). | Title bar: Logo plus mode identity; first-run hero |
| MG-2 | **`attn` (the sertão sun) used for errors.** Unreachable, offline, incompatible, revoked, a bad code and "connection lost" all render in the amber attention color. On the desktop, `attn` means only "needs you". Errors use `intent-danger`, and warnings `intent-warning` inside a Notice. | Mandacaru 1.5: `attn` = needs you only (C4) |
| MG-3 | **Errors are bare paragraphs**, with no Notice or Callout anatomy (icon, title, text, action). | U6 Notice (#616) |
| MG-4 | **No status glyphs.** Conversation state is a colored word ("Working", "Needs you (1)", "Failed"), with no ring or glyph. The desktop has one glyph vocabulary: the status rings, the needs-you sun and the drift glyph. | `.sg` glyphs, NowLine |
| MG-5 | **No workspace identity.** Rows say "oxespace" or "site" in grey text. The desktop gives each workspace its color, `--ws-N` plus `-fg` chips (T85). **Limit:** `RemoteWorkspace` is `{ id, name, active, panes }`, with no color (checked in `shared/remote/protocol.ts`), so in 1.5.0 the phone shows the workspace as a **neutral chip with its name**. The color comes later, with a C5 field (1.5.x, the same item as MOBILE-4-4). Don't derive it from a local hash, because a color the user picked on the desktop wouldn't match. | Workspace chip, `data-ws` |
| MG-6 | **Generic Material icons** (`ic_threads`, `ic_requests`, `ic_terminal`, `ic_tasks`). The desktop ships its own Mandacaru set (#606): OxeChat, OxeCode, Agora, History. | #606 paths |
| MG-7 | **Empty pages.** Every state uses the top 25 % of the screen and leaves the rest blank. There is no empty-state anatomy (icon, title, text, action) and no illustration. | EmptyState, first run |
| MG-8 | **One button style for everything.** Full-width pill primaries everywhere ("Scan again", "Try again", "Done"); outline secondaries; bare text links. The desktop has the 1.5 button set (primary, secondary with a fill, ghost with a fill, danger) at a 24/32/40 rhythm. | Button (extended), C-02 |
| MG-9 | **Type hierarchy is flat.** One Bricolage heading, then Plex body text at a single size. The 1.5 bolder display weight (750) and the label scale aren't used, and secondary text is often `textSecondary` on canvas at 12 sp. | 750 display, the type scale |
| MG-10 | **The light accent is still pre-C4** (deep green buttons), while dark already shows caatinga. Expected until #604 regenerates OxeTokens. Note it so the redesign doesn't encode the old value. | C4 #604 |
| MG-11 | **The bottom navigation is Material's pill indicator,** labelled Conversations / Requests / Terminals / Tasks. There's no Agents tab yet (S7.4 #521 is a draft), and "Requests" duplicates what the desktop calls approvals and questions. The badge is a red dot, while the desktop's needs-you count is the sun. | Needs-you pill, Agora |
| MG-12 | **No settings screen.** The ⋮ menu holds Enter the computer's address and Unpair. The phone's own settings (notifications, biometric, theme, the computer's name, typing from the phone) have no home. | Settings › Devices |

## Per screen

### M1 Home and connection states (`home_*`: connecting, unpaired, unreachable, offline, incompatible, revoked)
- **Unpaired:** "Your desktop, in your pocket" is the only screen with a voice, but it has no brand, no picture of
  what you get, and its button floats at the top.
- **Paired states:** the same layout ("Paired with Studio" plus one amber line plus buttons), so connecting, offline,
  unreachable and incompatible look alike (MG-2, MG-3).
  - "Trying again in 8 seconds" is grey 12 sp text with no progress.
  - Connecting is a thin bar under the heading.
- **Revoked:** the amber error sits *above* the heading.
- **Overall:** nothing shows the computer as a place: no computer card with its name, its workspaces, the last seen
  time or the connection state.

### M2 Pairing (`pairing_*`, 12 states)
- **The flow is sound and the copy is excellent** (it's the 1.4.1 hardening: Public Wi-Fi, firewall, wrong
  certificate, local-network permission).
- **The scanner** is a black square with no framing guide.
- **Five failure states** (refused, timed out, unreachable, wrong certificate, blocked) are paragraphs plus "Scan
  again", with nothing that says which one you're in at a glance: no icon, no title.
- **Confirm:** "Confirm on your computer" shows the code `28T5CY` in plain mono with a thin progress line. It's the
  security moment, and it has no visual weight. The desktop shows the same code under its QR with the fingerprint.
- **Paired** is a heading plus Done, with no success moment.
- **Steps:** there's no step indicator (scan → contact → confirm → paired).

### M3 Live (`live_*`: threads, requests, tasks, terminals, empty, reconnecting)
- **Lists are bare text rows with dividers.**
  - Status is a colored word.
  - The workspace is grey text.
  - There's no glyph, time or provider avatar.
- **"Needs you (1)"** is amber text inside a row. On the desktop it's the row glyph plus the "Asks to…" line.
- **Terminals:** grouped by workspace in grey ("oxespace", "site"), which matches the 1.4 structure (good), but with
  no workspace color and no card.
- **Tasks:** "Background jobs" and "Delegations" sections, plain rows.
- **Reconnecting:** an amber subtitle under "Studio". It should be a connection banner.
- **Empty:** "No conversations on Studio yet." in grey at the top.

### M4 Conversation (`conversation_*`: thread, working, finished, loading)
- **Closest to the desktop thread.**
  - User bubble, "Worked · N steps" folds, plan card, "Agent's answer" card with code.
  - The working spinner.
  - "Request waiting for your answer ↓" pill.
  - The composer with Stop.
- **Gaps:**
  - There's no NowLine (the header subtitle "Working · 2 min ago · Claude" does part of the job).
  - The provider avatar is missing.
  - The request card at the bottom, "Risk: Critical · Request from an agent · Respond", doesn't follow the desktop's
    inline gate card (title, where, irreversible, Deny / See impact).
  - The step rows use Material checkmarks, not the desktop's tool-group summary line.

### M5 Approvals and questions (`requests_*`, risk levels)
- **The safety rules are all present and correct:**
  - Deny is the primary, Allow once a quiet secondary;
  - "Critical risk: Allow becomes available in 2 s";
  - "Answer on the computer" for desktop-only requests;
  - hidden characters shown as `(U+202E)`;
  - "OXESpace hasn't checked this text";
  - the biometric prompt.
  Keep every one.
- **Visual problems:**
  - The risk chip "Risk: Critical" uses Material error red, and Low/Medium/High use ad-hoc tints. The desktop's
    4-level risk uses the intent scale (`ok`, `info`, `warning`, `danger`) with the danger solid only for critical.
  - The impact facts (Requested by, Where, Tool) are a plain two-column list. The desktop impact preview uses `facts`
    blocks with the irreversible callout.
  - "Allow once" is disabled grey text with no countdown visual: the 2 s delay should read as a hold ring like the
    desktop's.
  - Question options are Material radio cards. The desktop uses the question pager with option descriptions.
  - "Answer on the computer" is an amber box (MG-2). It should be an info Notice with the computer's name.

### M6 Terminal (`terminal_*`: loading, read-only, typing)
- **It's drawn as a log on the light surface:** grey canvas, colored text, no terminal background.
- The desktop's terminal tokens (`term-bg #0f1411`, `term-fg`, `term-line`) are in OxeTokens but not used.
- **Per the TECH LEAD it must be a terminal, not a log:**
  - T97 gives a real VT model; T98 gives a serialized screen with cols and rows.
  - It needs a fixed character grid, a cursor, the `term-*` palette in both themes, and a size line ("80×24").
- **The key row** (Esc, Tab, ⇧Tab, Ctrl+C, ↑, ↓) is a row of Material pills and scrolls off the right edge.
- **The input** "Type in this terminal" with Send is a separate field, not a terminal prompt.
- **"Read-only" and "You can type here"** are grey subtitles. The desktop shows a typing badge ("Phone").

### M7 Agents tab (S7.4, draft #521, fake data): no golden on main
To design from the S7.1 read model, mirroring Agora (T82):
- the 7 states in the phone's words;
- needs you first;
- a flat list on the phone (MOBILE-4-4: no workspace grouping in 1.5.0, because there's no C5 field).

### M8 Settings: doesn't exist
A new screen (MG-12), local only, with no protocol change:
- the paired computer (name, last seen, Unpair);
- notifications;
- the biometric requirement (shown, not changeable: it's a safety rule);
- appearance (system, light, dark);
- typing from the phone (status from the desktop);
- About (version and licences, `assets/licenses`).

## What to keep (strengths)
- **Copy:** clear, specific, already in both locales.
- **Safety rules:** biometric on every answer, desktop-only kinds, the critical 2 s delay, hidden characters,
  "unchecked text". These must survive the redesign unchanged.
- **Plumbing:** fonts and tokens are already wired through `OxeTheme`, so the redesign is mostly layout, components
  and icons, not a new theme.
- **Accessibility:** the a11y snapshots show labelled regions and headings. Keep the structure and touch targets.

## Size estimate (for the OXE phase)

| Area | Work |
|---|---|
| Components | Notice, StatusGlyph, WorkspaceChip, ProviderAvatar, EmptyState, button set, risk chip on the intent scale, hold ring, terminal surface: M |
| Icons | Port #606 plus the phone's own (needs-you, settings, agents) as ImageVector: S |
| Screens | M1 S, M2 M, M3 M, M4 M, M5 M, M6 M (with T97/T98), M7 M, M8 S |
| Snapshot re-record | Every golden, once, after the batch |
