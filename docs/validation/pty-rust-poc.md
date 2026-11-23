# Prova de conceito: onde e com o quê hospedar o PTY (OXE-400)

Estado: **medida, forma isolada** (23/11). Versão-alvo 1.7.0. Nada daqui vai para a main sem uma decisão nova do usuário; a decisão de trocar é do usuário.

## Resposta curta

- **Tirar o node-pty do processo principal resolve o isolamento e as saídas não limpas do Windows, sem Rust** (braço B).
  - No Windows, o node-pty no processo principal (A, hoje) teve 7 saídas não limpas em 90 com shells vivos: violações de acesso e travamentos até o limite de 60 s. O OXE-392 aparece aqui.
  - Os braços B, C e D tiveram 90 limpas em 90, nas duas execuções.
- **O Rust não traz isolamento além do B.** No D (binário próprio) ele economiza memória: 1,6 MB por terminal no Windows e 3,8 MB no Linux com 16 terminais, contra 12,2 e 1,3 MB do A. Também gasta menos CPU no principal que o A. Custa um binário novo e o toolchain do Rust na CI.
- **O C (Rust como módulo N-API num processo utilitário) é o pior caminho.**
  - No Linux, ele perde vazão (31 a 43 MB/s com 16 terminais, contra 69 a 89 MB/s do A) com 95% de CPU no principal.
  - O `portable-pty` não funciona dentro de um processo do Electron no Linux (ver Achados).
- **A latência de tecla não vem do PTY.** O eco fica abaixo de 2 ms no p95 em todos os braços, nos dois sistemas, com 8 terminais imprimindo. O p95 de 1,1 s do OXE-349 está em outro lugar.

**Recomendação (CA-6):** trocar só a forma, não a linguagem.
1. Primeiro, mover o node-pty para um `utilityProcess` (B), atrás de uma flag, repetindo o CA-1 e o CA-4 dentro do app.
2. Só depois, se memória ou CPU com muitos terminais virarem problema medido no app, avaliar o binário em Rust (D).
3. Descartar o C.

## Pergunta

Tirar o PTY do processo principal, e escrevê-lo em Rust, melhora o terminal nos dois sistemas (Windows com ConPTY e Linux)? Os eixos são cinco: isolamento de falhas, latência de tecla, vazão de saída, CPU e memória. Também entra o custo de entrega: build, assinatura e tamanho do pacote.

Por que perguntar:
- **OXE-392:** o app aborta ao sair dentro do node-pty, por um `Napi::Error` em `SetupExitCallback`/`ThreadSafeFunction::CallJS` que ninguém trata. No Linux, isso aconteceu em 1 de 15 saídas, sem pilha.
- **OXE-349:** sob carga, o eco de tecla chegou a p95 de 1,1 s e a memória a 1,26 GB. A causa não está provada.
- **OXE-122:** já pede que a saída do PTY vá em bytes do host direto para a janela.

## Braços

| Braço | Onde roda o PTY | Com o quê | Para que serve |
| --- | --- | --- | --- |
| A | processo principal | node-pty 1.1.0, como hoje | linha de base, no mesmo runner e no mesmo job |
| B | `utilityProcess` do Electron | node-pty 1.1.0 | controle: mede o ganho de tirar o PTY do processo principal, sem Rust (grill Q-17) |
| C | `utilityProcess` do Electron | host em Rust como módulo N-API (napi-rs 2) | forma (a) do card |
| D | binário próprio | o mesmo host em Rust, por pipe com framing próprio | forma (b) do card |

O host em Rust (`poc/pty-host/rust`):
- **Windows:** usa o `portable-pty` 0.9 sobre a ConPTY. Em todos os braços, os terminais rodam na ConPTY que o node-pty empacota: o `OpenConsole.exe` aparece como host em A, B, C e D.
- **Linux:** usa `openpty` + `setsid` próprios (ver Achados).

## Como foi medido

