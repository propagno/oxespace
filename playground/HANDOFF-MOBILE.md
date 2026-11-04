# Handoff: building OxeMobile 1.5 (Android, Compose)

This is for MOBILE. The playground's "Phone (OxeMobile)" screens (`#phone-*`) are the visual reference. The app keeps
its Compose code and its safety logic. The acceptance criteria are in
`.claude/roadmap-1.4/team/plans/1.5.0-mobile-acceptance.md` (ids `MG*`, `M1`–`M8`, `MX`), and the audit in
`plans/1.5.0-mobile-audit.md`.

**Rules:**
- **No protocol change in 1.5.0.** If a screen seems to need data C5 doesn't send, it falls back to what C5 has.
  - The workspace is a neutral chip (name only). The color needs a C5 field (1.5.x).
  - Agents is a flat list.
- **The safety logic stays exactly as it is.** Only its presentation changes:
  - the biometric prompt on every answer;
  - kinds the phone can't answer;
  - the 2 s critical delay;
  - hidden-character detection;
  - redaction.

## Tokens: already wired, now used

`OxeTheme.kt` already maps Material 3 to the Mandacaru roles, and `OxeTokens.kt` is generated from the desktop
tokens. After C4 (#604), run `npm run android:generate` so the light accent becomes 1.5's.

| Need | Use | Not |
|---|---|---|
| Needs you (glyph, badge, question chip, now-banner) | `Oxe.colors.attn`, `attnBg`, `attnFg`, `attnBorder` | any error or warning |
| Errors, warnings, info, success | Notice intents: `intentDanger*`, `intentWarning*`, `intentInfo*`, `intentSuccess*` | `attn`, `error` text on canvas |
| Primary action | `accent` / `textOnAccent` (dark: caatinga, with dark text) | |
| Selected nav, soft fills | `accentSoft` / `textAccent` | |
| Terminal and code | `termBg` / `termFg` / `termLine`, plus the ANSI palette (green `#6cc093`, blue `#7cb8ea`, yellow `#f0b467`, grey `#8b968e`, white `#e7efe9`); in **both** themes | the canvas |
| Provider avatar | `provClaude`, `provCodex` | |

## Components (new or changed)

| Component | What it is | Where |
|---|---|---|
| `OxeMark` | The Mandacaru mark in an accent tile (28 % radius), sizes 30 / 64 dp | App bar (paired), Not paired hero |
| `Notice(intent, icon, title, text, actions)` | 32 dp icon tile, title (Plex 700 15 sp), text, and actions stacked full width | Every problem and explanation (MG5) |
| `StatusGlyph(state)` | A 14 dp ring: needs (attn, filled, with halo), working (accent, open), finished (success, filled), failed (danger, dot), idle (muted ring), stopped (muted, dot), not confirmed (dashed) | Rows, the now line, Agents |
| `ProviderAvatar(p)` | 18 dp (22 in the thread) rounded square with C or X | Rows, the thread, requests |
| `WorkspaceChip(name)` | A neutral mono chip (`surfaceSunken` / `textSecondary`) | Rows, Terminals groups, the terminal bar |
| `RiskChip(level)` | Low: success; Medium: info; High: warning; Critical: a solid danger chip; with an icon | Needs you cards, the request header, the gate card |
| `OxeButton(kind)` | 48 dp, 12 dp radius: primary (accent), secondary (raised + border), ghost (fill + accent text), danger (soft danger) | Everywhere; replaces the pill buttons |
| `HoldAllow` | A secondary button with a conic ring filling over 2 s, "Allow once in N s", then the fingerprint icon | Critical requests (MG2) |
| `BiometricSheet` | The system BiometricPrompt. The playground's sheet only shows the moment; keep the system prompt | Allow and Send answers |
| `NowBanner` | An `attnBg` strip under the app bar: "Needs you. <agent> asks to …" with Review | The conversation |
| `GateCard` | An inline request card with an `attn` left edge: risk chip, title, where, Deny and Review | The conversation |
| `StepsSummary` | A chip: "N steps · read …, ran …" with a chevron, 48 dp | The conversation |
| `PairingStepper` | Four steps; states done, now and failed | Pairing |
| `CodeBoxes` | 6 mono boxes, 44 × 60 dp, grouped 3 + 3 | Pairing confirm |
| `Viewfinder` | A dark square with corner guides (accent, or warning when the code is wrong) and the scan line | Pairing scan |
| `VtScreen` | A character grid from T97/T98 (cols × rows), `term*` palette, cursor block, horizontal scroll, hidden values as grey blocks | The terminal |
| `TerminalKeys` | A fixed row of 48 dp keys with an edge fade, plus the prompt input | The terminal |
| `EmptyState` | 56 dp icon tile, title, text, optional action | Empty lists, "No longer waiting" |
| `SettingsRow`, `OxeSwitch` (48 dp target), `Segmented` | The Settings anatomy | Settings (new) |

## Icons

- **Port #606's paths** (`src/design/icons/*`, from playground `icons.ts`) as `ImageVector`, one file per icon:
  OxeChat (Conversations), OxeCode (Terminals), Agora (Agents).
- **Also add** the phone's own, drawn in `playground/src/components/icons.ts`:
  - `wifi`, `wifi-off`;
  - `monitor` (the computer);
  - `qr`;
  - `fingerprint`;
  - `signal` / `battery` (frame only; don't ship these).
- **Keep** Material icons only for generic actions: back, more, send, check.
- **Replace** `ic_threads`, `ic_requests`, `ic_terminal` and `ic_tasks`. The Needs you tab uses the bell, with the sun badge.

## Type

Bricolage Grotesque, Plex Sans and Plex Mono are already in `res/font`.

| Role | Style |
|---|---|
| Display (Not paired) | Bricolage 750 (ExtraBold file) 32 sp / 1.08, −0.035 em |
| Screen title, H2 | Bricolage 700 17 sp (app bar), 20–22 sp (headings) |
| Body | Plex 400 14.5–15 sp |
| Secondary | Plex 400 12.5 sp, `textSecondary` |
| Times, paths, chips, code, terminal | Plex Mono 400–600, 11.5–13.5 sp |

## Screens and their state, from the 1.4.2 goldens

Nothing is dropped. Every golden state has its 1.5 design. For each state, the `#phone-*` hash and the strip above the
phones show the reference.

| 1.4.2 golden | 1.5 | AC |
|---|---|---|
| `home_unpaired`, `home_revoked` | Hero with the brand; revoked adds a danger Notice | M1 |
| `home_connecting` / `unreachable` / `offline` / `incompatible` | Computer card plus a Notice per problem; a skeleton while connecting | M1 |
| `pairing_*` (12) | Stepper, viewfinder, code boxes, a Notice per failure, success | M2 |
| `live_live-threads` / `requests` / `tasks` / `terminals` / `empty` / `reconnecting` | Glyph rows, Needs you cards, Terminals grouped by workspace, Tasks, an empty state, a banner | M3 |
| (no golden: S7.4 #521) | Agents in the 7 states, flat | M7 |
| `conversation_thread` / `working` / `finished` / `loading` | Now line, gate card, steps chip, plan, skeleton | M4 |
| `requests_request-risky` / `hidden-characters` / `question` / `desktop-only` / `gone`, `risk-levels` | The impact layout, HoldAllow, the hidden marker, the question pager, the "Answer on the computer" Notice | M5 |
| `terminal_terminal-loading` / `read-only` / `typing` | `VtScreen` on `term*`, cols × rows, key row | M6 |
| (none) | Settings | M8 |

## Order (suggested for the OXE phase)

1. **Tokens.** Regenerate after C4 and add the ANSI roles to the generator, with no screen change.
2. **Components.** Notice, StatusGlyph, OxeButton, RiskChip, EmptyState, and the icons.
3. **Screens:**
   1. Home (M1);
   2. Pairing (M2);
   3. Live (M3) plus Agents (M7, after #521);
   4. Conversation (M4);
   5. Requests (M5);
   6. Terminal (M6, with T97/T98);
   7. Settings (M8).
4. **Re-record the goldens once,** at the end of the batch, in en and pt-BR, light and dark.

## What not to copy from the playground

- The device frame, the status bar and the gesture bar.
- The fake biometric sheet (use `BiometricPrompt`).
- The mock data.
- CSS `zoom`.
- The phone's notifications switches are local preferences, not synced to the desktop.
