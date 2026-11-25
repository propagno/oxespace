# O custo do terminal sob carga, alavanca por alavanca (OXE-411)

Estado: **medido; H e Q ligados por padrão desde a 1.6.0** (decisão do usuário, 23/11). `OXESPACE_TERM_LEVERS=none` volta ao terminal de antes do card; M e I só quando nomeados.

## Resposta curta

O ponto-chave do card era gastar pouca CPU sem perder desempenho.

1. **H, desligar os painéis de workspaces ocultos, é o ganho grande.** Com a carga num workspace fora da tela:
   - a CPU total do app cai 64% a 71%;
   - a CPU do renderer cai cerca de 90%;
   - o eco e o Ctrl+K melhoram de 27% a 59% no p95 nesta execução (na anterior, o eco p95 no Linux foi de 179 para 19 ms).

   Custa de 3 a 23 ms a mais ao voltar ao workspace no Linux, e nada no Windows. **Recomendo ligar por padrão.** É a correção que o OXE-349 propõe.
2. **Q, o scheduler de escrita do renderer como fila de pedaços, tira um gargalo quadrático.** O perfil do renderer mostrava uma função do `TerminalView` com 8 a 14 s de CPU própria em 33 a 36 s de perfil: o `flushNext`, que recopia toda a saída pendente a cada quadro. Com a fila, essa função some do perfil e a coleta de lixo cai pela metade.
   - Com a carga na tela, a CPU total não muda: o renderer continua ocupado com o xterm.
   - Na combinação H+Q, o Ctrl+K p95 no Windows caiu de 1.220 para 707 ms.
   - Um teste prova que a fila escreve exatamente o mesmo que antes.

   **Recomendo ligar por padrão.**
3. **M (espelho do agente no principal) e I (lotes maiores no IPC) não dão ganho relevante.** O principal gasta cerca de 20% de um núcleo e não é o gargalo. Ficam fora da recomendação.
4. **O que sobra é a carga na tela:** cerca de 1,1 núcleo no renderer, que é o xterm interpretando e desenhando 8 MB/s. O perfil mostra `print`, `decode`, `parse`, `setCellFromCodepoint`, e trabalho de DOM (`replaceChildren`, `offsetWidth`) dos painéis que ficam no renderer DOM. A próxima alavanca seria reduzir o desenho dos painéis visíveis sem foco. Não foi medida aqui.

## Configuração final, base contra o padrão (execução [45237475847](https://github.com/propagno/oxespace/actions/runs/45237475847))

O base é `OXESPACE_TERM_LEVERS=none`, o terminal de antes do card. O padrão é H+Q, já com:
- o `detach` estacionado: o painel volta só com o que perdeu, não conta como "sem view" e não é recolhido como ocioso;
- a fila que solta cada pedaço assim que ele é escrito.

Mediana de 5 rodadas; p95 sobre todas as amostras.

| Medida | Linux, base → padrão | Windows, base → padrão |
| --- | --- | --- |
| CPU total, carga oculta | 121% → **43%** | 118% → **39%** |
| CPU do renderer, carga oculta | 77% → **8%** | 76% → **8%** |
| Eco p95, carga oculta | 45 → **21 ms** | 96 → **47 ms** |
| Ctrl+K p95, carga oculta | 133 → **118 ms** | 181 → **66 ms** |
| Ctrl+K p95, carga na tela | 575 → 543 ms | 771 → **438 ms** |
| Eco p95, carga na tela | 99 → 103 ms | 124 → 110 ms |
| Troca de workspace, ida / volta | 58 / 57 → 53 / 67 ms | 251 / 206 → 264 / 178 ms |
| Memória no pico | 1.299 → 1.279 MB | 1.250 → 1.250 MB |
| Memória 10 s depois | 1.012 → **827 MB** | 880 → 920 MB |
| Laço do principal p95 com o app parado (piso) | 0,4 / 1,3 ms | **11,3 ms** |

