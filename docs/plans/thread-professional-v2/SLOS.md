# SLOs do modo Thread

Estado: baseline em implementação
Host de referência: Windows x64, build desktop, banco SQLite local em WAL

## Metas

| Fluxo | Meta | Como medir |
|---|---:|---|
| Append de evento | p95 ≤ 15 ms | `tests/bench/thread-history.bench.ts`, histórico com 100 mil eventos |
| Crescimento do append | p95 de 100 mil / p95 de 1 mil ≤ 2x | Mesmo benchmark, mesma máquina e ABI |
| Cold open | ≤ 500 ms | Janela paginada dos 250 eventos mais recentes |
| Warm switch | ≤ 150 ms | Snapshot validado em cache, reconciliação posterior |
| Timeline montada | ≤ 80 rows | E2E com 10 mil eventos e conteúdo dinâmico |
| Recuperação | 0 estados voláteis órfãos | Fault corpus em restart e shutdown |
| Replay ambíguo | 0 reenvios automáticos | Operações sem ACK terminam em `unknown` |

## Invariantes de recovery

1. `completed`, `failed`, `cancelled` e `unknown` são terminais e nunca regridem.
2. Um ACK perdido não comprova sucesso nem falha; o journal registra `unknown`.
3. Restart e shutdown encerram turnos, tools, requests, approvals, diffs e subagentes locais.
4. Um item de fila em `sending` vira `unknown`; ele não é reenviado automaticamente.
5. Eventos v1 permanecem legíveis. Novos eventos recebem envelope v2 separado do payload visual.
6. Uma projeção paginada nunca pode substituir o histórico completo.

## Execução

Os testes com SQLite precisam da ABI Electron neste projeto:

```text
npm run test:electron -- tests/integration/thread-faults.test.ts tests/integration/thread-history.test.ts
```

O benchmark deve ser executado pelo Electron em modo Node para usar o mesmo `better-sqlite3` do aplicativo. Os números devem ser registrados em `EVIDENCE.md` junto com CPU, memória, versão do Electron e data.
