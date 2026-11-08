---
oxe_doc: roadmap
status: approved
updated: 2026-11-04
spec_ref: .oxe/SPEC.md
---

# Roteiro de Entrega — OXESpace 1.5.0

As fases rodam em ordem; uma fase só começa quando a anterior fecha (`runtime program close`). Dentro de cada fase, as ondas do PLAN.json rodam em paralelo onde os escopos são disjuntos.

Cada fase termina com estes gates do repositório:

- typecheck e lint;
- a suíte de governança: design-lint, fs-allowlist, i18n-catalog, mcp-coverage e remote-ipc-contract;
- `verify:bundle`;
- CI verde na head da fase.

## Fase 1 — Base: linha 1.4.x herdada, tokens C4, identidade e primitivos

**Requisitos:** R12, R1, R3, R2
**Critérios de aceite:** A35, A36, A1, A2, A8, A9, A4, A5, A6
**Escopo:**

- Fechar na main o que já está em voo: o pareamento (#594/#601 com #595), T87 (#597), T88/T89 (#602), FL-16 (#600), S7.1 (#441), C5 (#526) e a aba Agents (#521). Entram como tarefas com `blocked_by` externo.
- Entregar o PR de tokens C4 com o verde caatinga e a paleta de workspaces, os ícones próprios em módulos e a coluna `workspaces.color`.
- Migrar os diálogos para U1 (U5a/b/c) e criar Callout (U6) e Menu (U7).
- Refazer as baselines visuais uma vez.

## Fase 2 — Preparação e remoções (cockpit)

**Requisitos:** R15
**Critérios de aceite:** A48, A57
**Escopo:** R0a-R0d (módulos neutros, exportação única, mover preview-automation, delegação sem memória/CodeGraph), depois R1-R15 em paralelo onde o escopo for disjunto; spikes B3 Tango, broker CDP, fork de sessão e onde o T74 grava

## Fase 3 — Atividade dos agentes, chamadas HTTP e Settings

**Requisitos:** R4, R2, R17
**Critérios de aceite:** A10, A11, A12, A7, A58, A59
**Escopo:**

- O read model U12-be com `source` e a página única de atividade (U12).
- O OxePost para agentes, T64: ferramenta, acesso por coleção, aprovação e auditoria, com revisão SECURITY.
- As páginas de Settings em U8, mais U9 e U10.

## Fase 4 — Worktrees, lugares por tarefa e Pull request (GitHub + Azure DevOps)

**Requisitos:** R5, R17
**Critérios de aceite:** A13, A14, A15, A16, A17, A18, A54, A60
**Escopo:** T72 PR1–PR4 conforme o CCR #580:

- modelo de lugares e base por lugar;
- diff por lugar e pastas de fora;
- deriva de branch;
- resolvedor único, com leitura só de lugares de evidência.

Junto entram T79 (cwd por OSC), T73 (branch por painel) e as lacunas do §6: painéis da tarefa, dono do container pelo Compose e revisores do PR. A revisão SECURITY de todo o T72 acontece no PR3.

## Fase 5 — Ver o que o agente faz

**Requisitos:** R16
**Critérios de aceite:** A49, A50, A51, A52
**Escopo:** Broker de depurador, depois B1 (navegador do agente com aprovação por sessão em localhost) e B2 (emulação real de aparelho); B3 (espelho Android via Tango + scrcpy) independente

## Fase 6 — Conversa (B leve)

**Requisitos:** R6, R17
**Critérios de aceite:** A19, A20, A21, A22, A23, A53
**Escopo:**

- T58 a–k e o campo `activity` (T90).
- Cabeçalho como tarefa: linha "agora", abas do que foi usado e painel de impacto.
- Dobra das ferramentas.
- Composer com T76; shell em segundo plano (T77).
- Side chat, detalhes e "View" (U14), U13 e U11.
- Conversas lado a lado no modelo do ThreadGrid.

## Fase 7 — Aprovações com impacto

**Requisitos:** R7, R17
**Critérios de aceite:** A24, A25, A26, A27, A28, A55, A56
**Escopo:**

- A aprovação vem até você, como cartão ou toast, e a fila continua como caminho extra.
- Prévia de impacto, com segurar ou confirmar para o irreversível.
- T74 Sempre permitir, T75 snapshot (primeiro Mongo, depois Postgres) e T78.
- Revisão SECURITY em T74 e T75.

## Fase 8 — Agora, viagem no tempo e barra de comando

**Requisitos:** R8, R9, R10
**Critérios de aceite:** A29, A30, A31
**Escopo:**

- T82 Agora sobre o S7.1 e o T90.
- T83 viagem no tempo sobre os checkpoints e o T72: restaurar e ramificar para uma worktree nova, com cartão no OxeCode.
- T84 barra de comando com o combobox completo.
- Tudo lazy, com a entrada ≤ 284 kB.

## Fase 9 — Painéis e fidelidade à 1.4

**Requisitos:** R11
**Critérios de aceite:** A32, A33, A34
**Escopo:**

- OxeCode: laterais e NewWorkspaceModal idênticos à 1.4.1, cartões com painéis, divisão completa, presets 1–16, dock e A2.
- OxeQuery (A5), OxePod (A3), OxePost (A4) e o primeiro uso (A1) com conexão de agente real.
- A6 e A7.

## Fase 10 — Celular (OxeMobile)

**Requisitos:** R14
**Critérios de aceite:** A42, A43, A44, A45, A46, A47
**Escopo:**

- As telas do celular no design aprovado (#627), mantendo as regras de segurança da 1.4.
- A aba Agentes (M7), mandar instrução durante o trabalho, e os pedidos cortados.
- O terminal com largura fixa em `cols`, e a capacidade que corta as páginas de histórico.
- A conversa do CLI no celular (#658).
- Entradas: `team/checklists/phone-parity-1.4.md`, `team/checklists/phone-phase-inputs.md`, #623, #658.

## Fase 11 — Endurecimento e release

**Requisitos:** R13
**Critérios de aceite:** A37, A38, A39, A40, A41, A3
**Escopo:**

- xterm 6 com os addons e o bench; vite 8 só se houver suporte oficial.
- Homologação da HML no app empacotado contra a 1.4.1, com o sign-off do usuário.
- Orçamentos, axe e notas de versão.
- CI da main verde. A tag v1.5.0 só sai com o OK do usuário.

---

## Fora do escopo (v2+)

| Requisito | Motivo do adiamento |
|-----------|---------------------|
| B completa (entidade Tarefa com várias conversas e agentes) | Exige mudar o protocolo e uma migração grande; o playground mantém como "depois" |
| Agrupar por cor de workspace no celular | Precisa de campos C5 de linha de agente (1.5.x) |
| Wrapper de prompt opt-in para shells que só fazem `cd` | 1.5.x (M); a deriva de branch não depende dele |
| Voz nativa no macOS | Roadmap separado (oxe-build / OxeVoice) |

---

## Histórico de aprovação

| Versão | Data | Comentário |
|--------|------|------------|
| v1 | 2026-11-04 | TECH LEAD, a partir do playground aprovado pelo usuário (04/11) e das 5 rodadas de revisão |
