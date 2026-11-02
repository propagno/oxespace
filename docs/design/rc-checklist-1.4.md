# 1.4 RC design checklist

> The walkthrough DESIGN runs, with HOMOLOGATION, on the release candidate build before the cut. Run it on the
> **installed RC build**, not a dev build, on a **throwaway profile** (never the person's live data). Owner: DESIGN/PRODUCT.
> Result: one row per screen with PASS / FAIL and the finding id. Each FAIL goes to its owner as a FINDING.

## 0. How to run it

**Passes.** Each screen is checked in every pass below. A pass that has nothing to do with a screen is marked `n/a`,
never left blank.

| Pass | How |
|---|---|
| **L** light / **D** dark | Settings › Appearance › mode |
| **FC** forced colours | Windows: Settings › Accessibility › Contrast themes (Desert or Night sky). Linux has no system mode: use the e2e emulation (`emulateMedia({ forcedColors: 'active' })`, as in `e2e/forced-colors-selection.spec.ts`) |
| **Den** density | Comfortable and Compact; interface scale 100 % and 150 % |
| **RM** reduced motion | Settings › Appearance › Motion › Reduced: no pulse and no shimmer, and the spinner turns slowly |
| **pt** / **en** | the language setting, switched without a restart; nothing is left in the other language |
| **KB** keyboard | the screen reached and used without a mouse: F6 between regions, Tab and Shift+Tab, Enter and Space, Esc, Shift+F10 / the menu key. Focus is always visible |
| **W** width | 1280 px and 960 px (the narrow layout); nothing cut, no horizontal scroll |

**States.** Each screen lists the states it must show. Each one is checked as it is reached, in words from the
[glossary](glossary.md):

| State | What "right" looks like |
|---|---|
| **empty** | `EmptyState` that says what goes here and gives the first action. Never a blank panel |
| **loading** | the view's own skeleton after 300 ms ([view-skeletons.md](view-skeletons.md)); a `Spinner` only inside a control. Never the brand loader outside boot and offline |
| **error** | `ErrorState` that says what failed ("Não foi possível …") and offers **Tentar de novo**, keeping what was already shown |
| **offline** | `OfflineState`, or the part that can't reach its source saying so. The rest keeps working |
| **no permission** | the action is there, disabled, with its reason reachable by keyboard (`aria-disabled` + hint), or refused with a C3 message in place. Never a silent no-op |

**Always, on every screen:**
- **Targets:** 24 px or more.
- **Names:** no text that only shows in a tooltip, and an accessible name equal to the visible label (WCAG 2.5.3).
- **Copy:** no English in pt-BR, and none of the words the glossary says never to show ("worker", "Thread", "Team",
  "Agent Work").
- **Surface:** tokens only, with no stray colour.

## 1. OxeCode

| # | Screen / flow | States | Look for |
|---|---|---|---|
| C1 | Workspace list (sidebar) | empty (no workspace), loading, error | tree weight and alignment (V11), one "Workspaces" label (V10) |
| C2 | Pane grid, 1 to 4 panes, split | loading (skeleton per saved layout), split refused | the refused split says why ("Não é possível dividir este painel aqui"); the focused pane is visible in both themes (V6) |
| C3 | Pane header and footer | starting, working, needs you, finished, idle, stopped, not confirmed, exited | state words from `agents.state.*`; the dot is never the only sign; one ⋯ menu (V8) |
| C4 | Terminal details (Agent session row) | found, not found, resumed, started fresh, not resumed | "Origem", "Último início"; the id is cut in the middle; the copy is confirmed |
| C5 | Changes and GitHub panels | empty, loading, error, no repository | one chip style (V12, V13), labelled tabs (V14), "Visto" checkbox (V15) |
| C6 | Worktree finish dialog | integrate, discard, already gone | Cancel has the focus; consequences in words |
| C7 | Command palette | empty search, long list | sentence-case groups (V16); every command named and with its shortcut |
| C8 | Agents central (S7, `Mod+Shift+G`) | empty, filter empty, partial source, read model failed, not confirmed | [s7-mission-control.md](s7-mission-control.md) §5.7; rows never jump under the pointer; Respond opens the modal |

## 2. OxeChat

| # | Screen / flow | States | Look for |
|---|---|---|---|
| T1 | Conversation list, sections, menu | empty (no project), loading, no matches, archived | sections kept after a restart; Shift+F10 menu; "Sem seção" |
| T2 | Conversation timeline | opening (skeleton after 300 ms), long history, failed turn, interrupted tool | the switch keeps the current conversation up to 300 ms; Interrompida → Continuar / Dispensar |
| T3 | Request card and approval | each kind, hidden, expanded | "Pedido de um agente"; Permitir / Negar; the agent's text apart from the app's notes |
| T4 | Side chat (`Ctrl+.`) | opening, empty, answering, failed | "Cópia somente leitura"; nothing reaches the conversation |
| T5 | Conversation details panel | no context report yet, no tools, no files, nothing in background | "Custo informado" vs "estimado"; the reorder works by keyboard |
| T6 | Project settings, semantic search | indexing, indexed, failed | progress in words |
| T7 | Project team (Tools › Project team…, `Ctrl+Shift+T`) | no members, no target (disabled with a reason) | "Equipe do projeto"; roles "Coordenadora" … |

## 3. OxeQuery, OxePod, OxePost

| # | Screen / flow | States | Look for |
|---|---|---|---|
| Q1 | Connections and SQL editor | no connection, connecting, failed, production | at most two toolbar rows (V29); production marked in words |
| Q2 | Result grid | empty result, Load more, error, long values (JSON viewer) | filter and pin by keyboard |
| Q3 | Production write confirm | typed name wrong, right | refuses until the name matches |
| P1 | OxePod lists and logs | no engine (Docker/Podman missing), empty, error | the missing engine says how to fix it; "contêiner" |
| P2 | Container actions | confirm, refused | a database container warns about open connections |
| O1 | OxePost request and response | no collection, sending, error, timeout | Send disabled with a reason while sending |
| O2 | Environments and secrets | empty, a secret hidden or shown | a secret never shown by default |
| O3 | Production confirm (OxePost) | typed host | same rule as Q3 |

## 4. Approvals and other cross-cutting flows

| # | Screen / flow | States | Look for |
|---|---|---|---|
| A1 | Approval modal (F18) | low, medium, high, critical (2 s hold, Enter does nothing), cut text (Deny only), queue "Pedido 1 de N", expired, refused | Deny focused; risk word + one-liner; **Onde** row; app requests read "OXESpace" |
| A2 | Policy change (B7.4) | widened, partial, not split, deleted, invalid, too large, worktree; narrowing toast; Settings pending / not in force; `policy.change.pending` under the control | [b7.4-policy-change.md](b7.4-policy-change.md) §8 |
| A3 | Close guard (F26) | unsaved editor files and OxePost requests; save fails | Cancel focused; "nada foi fechado" |
| A4 | Activity center (the bell, `Ctrl+Shift+A`) | empty, needs you, finished, new | survives a restart |
| A5 | Needs-you notification (S7) | window unfocused for the delay; batch | one per request; the click opens Respond |
| A6 | Boot splash and offline | slow start, offline | brand loader only here |
| A7 | Help › Report a problem | preview, redacted, saved | nothing is sent anywhere |

## 5. Settings

| # | Page | States | Look for |
|---|---|---|---|
| S1 | Shell (breadcrumb, nav, search) | first open (page skeleton) | breadcrumb ends with the page (V26); single-scope picker hidden (V27) |
| S2 | General, Appearance, Keyboard | — | mode cards aligned (V25); Motion System / Reduced / Full; the shortcut guide |
| S3 | Terminal | — | Resume agent sessions |
| S4 | Notifications | hooks installed, partial, not installed, error; Node.js missing (B25) | the nudge delay Off/1/2/5 minutes; turning a hook on is disabled with a reason when Node is missing |
| S5 | Tools (F10) | loading, error, rules failing, empty other servers, read-only policy, saving, refused | "Essenciais", "Tarefa delegada", "Equipe"; the mode is saved with "Modo de … neste projeto" |
| S6 | Policy | no file, invalid file, pending change, not in force | the accepted rules are listed, not the file's |
| S7 | Devices (phone connection) | off, listening, pairing code, paired, connected / not connected, 5 devices | the Windows firewall step; "Remover" confirmed |
| S8 | Updates | each status | "Atualização … disponível"; beta opt-in |
| S9 | Diagnostics | all passing, warnings (Node.js), incidents | `incident.mcp.toolGroupOff`; export preview |

## 6. Phone (Android)

Run on the AVD and on one physical device, in both themes and both languages, with TalkBack for the A11y pass. The
reference is [mobile-audit-1.4.md](mobile-audit-1.4.md).

| # | Screen / flow | States | Look for |
|---|---|---|---|
| M1 | Pairing | camera denied, code expired, used, wrong network, another device answered, 5 devices | each message from the S4 guide page; "Confirme no computador" and the matching code |
| M2 | Home and tabs | connecting, connected, offline (its only action isn't just Unpair, P-audit H) | state words masculine (`agents.state.*`) |
| M3 | Agents (S7.4) | needs you, working, finished, not confirmed, a computer-only request | the computer-only reason; never Allow on a guarded request |
| M4 | Request screen | biometrics, approved, denied, expired | Permitir / Negar; Allow isn't emphasised on risky requests (P1) |
| M5 | Live terminal and conversation | send, steer (Orientar), stop | FLAG_SECURE on requests and terminal (M9) |
| M6 | Notifications | needs-you push goes to RequestScreen | one tap to answer |

## 7. Exit

- Every row is PASS, or FAIL with a finding that the coordinator has accepted for 1.4.x.
- An H finding blocks the RC. An M finding blocks it unless the coordinator defers it in writing. An L finding is
  listed in the release notes' Known limits only if a person would notice it.
- The release notes' voice is checked against the glossary the same day (`docs/releases/_template-1.4.0*.md` → `1.4.0.md` at the cut).
- Screenshots of FAILs: `docs/validation/assets/rc-1.4/<row>.<pt-BR|en>.<light|dark>.png`.
