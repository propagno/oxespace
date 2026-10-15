# Carga sintética de 2 h — memória (V14, parte automatizada)

Data: 2026-10-15, Windows x64. Harness: `tests/load/memory-load.native.test.ts`. Servidor: ai-memory 2.6.2 oficial (ZIP `740952e3…`, executável `409eeb65…`, conferidos). Dados 100% sintéticos; nenhuma inferência, nenhum provedor, nenhuma memória pessoal.

## Cenário

4 sessões sintéticas (2 `codex`, 2 `claude-code`), 1 evento de ~1 KiB por sessão por segundo, rajadas de 20 eventos por sessão a cada minuto, um evento `stop` com trecho do assistente a cada 20. Fila durável real (outbox), worker de entrega e cliente HTTP reais. O servidor foi **morto (SIGKILL) por 60 s a cada 10 min** (10 quedas) e a outbox/worker foram **reabertos a cada 30 min** como numa reinicialização do app (3 vezes). Duração: 120 min (7203 s).

## Resultado (um único trecho de relatório; contagens e tempos, sem texto de eventos)

| Medida | Resultado | Critério |
|---|---|---|
| Eventos admitidos / observações esperadas / gravadas no servidor | 37 240 / 37 236 / 37 236 | gravadas = esperadas |
| Perdidos | 0 | 0 |
| Duplicados (por chave de ingestão) | 0 | 0 |
| Recusados na admissão | 0 | 0 |
| Pendentes ao final | 0 | 0 |
| Fila máxima | 342 eventos | ≤ 10 000 |
| Outbox máxima | 1,3 MiB | ≤ 64 MiB |
| Admissão (sem rede) p50 / p95 / p99 | 4,0 / 15,5 / 31,4 ms | p95 < 50 ms |
| Drenagem após cada queda (10 quedas) | 6,6 a 7,1 s | ≤ 120 s |
| Memória residual do processo de teste | 71 → 80 MiB (+9 MiB) | crescimento < 100 MiB |
| Handles ativos | 6 a 7, estável | estável |
| Diretório de memória ao final | 77 MiB | informativo |

Aprovado nos critérios do harness (todas as asserções passaram).

## Limites desta evidência

- É estabilidade e integridade do produtor/entrega, **não** ganho de produtividade nem prova de UX.
- A memória residual medida é a do processo de teste, que contém o produtor; o servidor ai-memory é um processo à parte e não foi medido.
- Os eventos são sintéticos e vão direto à outbox; não passam por Claude/Codex reais nem pela janela do Electron.
- O contador `delivery.stored` do relatório reflete só o worker após a última reabertura; a contagem autoritativa é a do SQLite do servidor (37 236).
- Windows apenas. Linux não foi executado.
- Não substitui o piloto humano de 1 dia do plano (V14); o soak automatizado de 24 h, se feito, também não.

## Reprodução

```powershell
$env:OXESPACE_MEMORY_LOAD = '1'
$env:OXESPACE_LOAD_MINUTES = '120'
$env:OXESPACE_LOAD_OUTAGE_EVERY_S = '600'
$env:OXESPACE_LOAD_OUTAGE_S = '60'
$env:OXESPACE_LOAD_REOPEN_EVERY_S = '1800'
$env:OXESPACE_LOAD_REPORT = 'C:\caminho\novo-relatorio.json'   # não pode existir
$env:OXESPACE_AI_MEMORY_V26_TEST_BINARY = 'C:\caminho\ai-memory.exe'   # 2.6.2 verificado
node scripts/test-electron.mjs tests/load/memory-load.native.test.ts --maxWorkers=1
```

Para o soak de 24 h, `OXESPACE_LOAD_MINUTES=1440`.
