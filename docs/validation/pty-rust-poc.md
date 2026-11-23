# Prova de conceito: onde e com o quê hospedar o PTY (OXE-400)

Estado: **desenho aprovado** (23/11), sem números. Versão-alvo 1.7.0. Nada daqui vai para a main sem uma decisão nova do usuário.

## Pergunta

Tirar o PTY do processo principal, e escrevê-lo em Rust, melhora o terminal nos dois sistemas (Windows com ConPTY e Linux)? Os eixos são cinco: isolamento de falhas, latência de tecla, vazão de saída, CPU e memória. Também entra o custo de entrega: build, assinatura e tamanho do pacote.

Por que perguntar:
- **OXE-392:** o app aborta ao sair dentro do node-pty, por um `Napi::Error` em `SetupExitCallback`/`ThreadSafeFunction::CallJS` que ninguém trata. No Linux, isso aconteceu em 1 de 15 saídas, sem pilha.
- **OXE-349:** sob carga, o eco de tecla chegou a p95 de 1,1 s e a memória a 1,26 GB. A causa não está provada.
- **OXE-122:** já pede que a saída do PTY vá em bytes do host direto para a janela.

## Braços

| Braço | Onde roda o PTY | Com o quê | Para que serve |
| --- | --- | --- | --- |
| A | processo principal | node-pty 1.1.0, como hoje | linha de base, no mesmo runner e na mesma rodada |
| B | `utilityProcess` do Electron | node-pty 1.1.0 | controle: mede o ganho de tirar o PTY do processo principal, sem Rust |
| C | `utilityProcess` do Electron | Rust (`portable-pty`) como módulo N-API via napi-rs | forma (a) do card |
| D | binário próprio | Rust (`portable-pty`), por pipe ou MessagePort | forma (b) do card |

O braço B entrou no grill de 22/11 (Q-17, decisão do usuário). Sem ele, um bom resultado em C ou D não diria se o ganho veio do Rust ou só do processo separado. C e B usam o mesmo transporte, então a diferença entre os dois é o próprio Rust.

Fora desta prova (decisão 4): um parser de VT em Rust (`vte` ou `alacritty_terminal`) no lugar do `@xterm/headless` do processo principal.

## Contrato comum

Todos os braços entram pela mesma costura que já existe. O resto do app não muda.

- O `TerminalService` recebe a fábrica de PTY por injeção, `options.pty ?? { spawn }` (`electron/main/services/terminal.service.ts:112`, tipo `PtyModule` em `electron/main/services/terminal/session-start.ts:18`).
- A sessão usa da `IPty`: `spawn`, `pid`, `process`, `onData`, `onExit` (`exitCode`), `write`, `resize` e `kill`.
- No Windows, o spawn passa `useConptyDll: true`, a ConPTY que o node-pty empacota (`session-start.ts:269`). Os braços B a D precisam declarar qual ConPTY usam, porque isso muda a latência e o kill.
- Os braços B, C e D são escolhidos por uma flag, desligada por padrão. Com a flag desligada, o comportamento é o de hoje.
- Uma falha do host (B, C ou D) chega ao painel como saída do terminal, com código, e nunca como exceção no processo principal.

## Como medir

- Só na CI, nunca na máquina do desenvolvedor.
  - O `perf-load.yml` já roda `e2e/perf-load.spec.ts` em `windows-2022` e `ubuntu-22.04`, a cada push em `ci/perf-load-*`. A prova usa um ramo `ci/perf-load-oxe-400`.
  - O `remote-verify.mjs` só roda no Linux (`ubuntu-22.04`) e serve para testes de unidade e o benchmark.
- Cada número sai de pelo menos 5 rodadas, com a mediana e o pior caso.
- A linha de base é o braço A, no mesmo runner e no mesmo job.
- As métricas reaproveitam as que o `perf-load.spec.ts` já emite: `key echo (idle pane)`, `main:loop p95`, `working set at peak` e `working set 10 s after`, cada uma em linhas `[LOAD] <métrica> median=… p95=…`. A prova acrescenta o braço ao nome de cada métrica.

## Critérios e testes

