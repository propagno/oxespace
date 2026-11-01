# OxeVoice 1.5 — Status

Branch `feat/voice-native-1.5`, from `origin/main` `fdf38a2c`. Built with **oxe-build** end to end (program by phases, plan-owned frozen acceptance tests, `claude -p` executor). No push or merge without the user's OK.

## Phases

| Phase | Scope | State |
|---|---|---|
| F1 | Push-to-talk dictation in the OxeChat composer, Windows (WinRT, explicit opt-in) | **Implemented; automated checks green (22/23); waiting for UAT A8 sign-off and hot-file wiring after B21** |
| F2 | macOS on-device (SFSpeechRecognizer) + Linux offline (bundled engine, after size/quality ASK) | pending |
| F3 | Terminal/agents dictation + offline on Windows | pending |

## F1 — what exists (new files only)

- Contract (frozen by the plan): `shared/types/ipc/voice.ts`
- Main:
  - `electron/main/services/voice/{types,consent,protocol,errors,registry,windows-helper}.ts`
  - `electron/main/ipc/voice-session.ipc.ts`
- Helper: `resources/voice/windows-dictation.ps1`
  - PowerShell 5.1, fixed args, no dynamic code, no network.
  - Uses a `RecognizeAsync` loop. PS 5.1 cannot subscribe to WinRT events, so there are no live partials.
- Renderer: `src/features/voice/{VoiceDictationControl.tsx,useVoiceDictation.ts,voice.css}`, plus `thread.json` en/pt-BR keys
- MCP: `code.voice_dictation` is **forbidden** for agents (`shared/mcp-coverage.ts`).
- Acceptance (written before execution, hash-frozen): `tests/integration/voice-native/*` (A1–A7)
- Hot-file wiring **proposal** (not applied): `docs/voice/HOTFILES-PROPOSAL.md`

## Verification

- Frozen acceptance: A1–A7 green, 49 tests in 7 files. Contracts and exports ok. The A5 real WinRT probe ran on Windows 11.
- Independent: `eslint` 0 errors (2 `react-hooks/refs` warnings in `useVoiceDictation.ts` → follow-up). `npm run typecheck` (full, via heavy-lock) clean.
- **A8 (UAT)** is pending. Real dictation on Windows needs "Online speech recognition" enabled in Windows privacy settings; the app never changes it.

## Cost (executor)

10 attempts · 49 `claude -p` turns · US$ 4.34. Planned budget was ~32 turns; the 2× ceiling (~64) was not reached. Of these, 13 turns / US$ 0.75 went to a broken verify command written by the planner, now prevented by `plan lint --dry-verify`.

## PAUSED (2026-11-01)

Paused by the coordinator over the user's quota. No new `claude -p` until the 1.4.0 RC. F1 is committed and verified; nothing is lost.

When it resumes, it starts with the open change requests (`oxe-cc runtime feedback list`). Each one is closed only by a frozen acceptance test that declares `resolves: [CR-NN]`:

| CR | Class | Criteria / tasks | Summary |
|---|---|---|---|
| CR-01 | spec_gap (A7 → v2) | A7 / T6 | DESIGN copy fixes (consent.body, error.generic, unavailable.*) |
| CR-02 | defect | A2 / T3 | Consent revocable in a real place: Settings › Voz › "Serviço de fala da Microsoft" toggle + "Desligado. O ditado volta a pedir permissão." |
| CR-03 | constraint | — | `react-hooks/refs`: no ref writes during render (2 warnings) |
| CR-04 | new_scope (F2) | — | `Mod+Shift+Y` hold-to-dictate in `thread.composer` (approved by DESIGN), `shortcutLabel`, polite start/stop announcement, no pulse under reduced motion |

## Open items

1. The UAT A8 sign-off (user).
2. Apply the hot-file wiring after B21, after an ASK to the coordinator.
3. A shortcut proposal for DESIGN: hold-to-dictate `Mod+Shift+Y`, scoped to the composer.
4. A signed native helper before the 1.5 RC, which would give live partials and lower start latency (item from D-05).
5. Fix the 2 `react-hooks/refs` warnings.