- **O laço no Windows está explicado.** Com o app parado, o laço do principal no Windows já lê 11,3 ms no p95: é a granularidade do timer. Os 11,5 ms com a carga oculta e H ligado são esse piso, não um bloqueio.
- **A memória está corrigida.** A execução anterior ([45233833213](https://github.com/propagno/oxespace/actions/runs/45233833213)) mediu, no Linux, 1.062 MB 10 s depois com o padrão, contra 819 MB do base. A causa era a fila guardar os pedaços já escritos até compactar (a cada 1.024). Agora cada pedaço é solto ao ser escrito.

## Como foi medido

- **Ferramentas:** `e2e/perf/terminal-load-breakdown.spec.ts` no app construído, com PTY real e o host do PTY como padrão (OXE-400, PR #1144), rodado por `.github/workflows/terminal-load.yml` em `windows-2022` e `ubuntu-22.04`.
- **Lançamentos:** cada um abre um workspace quieto (2 painéis) e um de carga (10 painéis, com 8 imprimindo cerca de 1 MB/s de ANSI por 40 s).
- **Duas fases por lançamento:**
  - **na tela:** o workspace de carga está visível, que é o cenário do perf-load. Digita-se no painel parado dele;
  - **oculta:** o quieto está visível e a carga continua atrás. Digita-se num painel do quieto.
- **O que se mede em cada fase:**
  - eco de tecla, da tecla ao eco desenhado;
  - Ctrl+K até o primeiro item;
  - laço do principal (p95, sem o tique do medidor);
  - CPU, em % de um núcleo, e memória por tipo de processo.
- **Rodadas:** 5 por braço, com a ordem dos braços alternando a cada rodada, no mesmo runner. Na rodada 1, os braços base, Q e H+Q gravam um perfil de CPU do renderer.
- **Execuções:**
  - [45209300581](https://github.com/propagno/oxespace/actions/runs/45209300581): base, H, M, I e H+M+I;
  - [45216166393](https://github.com/propagno/oxespace/actions/runs/45216166393): base, Q, H e H+Q.

## Resultados (execução 45216166393; mediana de 5 rodadas, p95 sobre todas as amostras)

### Carga num workspace oculto

| Braço | Linux: CPU total / renderer | Linux: eco p95 | Linux: Ctrl+K p95 | Windows: CPU total / renderer | Windows: eco p95 | Windows: Ctrl+K p95 |
| --- | --- | --- | --- | --- | --- | --- |
| base | 113% / 77% | 30 ms | 145 ms | 149% / 95% | 149 ms | 201 ms |
| Q | 111% / 76% | 32 ms | 159 ms | 151% / 97% | 146 ms | 178 ms |
| **H** | **33% / 7%** | **22 ms** | **100 ms** | **53% / 11%** | **61 ms** | **112 ms** |
| **H+Q** | **35% / 8%** | **22 ms** | 126 ms | **54% / 11%** | 70 ms | **92 ms** |

A execução anterior deu o mesmo:
- **Linux:** a CPU total caiu de 131% para 45%, e o eco p95 de 179 para 19 ms;
- **Windows:** a CPU total caiu de 165% para 62%, e o eco p95 de 166 para 119 ms.

### Carga na tela

| Braço | Linux: CPU total / renderer | Linux: eco p95 | Linux: Ctrl+K p95 | Windows: CPU total / renderer | Windows: eco p95 | Windows: Ctrl+K p95 |
| --- | --- | --- | --- | --- | --- | --- |
| base | 175% / 121% | 89 ms | 474 ms | 207% / 108% | 427 ms | 1.220 ms |
| Q | 174% / 121% | 85 ms | 461 ms | 209% / 106% | 424 ms | 1.001 ms |
| H | 174% / 121% | 79 ms | 449 ms | 206% / 107% | 364 ms | 1.016 ms |
| H+Q | 174% / 122% | 75 ms | 462 ms | 207% / 105% | 337 ms | 707 ms |

### Troca de workspace e memória (mediana)

| Braço | Linux: troca ida / volta | Linux: memória no pico / 10 s depois | Windows: troca ida / volta | Windows: memória no pico / 10 s depois |
| --- | --- | --- | --- | --- |
| base | 50 / 50 ms | 1.271 / 826 MB | 332 / 281 ms | 1.358 / 1.147 MB |
| H | 47 / 57 ms | 1.293 / 833 MB | 331 / 254 ms | 1.358 / 920 MB |
| H+Q | 54 / 53 ms | 1.288 / 833 MB | 352 / 255 ms | 1.275 / 1.092 MB |

A memória varia entre rodadas e não mostra ganho consistente de nenhuma alavanca. O renderer, com 600 a 700 MB no pico, é o maior consumidor. O 1,26 GB do OXE-349 é a soma de principal, renderer, GPU e host do PTY.

### Perfil do renderer (rodada 1, CPU própria das funções do topo)

| | Linux base, execução 1 | Windows base, execução 2 | Windows Q | Windows H+Q |
| --- | --- | --- | --- | --- |
| `flushNext` do `TerminalView` (scheduler de escrita) | **13.808 ms** | **8.336 ms** | — (fora do top 10) | — |
| coleta de lixo | 3.904 ms | 3.278 ms | 1.541 ms | 788 ms |
| ocioso | — | 1.733 ms | 4.336 ms | 15.110 ms |

O gargalo do `flushNext` aparece quando um painel fica atrás da própria saída. Por isso ele não aparece em todo perfil: no Linux base da execução 2, por exemplo, não apareceu. Quando aparece, é a função que mais gasta no renderer.

## Achados

1. **Painéis ocultos custam como visíveis.** Sem H, o painel de um workspace oculto continua recebendo toda a saída por IPC e escrevendo no xterm. Isso põe o renderer em 77% a 95% de um núcleo por uma tela que ninguém vê.
2. **O scheduler de escrita tinha custo quadrático.** Ele fazia `pending.slice(64 KB)` sobre a saída pendente inteira a cada quadro (`src/components/Terminal/terminalWriteScheduler.ts`). A fila (Q) tem custo proporcional ao quadro.
3. **O processo principal não é o gargalo:** cerca de 20% de um núcleo, com o laço p95 entre 1 e 2 ms. O espelho do agente (M) e o tamanho dos lotes (I) não mudam isso.
4. **O laço do principal no Windows com H** sobe de um p95 de 1,6 para 11,6 ms, só na fase oculta. A execução final mediu o laço com o app parado: no Windows ele já lê 11,3 ms. É a granularidade do timer com o principal ocioso, não um bloqueio.

## Recomendação

1. **H e Q ligados por padrão** (feito, 23/11).
   - **H** é a correção do OXE-349. Os dois efeitos colaterais foram tratados: o painel estacionado não conta como "sem view" e não é recolhido como ocioso, e a volta acrescenta só o que faltou em vez de limpar e reescrever.
   - **Q** troca só a estrutura interna do scheduler, e o teste prova que ele escreve o mesmo.
2. **Não ligar M nem I.**
3. **Próximo card, se a carga na tela importar:** reduzir o desenho dos painéis visíveis sem foco, por exemplo com um teto de quadros, e medir por que parte dos painéis visíveis fica no renderer DOM (`MAX_WEBGL_CONTEXTS`).

**Números-alvo para fechar o OXE-349 com H+Q**, com a carga oculta no Windows:
- CPU total ≤ 60%;
- eco p95 ≤ 80 ms;
- Ctrl+K p95 ≤ 120 ms.

## Referências

- OXE-411, OXE-349, OXE-400 (`docs/validation/pty-rust-poc.md`), OXE-122.
- `shared/terminal-levers.ts`, `src/components/Terminal/TerminalView.tsx`, `src/components/Terminal/terminalWriteScheduler.ts`, `electron/main/services/terminal.service.ts`.
- `e2e/perf/terminal-load-breakdown.spec.ts`, `tests/terminal-load-levers.test.ts`, `.github/workflows/terminal-load.yml`.
