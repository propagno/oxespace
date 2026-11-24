# OxeChat sob carga (OXE-413)

Estado: **medido e corrigido** (23/11). Três correções no processo principal, comparadas com a main no mesmo runner.

## Resposta curta

- **O renderer estava bem e continua bem.** O eco no composer fica em cerca de 30 ms no p95, o quadro em 17 ms no p95, e não há tarefas longas que importem.
- **O processo principal fazia trabalho que crescia com a conversa e com o número de conversas**, a cada lote de 80 ms do streaming. Eram três causas, todas corrigidas:
  1. **Abas de ferramentas e resumo do agente.** A cada mudança, agrupada em 250 ms, eles chamavam `places()`, que lê HEAD, branch e troca de branch de cada lugar com `git`. Eram 416 processos `git` em dois turnos, só para contar os arquivos alterados. Agora a contagem vem do banco (`placeFileCount`), sem `git`. O próprio código define `places()` como ponto de leitura, nunca como observador (A15).
  2. **Visão "Precisa de você"** (`AgentsReadModel`). A cada mudança, ela relia e fazia `JSON.parse` dos últimos 200 eventos e de todos os turnos de **todas** as conversas. Agora a leitura é incremental, pela `epoch` e pela `revision`: lê só as linhas com `rev` maior, e uma `epoch` nova relê tudo, como o `readSince` da janela.
  3. **Observador de aprovações** (`electron/main/index.ts`). A cada mudança, ele montava a janela de 250 eventos, os turnos e as entregas só para ler os pedidos pendentes. Agora ele usa `pendingRequestsOf`, que lê a linha da conversa e, só se ela espera aprovação, os pedidos.
- **Resultado com 5 conversas transmitindo ao mesmo tempo:**
  - laço do principal, p95: 116 ms → **16 ms**;
  - CPU do principal: 77% → **43%**;
  - atraso do streaming, p95: 588 ms → **374 ms**.

  Numa conversa só, a CPU do principal nos turnos 16–20 caiu de 49% para **18%**.

## Como foi medido

- **O app real:** processo principal, SQLite, serviço de conversas e o caminho de deltas do renderer (`OXESPACE_E2E_MOCK_NATIVE=0`, sem fixture).
- **O agente:** um `claude` substituto no PATH, que fala o protocolo stream-json do CLI. Nenhuma conta paga.
- **Carga de cada turno:** 240 `text_delta` de cerca de 60 caracteres a cada 25 ms, cerca de 14 KB de Markdown, e depois 3 ferramentas com 16 KB de saída cada.
- **Teste:** `e2e/perf/oxechat-load.spec.ts`. Ele ainda não está na main e entra quando a main ignorar `e2e/perf/` no smoke (PR #1144).
- **Rodadas:** 3 rodadas de 20 turnos, numa conversa aberta. Depois, 5 conversas transmitindo juntas, reabrir a conversa longa, rolar até o começo dela e reiniciar o app.
- **Ambiente:** só no Linux (`ubuntu-22.04`, xvfb), na CI. No Windows, o app só lança um `.exe` como agente.
- **Comparação:** base e correção no mesmo job. O patch da correção é revertido e reaplicado, e cada build é conferido.
- **Causa:** achada com um perfil de CPU do processo principal, gravado pelo inspector do próprio app e traduzido pelos source maps, e com a contagem dos processos que o principal inicia.

## Resultados (mediana de 3 rodadas; p95 sobre todas as amostras)

| Fase | Main: CPU do principal / laço p95 | Correção: CPU do principal / laço p95 | Main: atraso do streaming p95 | Correção: atraso do streaming p95 |
| --- | --- | --- | --- | --- |
| turnos 1–5 | 27% / 7,3 ms | **13% / 1,5 ms** | 340 ms | **184 ms** |
| turnos 6–10 | 33% / 8,4 ms | **15% / 1,9 ms** | 344 ms | **183 ms** |
| turnos 11–15 | 42% / 9,9 ms | **17% / 3,0 ms** | 345 ms | **180 ms** |
| turnos 16–20 | 49% / 12,8 ms | **18% / 5,6 ms** | 323 ms | **182 ms** |
| 5 conversas juntas | 77% / 115,9 ms | **43% / 15,6 ms** | 588 ms | **374 ms** |

Processos que o principal iniciou em dois turnos: 416 com a main, **32** com a correção. Os que sobram são do turno: `git status` e `git diff` do fim do turno e o `claude auth status` do envio.

| Outras medidas | Main | Correção |
| --- | --- | --- |
| Eco no composer, p95 (1 conversa / 5 juntas) | 26–31 / 50 ms | 23–32 / 35 ms |
| Reabrir a conversa longa | 358 ms | 365 ms |
| Abrir depois de reiniciar o app | 1.373 ms | 1.333 ms |
| Memória do renderer no pico, turnos 1–5 → 16–20 | 389 → 551 MB | 397 → 552 MB |

## O que fica aberto

- **CA-1, em parte.** A CPU do principal ainda cresce com a conversa: 13% → 18% em 20 turnos, e o laço p95 vai de 1,5 a 5,6 ms. Antes eram 27% → 49% e 7,3 → 12,8 ms. O crescimento caiu de 22 pontos para 5 pontos, mas fica acima do alvo de 15% do card.
- **CA-5, memória do renderer.** Ela cresce cerca de 8 MB por turno nos dois braços, igual na main e na correção. Então não vem do processo principal. Falta investigar se é a lista virtual, o Markdown ou o cache de conversas.
- **A rolagem até a primeira mensagem** (cerca de 3,8 s nos dois braços) mede a velocidade da roda do teste, não o app.

## Referências

- `electron/main/services/conversation/thread-place-observer.ts` (`placeFileCount`), `electron/main/ipc/thread.ipc.ts` (`toolTabs`, `agentSummary`), `electron/main/services/agents/agents-read-model.ts` (`journal`), `electron/main/services/conversation/thread-history.ts` (`pendingRequestsOf`), `electron/main/index.ts` (observador de aprovações).
- Testes: `tests/agents-read-model-journal.test.ts`, mais os existentes `tests/integration/agents-read-model.test.ts`, `tests/integration/thread-agent-summary.native.test.ts` e `tests/acceptance/f6/f6-contract.test.ts`.