- **Forma isolada:** um harness fora do app (`poc/pty-host/harness`), sem tocar no código do terminal. Cada caso roda num processo Electron novo. As rodadas alternam a ordem dos braços (A, B, C, D; depois B, C, D, A; …), no mesmo runner.
- **Só na CI:** `.github/workflows/pty-rust-poc.yml`, em `windows-2022` e `ubuntu-22.04`, a cada push em `ci/pty-rust-poc-*`. Os números abaixo são da execução [45175923542](https://github.com/propagno/oxespace/actions/runs/45175923542) (commit a915f177a). A execução anterior, 45105538079, deu os mesmos resultados no Windows.
- **Rodadas:** 5 por medida, com a mediana e o pior caso. O CA-4 tem 30 rodadas de cada um dos três caminhos de saída.
- **O que cada medida faz:**
  - Vazão: o gerador imprime 50 MB no total, divididos entre os terminais. A vazão é o tempo até o marcador final.
  - CPU: é a do processo principal.
  - Memória: é o pico do principal mais o do host, menos o principal antes de abrir o host, dividido pelo número de terminais.
  - Eco: escreve uma tecla num shell parado enquanto 8 terminais imprimem 1 MB/s cada, e mede até o eco chegar ao processo principal. É o caminho do PTY, sem a janela.
- **Desvios do card:**
  - Os testes que o card nomeia (`e2e/perf/pty-rust-*.spec.ts`, `tests/bench/pty-host.bench.ts`) são da forma dentro do app e não foram escritos. A forma isolada mede as mesmas grandezas com o harness.
  - A decisão 3 (CI só depois do corte da 1.6.0) foi trocada pelo usuário em 23/11: "pode rodar a poc isolada". A prova roda num ramo de CI próprio, fora da fila.

## Resultados

### CA-1 Isolamento (5 rodadas por falha)

As falhas injetadas:
- **Ouvinte lança na saída:** o ouvinte de saída do app lança uma exceção.
- **Ouvinte lança nos dados:** o ouvinte de dados do app lança uma exceção.
- **Pânico no host:** no C e no D, um pânico em Rust. No B, uma exceção dentro do callback nativo do node-pty.
- **Host morto:** o processo do host é morto com SIGKILL.

O processo principal tem um tratador de `uncaughtException`, como o app.

| Braço | Ouvinte lança na saída | Ouvinte lança nos dados | Pânico no host | Host morto |
| --- | --- | --- | --- | --- |
| A, Windows | sobrevive 5/5 | **aborta ao sair depois, 5/5** (0xC0000409) | não se aplica | não se aplica |
| A, Linux | sobrevive 5/5 | **aborta ao sair depois, 1/5** (SIGABRT) | não se aplica | não se aplica |
| B, Windows | 5/5 | 5/5 | 5/5, terminal encerrado | 5/5, terminal encerrado |
| B, Linux | 5/5 | 5/5 | 5/5 vivo, mas o terminal não foi dado como encerrado (0/5) | 5/5, terminal encerrado |
| C, os dois | 5/5 | 5/5 | 5/5, terminal encerrado | 5/5, terminal encerrado |
| D, os dois | 5/5 | 5/5 | 5/5, terminal encerrado | 5/5, terminal encerrado |

- No braço A, uma exceção no ouvinte de dados não derruba o app na hora. Mas o node-pty fica num estado que aborta o processo ao sair.
- A hipótese de que uma exceção no callback de saída do node-pty abortaria o processo não se confirmou: o processo sobreviveu nos dois sistemas.
- B no Linux: a exceção no callback de saída do node-pty, dentro do host, não derruba o host. A mensagem de saída simplesmente não vai. Na migração, o host precisa proteger os próprios callbacks, senão o painel fica com um terminal que nunca acaba.

### CA-4 Saída com 4 shells vivos (30 rodadas de cada caminho)

| Braço | Windows: limpas | Windows: tempo até sair, mediana / pior | Linux: limpas | Linux: tempo até sair, mediana / pior |
| --- | --- | --- | --- | --- |
| A | **83/90**: 4× 0xC0000005, 3 travamentos até o limite de 60 s | 826 / 60050 ms | 90/90 | 517 / 547 ms |
| B | 90/90 | 869 / 1759 ms | 90/90 | 557 / 648 ms |
| C | 90/90 | 763 / 885 ms | 90/90 | 551 / 670 ms |
| D | 90/90 | 755 / 1863 ms | 90/90 | 749 / 783 ms |

Na execução anterior, o A no Windows teve 10 de 90 não limpas (9× 0xC0000005, 1 travamento). Nenhuma saída de nenhum braço precisou do limite de 5 s do app. O SIGABRT do OXE-392 no Linux não apareceu no harness isolado em 90 saídas. Lá ele pode depender de algo que só o app faz, e isso fica para a fase dentro do app.

### CA-2 Eco de tecla (ms; 20 amostras × 5 rodadas, com carga)

| Braço | Windows p50 / p95 / p99 | Linux p50 / p95 / p99 |
| --- | --- | --- |
| A | 0,4 / 1,1 / 1,6 | 0,2 / 0,4 / 1,9 |
| B | 0,7 / 1,1 / 1,7 | 0,3 / 0,5 / 1,0 |
| C | 0,6 / 1,4 / 12,8 | 0,3 / 0,5 / 1,2 |
| D | 0,4 / 0,5 / 5,5 | 0,2 / 0,2 / 0,4 |

Todas as amostras tiveram eco. O laço do processo principal ficou no p95 de cerca de 11 ms (Linux) e 16 ms (Windows), igual em todos os braços. Esse valor é o piso da resolução do monitor, não uma diferença entre braços.

### CA-3 Vazão, CPU do principal e memória por terminal (mediana de 5 rodadas)

Windows: a ConPTY limita a vazão a cerca de 12 MB/s em todos os braços.

| Braço | MB/s (16 terminais, texto) | CPU do principal (1 / 16 terminais) | Memória por terminal, MB (1 / 4 / 16) |
| --- | --- | --- | --- |
| A | 12,7 | 10% / 28% | 27,0 / 16,6 / 12,1 |
| B | 12,4 | 3% / 4% | 79,2 / 28,9 / 15,3 |
| C | 12,9 | 5% / 7% | 112,0 / 25,3 / 7,5 |
| D | 12,8 | 8% / 9% | 17,6 / 4,9 / 1,6 |

Linux:

| Braço | MB/s (16 terminais, texto / ANSI) | CPU do principal (1 / 16 terminais) | Memória por terminal, MB (1 / 4 / 16) |
| --- | --- | --- | --- |
| A | 68,7 / 89,0 | 68% / 35% | 9,9 / 3,5 / 1,3 |
| B | 59,3 / 74,9 | 33% / 26% | 118,2 / 30,6 / 8,1 |
| C | 31,2 / 43,1 | 71% / 94% | 123,3 / 41,4 / 9,3 |
| D | 66,1 / 86,0 | 51% / 28% | 13,5 / 5,3 / 3,8 |

- Nos braços B e C, a memória com 1 terminal inclui o processo utilitário inteiro, cerca de 80 MB no Windows e 110 MB no Linux. Com mais terminais, esse custo se dilui.
- No C, o principal recebe muitas mensagens pequenas de bytes e decodifica o UTF-8. No Linux, sem o limite da ConPTY, isso vira o gargalo.

Tabelas completas: artefatos `pty-rust-poc-windows-x64` e `pty-rust-poc-linux-x64` da execução.

### CA-5 Custo de entrega

| | Windows | Linux |
| --- | --- | --- |
| Build do host em Rust sem cache (os dois artefatos) | 45 s | 12 s |
| Módulo N-API (C) | 402 KB | 498 KB |
| Binário (D) | 330 KB | 471 KB |
| node-pty que o app já empacota (pacote inteiro, `asarUnpack`) | 64 MB | 63 MB |

- O B não muda o pacote.
- O C ou o D somam menos de 1 MB e o toolchain do Rust nos jobs de build. Os runners do GitHub já trazem `cargo`.
- **Assinatura:** o app hoje não é assinado. Um `.node` ou `.exe` novo entra no mesmo `asarUnpack` do node-pty, fora da integridade do asar, igual ao node-pty hoje.
- **Install-over:** não foi medido na forma isolada, porque nada foi empacotado. Fica para a fase dentro do app.

## Achados

1. **O `portable-pty` não funciona dentro de um processo do Electron no Linux.**
   - O spawn dele fecha todos os descritores herdados no filho, entre o `fork` e o `exec`. O Chromium vigia o `close()` desses descritores e derruba o filho antes de ele rodar ("Crashing due to FD ownership violation").
   - O D funciona porque o binário não é um processo do Chromium.
   - Para o C, o host passou a criar o terminal com `openpty` + `setsid` próprios, sem fechar descritores, como o node-pty.
   - Qualquer host em Rust carregado no Electron precisa disso.
2. **No Windows, o node-pty no processo principal não sai limpo com shells vivos:** de 7 a 10 em 90 saídas terminam em violação de acesso ou travamento. Isso bate com o OXE-392 e some ao tirar o node-pty do processo principal.
3. **Uma exceção num ouvinte de dados do node-pty no processo principal fica latente:** o app só aborta ao sair, no Windows sempre. É um motivo a mais para o B e para proteger os ouvintes de terminal do app, que hoje rodam dentro do callback do node-pty.
4. **O binário D traz um `conhost.exe` próprio no Windows**, por ser um programa de console, além do `OpenConsole.exe` dos terminais. Não afeta as medidas.

## Riscos de migração

- **B:**
  - O processo utilitário custa cerca de 80 a 110 MB fixos.
  - Toda a API do `TerminalService` que hoje é síncrona (pid, `process`, cwd) passa a depender de mensagens. O `IPty.process` e o cwd do shell precisam vir do host.
  - O host precisa proteger os próprios callbacks: no Linux, uma exceção na saída deixou o terminal sem fim.
- **D:**
  - Mais um artefato nativo por sistema, para construir na CI e empacotar.
  - O protocolo de framing é próprio.
  - Precisa de código de processo e de leitura para Windows e Unix.
- **C:** o pior desempenho no Linux e o problema do `portable-pty` dentro do Chromium.
- **Validação:** em todos os casos, a forma isolada não prova o app. O CA-1 e o CA-4 precisam passar de novo dentro do app, com os testes que o card nomeia, antes de qualquer troca.

## Contrato comum (para a fase dentro do app)

- O `TerminalService` recebe a fábrica de PTY por injeção, `options.pty ?? { spawn }` (`electron/main/services/terminal.service.ts:112`, tipo `PtyModule` em `electron/main/services/terminal/session-start.ts:18`).
- A sessão usa da `IPty`: `spawn`, `pid`, `process`, `onData`, `onExit` (`exitCode`), `write`, `resize` e `kill`.
- No Windows, o spawn passa `useConptyDll: true`, a ConPTY que o node-pty empacota (`session-start.ts:269`).
- O braço escolhido fica atrás de uma flag, desligada por padrão. Com a flag desligada, o comportamento é o de hoje.
- Uma falha do host chega ao painel como saída do terminal, com código, e nunca como exceção no processo principal.

## Decisões

O usuário aceitou as recomendações em 23/11.

1. **Transporte do braço D: pipe**, com framing próprio (`poc/pty-host/harness/frames.cjs`).
2. **ConPTY: a mesma do braço A.** Os braços B a D usam a ConPTY que o node-pty empacota. Confirmado nas medidas: `OpenConsole.exe` em todos.
3. ~~CI só depois do corte da 1.6.0.~~ Trocada pelo usuário em 23/11: a prova isolada roda agora, num ramo de CI próprio, fora da fila.
4. **Parser de VT em Rust: fica para outro card.**

## Fatos do código (22/11, main 67dcf3de0)

- O node-pty `^1.1.0` é importado direto no processo principal (`terminal.service.ts:2`).
- Não há Rust no app nem uso de `utilityProcess` em `electron/`.
- O pacote usa asar com integridade embutida e `onlyLoadAppFromAsar`. O node-pty fica em `asarUnpack` (`electron-builder.yml:30-49`).
- Nenhum workflow nem script do repositório assina o pacote.

## Fora do escopo

- Trocar o xterm.js ou o desenho do terminal na janela.
- Trocar o instalador. Atualização por diferença, como o Velopack, é outro card.
- O terminal do app Android.

## Referências

- Card OXE-400; OXE-392, OXE-349, OXE-122, OXE-396.
- Harness e host: `poc/pty-host/`; workflow `.github/workflows/pty-rust-poc.yml`.
- `electron/main/services/terminal.service.ts`, `electron/main/services/terminal/`, `electron-builder.yml`.
