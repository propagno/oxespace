# Seen-Pane E2E Audit (`__oxeE2eAgentState` / `setAgentState`)

Auditoria de todos os specs em `e2e/` que invocam `__oxeE2eAgentState` / `setAgentState` (OXE-297).

No produto, um painel terminal ativo e visível com a janela em foco nasce marcado como `seen: true` (comportamento correto de negócio, preservado inalterado). No Linux `xvfb` a janela nasce sem foco (`seen: false`), mas em runners Windows a janela nasce em foco; portanto qualquer spec que dependa de contador não lido (`ActivityCenter`, `ModeSwitch` ou `NeedsYouPill`) precisa focar explicitamente outro painel antes de disparar `setAgentState` (sem `window.blur()`, seguindo o padrão da `CR-F6-32` / `#910`).

| # | Spec | Painel focado antes | Painel sinalizado | Depende de não lido (`seen: false`)? | Ação / Status |
| --- | --- | --- | --- | --- | --- |
| 1 | `e2e/acceptance/oxe152-f6/brd09-shell.spec.ts` | `panes[0]` (após CR OXE-297) | `panes.at(-1)` | Sim (`needs-you-pill` e contagem na aba `code`) | **Corrigido (CR pré-aprovado 17/11)**: clica `panes[0]` antes de sinalizar `panes.at(-1)`; asserções inalteradas |
| 2 | `e2e/acceptance/oxe152-f6/brd10-queue.spec.ts` | `panes[0]` (linha 27) | `panes.at(-1)` | Sim (`needs-you-pill` e fila) | **OK (já foca outro painel)** — inalterado |
| 3 | `e2e/agent-state-hook.spec.ts` | Outro painel (linhas 40-41) | Painel alvo | Sim (transição `seen: false` → `true`) | **OK (já foca outro painel)** — inalterado |
| 4 | `e2e/brand/brand-conformance.spec.ts` | `panes[0]` (após OXE-297) | `panes.at(-1)` | Sim (cena `code-workspace` / `needs-you-queue`) | **Corrigido**: clica `panes[0]` (quando `panes.length > 1`) antes de sinalizar `panes.at(-1)` |
| 5 | `e2e/needs-decision.spec.ts` | Outro painel (linha 44) | `blocked` | Sim (contagem e badge de decisão) | **OK (já foca outro painel)** — inalterado |
| 6 | `e2e/polish/pm-02-2.spec.ts` | `panes[0]` (após CR OXE-297) | `panes.at(-1)` | Sim (`attention-badge` na aba `code`) | **Corrigido (CR pré-aprovado 17/11)**: clica `panes[0]` antes de sinalizar `panes.at(-1)`; asserções inalteradas |
| 7 | `e2e/polish/pm-02-3.spec.ts` | `others.at(-1)` (linha 28) | `signalled` (`panes[0]`) | Sim (`activity-count` no sino) | **OK (referência `CR-F6-32` / `#910`)** — inalterado |