| CA | O que mede | Teste | Braços |
| --- | --- | --- | --- |
| CA-1 Isolamento | O host falha (pânico forçado ou processo morto): o app continua aberto, o painel mostra o terminal encerrado e o processo principal não aborta | `e2e/perf/pty-rust-isolation.spec.ts › a crash in the PTY host leaves the app running` | B, C, D; no A, a mesma injeção fica registrada como linha de base |
| CA-2 Latência de tecla | Eco de tecla p50/p95/p99 sob a carga do perf-load, 5 rodadas por braço | `e2e/perf/pty-rust-latency.spec.ts › key echo under load, node-pty against the Rust host` | A, B, C, D |
| CA-3 Vazão, CPU e memória | 50 MB de saída (texto puro e ANSI): MB/s, CPU do processo principal e memória por terminal, com 1, 4 e 16 terminais | `tests/bench/pty-host.bench.ts › output throughput and memory per terminal` | A, B, C, D |
| CA-4 Saída sem aborto | Com 4 shells vivos, 30 rodadas de cada caminho de saída (menu Sair, fechar a janela, `app.quit()`) | `e2e/perf/pty-rust-quit.spec.ts › quitting with live shells never aborts` | A (linha de base do OXE-392), B, C, D |
| CA-5 Custo de entrega | Tempo de build a mais, tamanho a mais do pacote, assinatura e install-over | este documento › Custo de entrega | C, D (B não muda o pacote) |
| CA-6 Decisão | Recomendação justificada pelos números de CA-1 a CA-5, com os riscos de migração | este documento › Recomendação | todos |

Os nomes dos testes vêm do card. Os testes acrescentam o braço B, sem mudar o nome de nenhum.

## Fatos do código (22/11, main 67dcf3de0)

- O node-pty `^1.1.0` é importado direto no processo principal (`terminal.service.ts:2`).
- Não há Rust no repositório (nenhum `Cargo.toml`) nem uso de `utilityProcess` em `electron/`.
- O pacote usa asar com integridade embutida e `onlyLoadAppFromAsar`. O node-pty fica em `asarUnpack` (`electron-builder.yml:30-49`). A integridade do asar não cobre os arquivos fora dele, então um binário ou `.node` novo ficaria tão sem cobertura quanto o node-pty hoje.
- Nenhum workflow nem script do repositório assina o pacote: não há `CSC_LINK`, `signtool` nem `azureSignOptions`. Hoje o app sai sem assinatura.
- O `install-over.yml` já instala uma versão por cima da outra no Windows e no Linux. O CA-5 reaproveita esse fluxo.
- Os benchmarks rodam em vitest, em `tests/bench/`.

## Custo de entrega

Pendente. Para cada braço com Rust, entram: o toolchain do Rust nos jobs de build dos dois sistemas e o tempo que ele acrescenta, os bytes a mais no instalador e no app instalado, o que precisaria ser assinado se a assinatura passar a existir, e o resultado do install-over.

## Resultados

Pendente. Tabelas por sistema, com o braço A na primeira linha.

| Braço | CA-1 | Eco p50/p95/p99 (ms) | MB/s | CPU principal | Memória por terminal (1/4/16) | CA-4 abortos/90 |
| --- | --- | --- | --- | --- | --- | --- |
| A | — | — | — | — | — | — |
| B | — | — | — | — | — | — |
| C | — | — | — | — | — | — |
| D | — | — | — | — | — | — |

## Recomendação

Pendente, até haver os números. Uma de: trocar; não trocar; trocar só a forma C ou D; ou só tirar o node-pty do processo principal (B). A decisão é do usuário.

## Decisões

O usuário aceitou as recomendações em 23/11.

1. **Transporte do braço D: pipe**, com framing próprio. Assim o binário é medido sem o Node no meio. O MessagePort já é medido nos braços B e C.
2. **ConPTY: a mesma do braço A.** Os braços B a D usam a ConPTY que o node-pty empacota (`useConptyDll`). Se o `portable-pty` não conseguir carregar essa DLL no C ou no D, isso vai para o relatório como risco e o braço é medido com a ConPTY do sistema, identificado assim nas tabelas.
3. **CI só depois do corte da 1.6.0.** O CA-4 dá 90 saídas por braço e por sistema, e o CA-2, 5 rodadas de carga. Nenhuma rodada da prova entra na fila enquanto a 1.6.0 não for cortada.
4. **Parser de VT em Rust: fica para outro card.** Ele não muda nenhum dos cinco eixos do PTY. A seção "Medido à parte" acima não entra nesta prova.

## Fora do escopo

- Trocar o xterm.js ou o desenho do terminal na janela.
- Trocar o instalador. Atualização por diferença, como o Velopack, é outro card.
- O terminal do app Android.

## Referências

- Card OXE-400; OXE-392, OXE-349, OXE-122, OXE-396.
- `electron/main/services/terminal.service.ts`, `electron/main/services/terminal/`, `electron/main/services/pty-input-queue.ts`, `src/components/Terminal/`.
- `e2e/perf-load.spec.ts`, `.github/workflows/perf-load.yml`, `.github/workflows/install-over.yml`, `electron-builder.yml`.
- Bibliotecas candidatas: `portable-pty`, `napi-rs`, `vte`, `alacritty_terminal`.
