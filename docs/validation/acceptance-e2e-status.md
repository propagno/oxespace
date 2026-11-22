# Acceptance E2E Status (`e2e/acceptance/`)

Inventário dos `45` specs de aceite (`36` na raiz + `9` em `e2e/acceptance/oxe152-f6/`) executados por `playwright.acceptance.config.ts` (`npm run test:e2e:acceptance`), integrados em:
- **Noturno (não bloqueante em PR):** `.github/workflows/acceptance-nightly.yml` (`Acceptance e2e (nightly)`)
- **Portão pré-tag de release (bloqueante em `should_release == 'true'`):** `.github/workflows/ci.yml` › job `acceptance-release` (`Acceptance e2e (release gate)`), dependência direta de `release`

Referência de auditoria: o primeiro acceptance-nightly completo na main, run `44911292689` (2026-11-21, main `07d8df07c`, ubuntu-24.04): 54 de 72 testes verdes, 18 vermelhos. Os specs vermelhos foram revistos em `OXE-330` e conferidos em remote-verify (`44921647539`, `44923842852`, `44924861446`). A referência anterior, `43927741132`, era um remote-verify falhado de outro PR (`ci/remote-verify/rv-908frozen2`) e não provava nenhum destes specs.

**Achados de produto** (vermelhos até o card deles; bloqueiam o `acceptance-release`): F7.2 (esqueleto do OxeChat antes de 300 ms, #807/OXE-58), F19 (painel de 238 px, F9 T4), F30 (o sino não volta depois de reiniciar: o renderer nunca lê `window.oxe.activity`), S3 (aninhamento da conversa filha, nunca feito).

| # | Spec | Status | Última run verde / referência | Notas / CR |
| --- | --- | --- | --- | --- |
| 1 | `e2e/acceptance/AOS-real-approval-over-settings.spec.ts` | Emendado (CR 17/11) | `OXE-296` (pós-`43927741132`) | Linha 182: `Tools` → `Policy` (BRD-23 Workspace settings) |
| 2 | `e2e/acceptance/B10-247-reserved-names.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 3 | `e2e/acceptance/B12-ipc-sender-guard.spec.ts` | Emendado (OXE-330) | `44921647539` | `fs:write-file` saiu (G5, #754): fora da lista |
| 4 | `e2e/acceptance/B19-worktree-include.spec.ts` | Emendado (OXE-330) | `44924861446` | `worktree.copyFiles` (revisão do ARCHITECT); relatório pelos avisos da conversa; o limite de tamanho fica no teste de integração |
| 5 | `e2e/acceptance/B20-442-pr-archive-offer.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 6 | `e2e/acceptance/B26-387-safe-git.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 7 | `e2e/acceptance/B477-worktree-remove-links.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 8 | `e2e/acceptance/B7.4-agent-widens-policy.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 9 | `e2e/acceptance/B9.2-458-unused-pairing.spec.ts` | Pulado no Linux (OXE-330) | `44921647539` | O gateway precisa do cofre do SO; roda no Windows (`os: windows-2022`) |
| 10 | `e2e/acceptance/B9.2-orphan-pairing-expires.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 11 | `e2e/acceptance/batch-2c.spec.ts` | Emendado (OXE-330) | `44921647539` | #173 no painel Containers (OxePod saiu, #754); #208 aceita `policy.change.pending` (B7.4) |
| 12 | `e2e/acceptance/batch-3a.spec.ts` | Emendado (OXE-330) | `44921647539` | Os três modos (OxePod saiu, #754) |
| 13 | `e2e/acceptance/batch-3b.spec.ts` | Emendado (CR 17/11) | `OXE-296` (pós-`43927741132`) | Linhas 52, 161, 191-196, 205: `Tools` → `App › Integrations`; `Devices` → `Integrations › Phone and devices`; `Updates` → `About`; Activity center via `activity-bell` (`Ctrl+Shift+A` passou para `approvals.queue`) |
| 14 | `e2e/acceptance/F14-490-worktree-warnings.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 15 | `e2e/acceptance/F18-243-approvals-modal.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 16 | `e2e/acceptance/F19-310-split-room.spec.ts` | Vermelho: achado de produto | — | 238 px: `splitRoom.ts` conta 10 px de margem, a grade usa 12 na borda |
| 17 | `e2e/acceptance/F26-306-forced-close.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 18 | `e2e/acceptance/F28-oxequery-typing-no-pageerror.spec.ts` | Emendado (OXE-330) | `44921647539` | MongoDB digita no campo Filter (sem Monaco) |
| 19 | `e2e/acceptance/F30-activity-survives-restart.spec.ts` | Vermelho: achado de produto | — | Só o lado do main existe (376c20762) |
| 20 | `e2e/acceptance/F32-B17-pane-resume.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 21 | `e2e/acceptance/F33-B18-open-in-editor.spec.ts` | Emendado (OXE-330) | `44923842852` | O clique no caminho só quando o texto do terminal está no DOM |
| 22 | `e2e/acceptance/F34-B21-models-kept.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 23 | `e2e/acceptance/F34-B21-voice-removed.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 24 | `e2e/acceptance/F35-344-team-entry-points.spec.ts` | Removido (OXE-330) | — | Team saiu do OxeCode (F9 T3) |
| 25 | `e2e/acceptance/F7-2-all-modes.spec.ts` | Vermelho: achado de produto | — | OxePod fora; resta o esqueleto do OxeChat antes de 300 ms (#807) |
| 26 | `e2e/acceptance/f7-2-view-switch.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 27 | `e2e/acceptance/G9-report-a-problem.spec.ts` | Emendado (OXE-330) | `44921647539` | Help no menu inline ao lado do logo (#760) |
| 28 | `e2e/acceptance/M1-gateway-off-by-default.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 29 | `e2e/acceptance/oxe152-f6/brd09-shell.spec.ts` | Verde | `2026-11-21` · `44911292689` | Foco de painel não ativo auditado em `OXE-297` |
| 30 | `e2e/acceptance/oxe152-f6/brd10-queue.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 31 | `e2e/acceptance/oxe152-f6/brd11-command-bar.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 32 | `e2e/acceptance/oxe152-f6/brd12-first-run.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 33 | `e2e/acceptance/oxe152-f6/brd13-workspace-header.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 34 | `e2e/acceptance/oxe152-f6/brd14-terminal-pane.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 35 | `e2e/acceptance/oxe152-f6/brd15-tool-panels.spec.ts` | Verde (OXE-330) | `44921647539` | A barra de Changes e de Browser deixou de ser um segundo `<header>` |
| 36 | `e2e/acceptance/oxe152-f6/brd16-menus.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 37 | `e2e/acceptance/oxe152-f6/brd23-settings.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 38 | `e2e/acceptance/S2-sessions-survive.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 39 | `e2e/acceptance/S3-conversations-survive-restart.spec.ts` | Vermelho: achado de produto | — | Aninhamento por delegação nunca feito |
| 40 | `e2e/acceptance/S7.1-agents-overview.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 41 | `e2e/acceptance/T43-preview-access.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 42 | `e2e/acceptance/T44-deferred-main.spec.ts` | Emendado (CR 17/11) | `OXE-296` (pós-`43927741132`) | Linha 15: `Updates` → `About` (BRD-23) |
| 43 | `e2e/acceptance/T46-zwj.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 44 | `e2e/acceptance/T8-tool-text-budget.spec.ts` | Verde | `2026-11-21` · `44911292689` | — |
| 45 | `e2e/acceptance/T87-startup-failure.spec.ts` | Emendado (OXE-330) | `44923842852` | "Technical message" (CR-10); foco da janela antes de copiar |
