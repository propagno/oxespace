# main:loop no perf-load: o atraso líquido, medido como o diário (OXE-386)

**A série do `main:loop` do perf-load quebra em 22/11/2026.** Até ali o perf-load reportava os percentis crus do `monitorEventLoopDelay({ resolution: 20 })`. A partir daqui ele reporta o atraso líquido, do mesmo jeito que o diário de desempenho (`loopStat`, `electron/main/services/perf/perf-journal.ts`), com uma fórmula só (`shared/perfLoop.ts`).

## Por quê

Cada amostra do histograma inclui o intervalo inteiro do timer do recorder, que é de 20 ms. Por isso um processo parado lê cerca de 21 ms (21,12–21,15 ms no spike T6 do OXE-121). O diário desconta esse tick; o perf-load não descontava. As duas medidas do mesmo `main:loop` divergiam em cerca de 20 ms, e a meta `main:loop p95 ≤ 16 ms` nunca podia ser cumprida do jeito que o perf-load media. A linha de base de 20/11 (21–22 ms) e as rodadas do PERF-A0 de 22/11 (21,1–21,8 ms) estavam no piso do histograma, não no atraso real.

## O que mudou

- `shared/perfLoop.ts`: `LOOP_RESOLUTION_MS = 20`, `loopDelayMs(ns)` (`max(0, ns / 1e6 − 20)`) e `loopReadingMs(raw)`.
- O `loopStat` do diário usa `loopDelayMs`; o resultado do diário não muda (os testes de `tests/unit/perf-journal.test.ts` seguem verdes).
- O perf-load lê os nanossegundos crus dentro do app e aplica `loopReadingMs` no lado do teste. Ele imprime uma linha `[LOAD] main:loop — net of the recorder's 20 ms tick …` antes das rodadas; os nomes das métricas (`main:loop p95`, `main:loop max`) ficam os mesmos, para os scripts que leem as linhas `[LOAD]`.
- A meta (p95 ≤ 16 ms) e a resolução do recorder (20 ms) não mudam.

## Nova linha de base (22/11/2026)

Run [45003597481](https://github.com/propagno/oxespace/actions/runs/45003597481), branch `ci/perf-load-oxe-386`, commit bf12aa0ae (main 979be7bbf mais a correção), 3 rodadas de 8 painéis a ~1 MB/s. Mediana e p95 das rodadas.

| Métrica | Linux x64 | Windows x64 |
|---|---:|---:|
| main:loop p95 (líquido) | 1,6 ms (p95 1,6) | 1,6 ms (p95 1,7) |
| main:loop max (líquido) | 9,0 ms (p95 10,6) | 12,1 ms (p95 13,6) |
| key echo (idle pane) | 66,7 ms (p95 107,6) | 70,2 ms (p95 580,8) |
| Ctrl K → first item | 146,0 ms (p95 464,7) | 153,8 ms (p95 718,6) |
| workspace switch → grid | 49,8 ms (p95 73,4) | 233,9 ms (p95 361,1) |
| working set at peak | 1088,4 MB | 1088,4 MB (p95 1394,9) |
| working set 10 s after | 708,3 MB | 811,1 MB |

Com a medida líquida, o `main:loop p95` fica bem abaixo da meta de 16 ms nos dois sistemas. As outras métricas não mudaram de definição; uma rodada só do perf-load varia bastante entre execuções (até ±50% no eco de tecla, PERF-A0 do #1050), então compare as outras linhas com cuidado.

## Para a tabela do OXE-105

Use só a série líquida (a partir desta linha de base) para o `main:loop`. Os valores crus anteriores a 22/11 não são comparáveis: some 20 ms para comparar com eles, ou descarte-os.
