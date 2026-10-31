# Avaliação de UX agêntica 1.4

> **Etapa 1 de 2** (reconhecimento, mapa de tarefas e scorecard preliminar). As notas podem mudar na etapa 2, que traz as dimensões com evidência completa, os achados restantes e o roadmap.

- **Base lida:** `origin/main` em `b52704922ee2b7582288f519315ebaf7d4a634c4` (merge do #245), num worktree só de leitura.
- **Papel:** avaliação independente da experiência agêntica (clareza, controle e confiança da pessoa sobre o que o agente faz). Não é a sessão FRONTEND nem a HOMOLOGAÇÃO.
- **Como foi feito nesta etapa:** só pelo código (componentes, stores, hooks, textos em `shared/locales`). Tudo que segue é **Inferido do código**, salvo indicação. O app em execução no perfil de teste fica para a etapa 2.
- **Não repete:** `redesign-audit-1.4.md` (#228, P1-* a P3-*), `maturity-frontend-1.4.md` (#256, FE-M-*), roadmap F12–F28 e B1–B15, PRs abertos #243, #227, #230 e #238. Cada achado diz se já está mapeado ou em PR.

## 1. Resumo executivo (preliminar)

Nota geral preliminar: **3 · Definido** (média das 12 dimensões: 3,3).

**Forças**
1. O OxeChat dá à pessoa controle fino sobre o turno: parar (botão e Escape), redirecionar no meio do turno (*steer*), e uma fila de mensagens que dá para editar, reordenar e mandar já, e que pausa sozinha depois de falha ou interrupção.
2. A revisão e a volta atrás são de nível de referência: manter ou desfazer cada arquivo, desfazer bloco por bloco, comentar um bloco de volta para o agente, voltar a conversa até antes de uma mensagem restaurando os arquivos, com "Refazer".
3. A atividade ao vivo só mostra o que o provedor relatou ("um status é evidência de um evento, nunca um pensamento inferido"): avisa sinal parado, reconexão e ferramenta lenta em relação ao histórico da própria conversa.

**Riscos para confiança e controle**
1. **UX-01 (Alta, nova):** no OxeCode, um agente parado num pedido de aprovação aparece igual a um agente que só terminou o turno. O app sabe a diferença e a descarta.
2. Os pedidos de aprovação fora do OxeChat ainda vão para o diálogo do sistema, onde o texto do agente se confunde com o do app (Já mapeado: P1-1 a P1-5, F18/B10; Em PR #243 e #238).
3. A central de atividade e as notificações estão só em inglês e somem quando o app reinicia, então "o que aconteceu enquanto eu estava fora" depende da memória da pessoa (UX-02, UX-03).

## 2. Reconhecimento (Fase 1)

| Peça | Onde | O que importa para a experiência agêntica |
|---|---|---|
| Estado do agente no terminal | `electron/main/services/agent-state/agent-state.service.ts`, `shared/types/agent-state.ts` | Ciclo `working`, `blocked`, `done`, `idle`, `unknown`, lido dos hooks do agente e da tela (`visible_blocker`). |
| Estado no renderer | `src/store/terminal.store.ts` (`agentState`), `src/utils/paneDisplay.ts` (`deriveStatusTone`) | Converte o ciclo em 6 tons de exibição: `thinking`, `awaiting`, `starting`, `exited`, `error`, `idle`. |
| Conversa (OxeChat) | `src/store/thread.store.ts`, `src/components/Threads/*` (≈ 90 arquivos) | Linha do tempo, plano fixado acima do composer, atividade ao vivo, cartões de pedido, fila, rewind, revisão por bloco. |
| Aprovações no OxeChat | `ThreadRequestCard.tsx`, `ThreadApprovalDetails.tsx`, `kernel/permission-policy.ts` | Política com risco e motivos, "permitir na sessão", "sempre permitir" que grava regra no projeto, histórico de decisões. |
| Regras e auditoria | `ThreadPermissionsPanel.tsx` (aberto pelo `ThreadCommandDialog`) | Regras por conversa ou projeto (comando, caminho, ferramenta) e o registro das decisões. |
| Atenção | `src/store/activity.store.ts`, `activity.feed.ts`, `useAgentNotifications.ts`, `useThreadAttention.ts`, `ActivityCenter.tsx` | Sino com grupos "Needs you", "Finished", "Updates"; contador no seletor de modos; notificação do sistema. Só em memória. |
| Delegação | `Delegation/DelegatedWorkDialog.tsx`, `ThreadSubagentActivity.tsx`, `Workspace/WorkspaceDelegationSettings.tsx` | Tarefas delegadas com estado e retomada; subagentes do provedor listados na conversa. |
| Contexto e custo | `ThreadUsageRing.tsx`, `contextUsage.store.ts`, `threadCost.ts`, `useFileMentions.tsx` | Anel de contexto (% e tokens), uso do plano, menções de arquivo. |
| Textos | `shared/locales/{en,pt-BR}/{code,thread,…}.json` | Boa parte da área agêntica traduzida; a central de atividade e as notificações não. |

## 3. Experiência por tarefa (Fase 2)

| # | Tarefa | Passos (hoje) | Atritos principais | Heurísticas violadas | Nota |
|---|---|---|---|---|---|
| 1 | Abrir workspace e pôr 2+ agentes em paralelo (OxeCode) | Novo workspace → escolher pasta e layout → cada pane abre um perfil (Claude, Codex…) → digitar o pedido em cada TUI → acompanhar pelos pontos de status no cabeçalho e na sidebar | O estado de cada pane é só uma cor (`aria-hidden`) e um rótulo genérico "Awaiting". Bloqueado e concluído têm o mesmo tom (UX-01). Pasta inexistente cria workspace em silêncio (Já mapeado: P2-6, F20/B11). | H1 Visibilidade do status; H6 Reconhecer em vez de lembrar | 2 |
| 2 | Pedir uma alteração no OxeChat e acompanhar | Escrever no composer (menções, anexos, comandos `/`) → Enter → plano fixado no topo do composer, atividade ao vivo ("Rodando o comando…", tempo, ferramenta lenta) → resposta e mudanças | Plano e atividade claros. O painel de contexto completo ainda não está na main (Em PR #227, F14). | — (positivo) | 4 |
| 3 | Revisar e aprovar ou rejeitar | OxeChat: cartão com comando, diretório, motivo, risco, regras → Aprovar / Permitir na sessão / Sempre permitir / Negar. OxeQuery, MCP `confirm` e preview: diálogo do sistema. OxeCode: o pedido aparece dentro da TUI | Diálogo do sistema corta texto e mistura agente e app (Já mapeado: P1-1 a P1-5; Em PR #243, #238). Comando escondido por padrão no cartão (Já mapeado: P1-8). No OxeCode o pedido não é sinalizado como pedido (UX-01). Motivos da política em inglês fixo (Já mapeado: B10, códigos C3). | H1; H5 Prevenção de erros; H2 Correspondência com o mundo real | 2 |
| 4 | Interromper, redirecionar e retomar | Parar (botão ou Escape no composer) → a fila pausa e oferece "Retomar", "Mandar a próxima", "Limpar" → *steer* manda instrução no meio do turno → rewind até uma mensagem, com ou sem restaurar arquivos | Escape interrompe sem confirmação nem desfazer: quem aperta Escape para fechar algo pode parar o turno (a ver no app; os popups consomem o Escape antes). | H3 Controle e liberdade (positivo); H5 (ponto de atenção) | 4 |
| 5 | Dar e controlar contexto | Menção `@arquivo`, anexos de imagem, servidores MCP pelo "+", anel de contexto com % e tokens; regras de permissão por projeto | O anel mostra o total, não o que ocupa o contexto (Em PR #227, F14). Quarentena de MCP só aparece na lista (Já mapeado: P1-14, F25). | H1; H10 Ajuda | 3 |
| 6 | Delegar e acompanhar quem espera decisão | Delegar pela ferramenta MCP ou pelo diálogo → "Trabalho delegado" lista tarefas e estados → subagentes do provedor aparecem na conversa com estado | Subagentes listados pelo id técnico, não por nome ou papel (UX-04). Visão de "quem espera decisão" entre conversas e a coordenadora não estão na main (Já mapeado: F15; em revisão #209, #219, #220). | H6; H8 Estética e design minimalista | 2 |
| 7 | Consultar ou alterar banco via agente (OxeQuery) | Agente chama `oxespace_db_query` (leitura) ou `db_execute` (escrita) → diálogo do sistema pede confirmação; em produção a pessoa digita o nome | Já mapeado em quase tudo: P1-1 a P1-5, P1-13, P1-18 (#228), FE-M-09 e FE-M-12 (#256), B14, B15, F18. Nada novo nesta etapa. | H1; H5 | 2 |
| 8 | Voltar depois de horas | Abrir o app → conversas restauradas com estado → sino mostra só o que aconteceu nesta sessão do app → panes de terminal "Resume session" | A central de atividade é só em memória: depois de reiniciar, nada diz o que terminou, falhou ou pediu decisão enquanto o app esteve fechado (UX-03). Pedidos pendentes de conversas são semeados de novo na abertura; os de terminal, não. | H1; H6 | 3 |

## 4. Scorecard preliminar das 12 dimensões

| # | Dimensão | Nota | Justificativa | Evidência |
|---|---|---|---|---|
| 1 | Visibilidade do plano | 3 | Plano do turno fixado acima do composer com o passo atual e o progresso, e o cartão completo na linha do tempo. No OxeCode o plano fica dentro da TUI, fora do alcance do app. | `ThreadDockPlan.tsx:12-41`, `ThreadPlan.tsx:6-11` |
| 2 | Transparência em execução | 4 | Rótulo da ferramenta em linguagem natural, tempo da ferramenta, sinal parado, reconexão e ferramenta lenta comparada à mediana da conversa. | `ThreadLiveActivity.tsx:16-60` |
| 3 | Controle e interrupção | 4 | Parar, Escape, *steer*, fila editável e reordenável que pausa depois de falha, parar subagente. | `ThreadComposerForm.tsx:69,77,82`, `ThreadPromptQueue.tsx:7-35`, `ThreadSubagentActivity.tsx:14` |
| 4 | Aprovação human-in-the-loop | 2 | No OxeChat é rico (risco, motivos, por turno ou sessão, regra lembrada, auditoria). Mas o OxeCode não sinaliza o pedido (UX-01) e as outras origens vão ao diálogo do sistema (P1-*). Sobe com #243/#238 e UX-01. | `ThreadRequestCard.tsx:62-145`, `ThreadPermissionsPanel.tsx`, `paneDisplay.ts:149,263` |
| 5 | Revisão de mudanças | 4 | Manter ou desfazer por arquivo, desfazer por bloco recusado se o arquivo mudou depois, comentar um bloco de volta para o agente. | `ThreadDockChanges.tsx:64-104`, `ThreadHunkReview.tsx:10-24` |
| 6 | Reversibilidade | 4 | Rewind até uma mensagem, restaurando arquivos, com "Refazer" até a próxima mensagem; desfazer por bloco. No OxeCode, só pelo Git. | `ThreadRewindControl.tsx:6-35`, `ThreadTurnReview.tsx:74` |
| 7 | Contexto | 3 | % e tokens de contexto e uso do plano; menções e MCP pelo composer. Falta ver a composição do contexto (F14). | `ThreadUsageRing.tsx:48-65`, Em PR #227 |
| 8 | Streaming e latência | 3 | Estados "pensando" e "executando" separados, sinal parado. 6 TUIs ao mesmo tempo: Não verificável aqui (F16, `bench:ui`). | `ThreadLiveActivity.tsx`, roadmap F16 |
| 9 | Erros e incerteza do agente | 3 | Cartão de falha próprio; fila pausa com o motivo; pedido resolvido diz se o turno falhou depois. Detalhe na etapa 2. | `ThreadFailureCard.tsx`, `ThreadPromptQueue.tsx:25`, `ThreadRequestCard.tsx:84` |
| 10 | Calibração de confiança | 2 | O app separa evidência de suposição na atividade ao vivo, mas nos diálogos do sistema e nos links o texto do agente ainda se passa pelo do app. | Já mapeado: P1-2, P1-3, FE-M-02; Em PR #243, #238, #259 |
| 11 | Eficiência para usuário avançado | 3 | Paleta, atalhos e comandos `/` no composer; rótulos da paleta inconsistentes e armadilha de teclado no terminal. | Já mapeado: P2-1 a P2-3 (F17, #242), F23 (#258) |
| 12 | Continuidade | 3 | Conversas restauradas, ofertas de *handoff* de memória, tarefas delegadas retomáveis; a central de atividade não sobrevive ao reinício (UX-03). | `WorkspaceMemorySettings.tsx:104`, `WorkspaceDelegationSettings.tsx:91`, `activity.store.ts:1-40` |

## 5. Achados (até aqui)

| ID | Severidade | Dimensão/Tarefa | Tela/componente | Problema | Evidência | Impacto na confiança e no controle | Recomendação | Esforço | Já mapeado/Em PR |
|---|---|---|---|---|---|---|---|---|---|
| UX-01 | **Alta** | 4 Aprovação · Tarefas 1, 3 | OxeCode: cabeçalho do pane, linha da sidebar, central de atividade, contador do seletor de modos, notificação do sistema | Um agente TUI parado num pedido de aprovação ou numa pergunta aparece igual a um agente que terminou o turno. O main publica `blocked`; o renderer o converte no mesmo tom `awaiting` de `done`, com o mesmo ponto e o mesmo texto "Awaiting". O texto certo ("Needs your approval or answer") é calculado em `attentionReason` e nenhum componente o mostra. A central registra o pedido como "the agent finished and is waiting for your reply" só depois de 10 s, e a notificação do sistema sai só com a janela sem foco, uma por pane a cada 5 min. O contador "precisa de você" do seletor de modos soma panes concluídos e bloqueados. No OxeChat, ao contrário, `approval` tem estado, texto e notificação próprios. | `agent-state.service.ts:115,208`; `paneDisplay.ts:149-158,263-264`; `PaneContainer.tsx:172`; `PaneSessionRow.tsx:167,219,237`; `useAgentNotifications.ts:31-33,90-103`; `activity.feed.ts:20`; comparar `threadAttention.ts:34,49` | Com 4 a 6 agentes, a pessoa não sabe qual está parado esperando decisão e qual só terminou. O pedido mais urgente perde prioridade e o agente fica parado sem ninguém saber. A mesma situação tem formas diferentes no OxeCode e no OxeChat. | Tom próprio para `blocked` (ex.: `needs-decision`), com ponto, texto e anúncio de leitor de tela distintos de `done`; mostrar `attentionReason` no cabeçalho e na linha; registrar na central na hora, com texto próprio em en e pt-BR, sem o *cooldown* do concluído; o contador do modo conta só o que espera decisão. **Critério de aceite:** e2e no mock com um pane `blocked` e outro `done` → rótulos, entradas da central e contador diferentes; unidade de `deriveStatusTone`. | M | Novo. Enviado ao coordenador em 31/10. F15 cobre só conversas; #238 mexe em `useAgentNotifications` sem tratar disso. |
| UX-02 | Média | Transversal: linguagem · Tarefas 6, 8 | Central de atividade, notificações do sistema (OxeCode e OxeChat), Trabalho delegado | A central é toda em inglês fixo ("Needs you", "Finished", "Mark all as read", "Activity, n unread"), e também os textos das notificações do sistema e das entradas ("waiting for you", "needs approval", "The agent completed the turn"). O nome padrão do pane é "Agente", em português, também na interface em inglês. | `ActivityCenter.tsx:11-23,50-58`; `useAgentNotifications.ts:76,92,101`; `threadAttention.ts:47-51`; `DelegatedWorkDialog.tsx:79` ("Knowledge included") | Em pt-BR, justo o que pede atenção chega numa língua diferente do resto do app. | Levar os textos para `shared/locales` (`common`/`code`/`thread`) e cobrir no teste de catálogo. | P | Já mapeado no escopo geral do F6 (i18n completo); estes componentes não aparecem no P2-3 nem no P3-4. #238 não muda os textos. |
| UX-03 | Média | 12 Continuidade · Tarefa 8 | Central de atividade | A central só vive em memória. Depois de reiniciar, nada mostra o que terminou, falhou ou pediu decisão enquanto o app esteve fechado ou antes do reinício; os pedidos pendentes de conversas voltam, os avisos de terminal e de conclusão não. | `activity.store.ts:1-40` (sem persistência); `useThreadAttention.ts` (`seedPending` só para pedidos); `useAgentNotifications.ts:64-67` (primeira leitura nunca registra) | Quem volta depois de horas precisa abrir cada conversa e cada pane para saber o que mudou. | Guardar as últimas N entradas por workspace e mostrar "Desde a última vez" na abertura. | M | Novo. |
| UX-04 | Baixa | 6 Delegação · Tarefa 6 | OxeChat: atividade de subagente | Os subagentes aparecem pelo id técnico (`threadId`) em `<code>`, não por nome, papel ou tarefa. | `ThreadSubagentActivity.tsx:16-17` | Com dois ou mais filhos, a pessoa não sabe qual está fazendo o quê nem qual parar. | Mostrar nome ou papel e a primeira linha da instrução; o id fica no `title`. | P | Novo; pode entrar com F15 (árvore de conversas filhas). |
| UX-05 | Baixa | 4 Aprovação · Tarefa 3 | OxeChat: cartão de aprovação | No rodapé, Aprovar, Permitir na sessão e Sempre permitir vêm antes de Negar, então o Tab chega primeiro na aprovação. | `ThreadRequestCard.tsx:138-142` | Pressa ou fadiga favorecem aprovar. | Negar primeiro na ordem do teclado, como no modal do F18. | P | Em PR #243 (o PR mexe em `ThreadRequestCard.tsx`; conferir na etapa 2). |

## 6. Lacunas desta etapa

- Tudo **Inferido do código**. Na etapa 2, com ≥ 1 GB livre e a trava pesada livre, rodar o perfil de teste do e2e (`OXESPACE_E2E_MOCK_NATIVE=1`) com os roteiros de `e2e/homologation/*.spec.ts` para confirmar UX-01 (pane em `blocked` no mock) e o Escape do composer.
- **Não verificável aqui:** desempenho com 6 TUIs (F16, `bench:ui` na CI); leitor de tela nos pontos de status (roteiro de `screen-reader-1.4.md`).
- Ficam para a etapa 2: dimensões 9 e 12 em detalhe, Fase 4 (consistência entre modos, hierarquia de atenção, estados vazios), padrões a preservar e o roadmap de interação e de implementação.
