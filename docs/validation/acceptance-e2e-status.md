# Acceptance E2E Status (`e2e/acceptance/`)

Inventário dos `45` specs de aceite (`36` na raiz + `9` em `e2e/acceptance/oxe152-f6/`) executados por `playwright.acceptance.config.ts` (`npm run test:e2e:acceptance`), integrados em:
- **Noturno (não bloqueante em PR):** `.github/workflows/acceptance-nightly.yml` (`Acceptance e2e (nightly)`)
- **Portão pré-tag de release (bloqueante em `should_release == 'true'`):** `.github/workflows/ci.yml` › job `acceptance-release` (`Acceptance e2e (release gate)`), dependência direta de `release`

Referência de auditoria base: run `43927741132` (`https://github.com/propagno/oxespace/actions/runs/43927741132`, 2026-11-16, pós-`#908` / `OXE-100` `BRD-23`) + emendas autorizadas pelo CR pré-aprovado pela Coordenação em 17/11 (`OXE-296`).

| # | Spec | Status | Última run verde / referência | Notas / CR |
| --- | --- | --- | --- | --- |
| 1 | `e2e/acceptance/AOS-real-approval-over-settings.spec.ts` | Emendado (CR 17/11) | `OXE-296` (pós-`43927741132`) | Linha 182: `Tools` → `Policy` (BRD-23 Workspace settings) |
| 2 | `e2e/acceptance/B10-247-reserved-names.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 3 | `e2e/acceptance/B12-ipc-sender-guard.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 4 | `e2e/acceptance/B19-worktree-include.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 5 | `e2e/acceptance/B20-442-pr-archive-offer.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 6 | `e2e/acceptance/B26-387-safe-git.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 7 | `e2e/acceptance/B477-worktree-remove-links.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 8 | `e2e/acceptance/B7.4-agent-widens-policy.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 9 | `e2e/acceptance/B9.2-458-unused-pairing.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 10 | `e2e/acceptance/B9.2-orphan-pairing-expires.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 11 | `e2e/acceptance/batch-2c.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 12 | `e2e/acceptance/batch-3a.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 13 | `e2e/acceptance/batch-3b.spec.ts` | Emendado (CR 17/11) | `OXE-296` (pós-`43927741132`) | Linhas 52, 161, 191-196, 205: `Tools` → `App › Integrations`; `Devices` → `Integrations › Phone and devices`; `Updates` → `About`; Activity center via `activity-bell` (`Ctrl+Shift+A` passou para `approvals.queue`) |
| 14 | `e2e/acceptance/F14-490-worktree-warnings.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 15 | `e2e/acceptance/F18-243-approvals-modal.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 16 | `e2e/acceptance/F19-310-split-room.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 17 | `e2e/acceptance/F26-306-forced-close.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 18 | `e2e/acceptance/F28-oxequery-typing-no-pageerror.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 19 | `e2e/acceptance/F30-activity-survives-restart.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 20 | `e2e/acceptance/F32-B17-pane-resume.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 21 | `e2e/acceptance/F33-B18-open-in-editor.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 22 | `e2e/acceptance/F34-B21-models-kept.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 23 | `e2e/acceptance/F34-B21-voice-removed.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 24 | `e2e/acceptance/F35-344-team-entry-points.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 25 | `e2e/acceptance/F7-2-all-modes.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 26 | `e2e/acceptance/f7-2-view-switch.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 27 | `e2e/acceptance/G9-report-a-problem.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 28 | `e2e/acceptance/M1-gateway-off-by-default.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 29 | `e2e/acceptance/oxe152-f6/brd09-shell.spec.ts` | Verde | `2026-11-16` · `43927741132` | Foco de painel não ativo auditado em `OXE-297` |
| 30 | `e2e/acceptance/oxe152-f6/brd10-queue.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 31 | `e2e/acceptance/oxe152-f6/brd11-command-bar.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 32 | `e2e/acceptance/oxe152-f6/brd12-first-run.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 33 | `e2e/acceptance/oxe152-f6/brd13-workspace-header.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 34 | `e2e/acceptance/oxe152-f6/brd14-terminal-pane.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 35 | `e2e/acceptance/oxe152-f6/brd15-tool-panels.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 36 | `e2e/acceptance/oxe152-f6/brd16-menus.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 37 | `e2e/acceptance/oxe152-f6/brd23-settings.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 38 | `e2e/acceptance/S2-sessions-survive.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 39 | `e2e/acceptance/S3-conversations-survive-restart.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 40 | `e2e/acceptance/S7.1-agents-overview.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 41 | `e2e/acceptance/T43-preview-access.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 42 | `e2e/acceptance/T44-deferred-main.spec.ts` | Emendado (CR 17/11) | `OXE-296` (pós-`43927741132`) | Linha 15: `Updates` → `About` (BRD-23) |
| 43 | `e2e/acceptance/T46-zwj.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 44 | `e2e/acceptance/T8-tool-text-budget.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
| 45 | `e2e/acceptance/T87-startup-failure.spec.ts` | Verde | `2026-11-16` · `43927741132` | — |
