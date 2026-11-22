# React Compiler no renderer: spike (OXE-124, A4)

**Decisão: descartar** o `babel-plugin-react-compiler@1.0.0` na 1.5.2.

O ganho de render existe, mas dois dos três critérios de adoção falham:

| Critério | Limite | Medido | Resultado | Fonte |
|---|---|---|---|---|
| Ganho de render | ≥ 10% | 12,1% no cenário de shell e 38,7% no de Thread (total dos commits); desigual por superfície | passa no total | run 44985364737 |
| Gate OXE-105 | nenhuma regressão | 4 linhas regridem, entre elas o chunk de entrada (+21,3%) | **falha** | run 44982105664 |
| Tempo de build | no máximo +20% | +30,6% | **falha** | run 44979520672 |

Com o compilador, `npm run verify:bundle` também reprova: a entrada do renderer vai a 324 kB, para um orçamento de 299 kB (run 44979520672).

## Como foi medido

- Base: `main` em `5278dedfccf5677511f2d9ea713c58e019d00799` (22/11/2026). Antes = sem o compilador; depois = o mesmo commit com o compilador.
- O plugin foi instalado só no runner (`npm install --no-save`). Um probe não commitado em `electron.vite.config.ts` o ligou pela opção `babel` do `@vitejs/plugin-react`. Nem dependência nem configuração mudam neste branch.
- Os dois lados de cada run rodam no mesmo runner Linux x64 de 4 CPUs, em pares com a ordem alternada. A CPU muda de um run para outro, então só se compara dentro do mesmo run.
- O comando completo de cada medição está no log do run e na mensagem do commit de snapshot.

| Medição | Run | Snapshot | CPU | Amostras |
|---|---|---|---|---|
| Build, artefatos e compilação | run 44979520672 | `0aa80c80d` | AMD EPYC 9V74 | 8 pares, após aquecimento |
| Gate OXE-105, app empacotado | run 44982105664 | `7dca64a4c` | Intel Xeon 8573C | 7 pares |
| Render por superfície | run 44985364737 | `9ea30d3cb` | AMD EPYC 9V45 | 12 pares |

## Tempo de build (run 44979520672)

| Métrica | Antes | Depois | Delta (mediana dos pares) |
|---|---:|---:|---:|
| Tempo de build, `electron-vite build` inteiro | 88,48 s | 115,86 s | **+30,6%** |
| Tempo de build, só o renderer (resolução de 1 s) | 79,0 s | 106,5 s | +34,0% |

Build inteiro por rodada, em ms:

- antes: 86113, 85794, 84809, 91249, 89444, 88520, 92205, 88439
- depois: 112681, 115289, 115524, 118848, 116190, 121260, 118651, 115331

## Chunks do renderer (run 44979520672)

Bytes minificados; gzip no nível 9. São os maiores deltas, mais a carga inicial e o CommandMenu.

| Chunk / bundle | Antes | Depois | Delta | gzip antes | gzip depois | Delta gzip |
|---|---:|---:|---:|---:|---:|---:|
| index (entrada) | 273 296 | 331 400 | **+21,3%** | 89 712 | 111 371 | +24,1% |
| vendor | 851 723 | 852 265 | +0,1% | 243 985 | 244 159 | +0,1% |
| Carga inicial (index + vendor) | 1 125 019 | 1 183 665 | +5,2% | 333 697 | 355 530 | +6,5% |
| ThreadGrid | 229 934 | 281 372 | +22,4% | 70 957 | 92 456 | +30,3% |
| settingsPages | 140 556 | 179 522 | +27,7% | 40 033 | 56 778 | +41,8% |
| OxeQueryView | 183 868 | 209 228 | +13,8% | 55 924 | 66 638 | +19,2% |
| WorkspaceGitHubPanel | 61 816 | 84 210 | +36,2% | 13 561 | 22 147 | +63,3% |
| ReviewPane | 22 656 | 37 625 | +66,1% | 6 619 | 12 648 | +91,1% |
| CommandMenu | 7 112 | 8 828 | +24,1% | 2 836 | 3 614 | +27,4% |
| Todo o bundle JS (233 arquivos) | 23 593 824 | 23 982 558 | +1,6% | 6 188 731 | 6 354 741 | +2,7% |

## Cobertura do compilador (run 44979520672)

O compilador analisou 640 funções:

- compilados: 506 (454 componentes e 52 hooks)
- bailouts: 134 (115 componentes e 19 hooks), 20,9% do total

| Motivo do bailout | Funções |
|---|---:|
| `try` com `finally` | 62 |
| Condicional, lógico ou optional chaining dentro de `try/catch` | 16 |
| Regra de ESLint do React suprimida | 10 |
| Ref lida durante o render | 9 |
| `import()` no corpo | 7 |
| Memoização manual não preservada | 4 |
| `try` sem `catch` | 4 |
| Hook usado como valor | 4 |
| `useMemo` sem função inline | 4 |
| Update de variável global | 3 |
| Outros oito motivos | 11 |

Nas quatro superfícies pedidas, só o componente Sidebar compila:

| Componente | Resultado | Motivo |
|---|---|---|
| Sidebar | compilado | — |
| ThreadView | bailout | `try` com `finally` |
| PaneContainer | bailout (o auxiliar PaneSubmenu compila) | expressão condicional dentro de `try/catch` |
| CommandMenu | bailout (o auxiliar ActionItem compila) | update de variável global |

## Render por superfície (run 44985364737)

Soma de `actualDuration` do React por cenário de `e2e/perf-benchmark.spec.ts`, com `react-dom/profiling` e sem minificação nos dois lados. O tempo de uma superfície inclui os filhos, por isso ThreadView melhora mesmo sem compilar. Delta = mediana das diferenças por par, com IC95 por bootstrap; negativo é mais rápido.

| Superfície | Cenário | Antes (ms) | Depois (ms) | Delta [IC95] |
|---|---|---:|---:|---:|
| Sidebar | shell | 58,8 | 33,8 | -41,6% [-45,8; -39,0] |
| Sidebar | Thread de 5 mil eventos | 24,7 | 13,4 | -45,4% [-49,0; -38,9] |
| ThreadView | Thread de 5 mil eventos | 870,6 | 467,5 | -45,7% [-48,3; -42,5] |
| PaneContainer | shell | 38,0 | 35,5 | -8,9% [-11,0; -1,5] |
| PaneContainer | Thread de 5 mil eventos | 10,0 | 8,8 | -10,8% [-20,6; +0,6], dentro do ruído |
| CommandMenu | shell | 58,8 | 55,0 | -3,4% [-10,8; +0,6], dentro do ruído |
| CommandMenu | Thread de 5 mil eventos | 6,3 | 7,1 | **+14,7%** [+6,1; +36,1], piora |
| Todos os commits | shell | 422,8 | 373,8 | -12,1% [-14,2; -9,8] |
| Todos os commits | Thread de 5 mil eventos | 1103,5 | 675,7 | -38,7% [-40,9; -35,4] |

## Gate OXE-105 (run 44982105664)

App empacotado, resumido por `perf-gate/summarize.mjs`. Cada lado é a mediana de 7 rodadas; o delta é a mediana das diferenças por par, por isso pode não ser igual a depois menos antes. No boot, cada rodada é a mediana de 3 aberturas após 1 de aquecimento.

| Métrica | Antes | Depois | Delta [IC95] | Veredito |
|---|---:|---:|---:|---|
| Boot: process → interactive (ms) | 974 | 956 | -13,9 [-22,0; -0,9] | melhora |
| Boot: window → first paint (ms) | 243 | 239 | -3,9 [-6,0; +3,3] | ruído |
| Mode switch Code → Thread (ms) | 30,3 | 30,8 | +0,8 [-0,5; +0,9] | ruído |
| Mode switch Thread → OxeQuery (ms) | 25,4 | 25,1 | -0,4 [-0,6; -0,1] | melhora |
| Mode switch OxeQuery → Code (ms) | 33,0 | 33,3 | +0,3 [-0,4; +0,8] | ruído |
| Keystroke → paint, idle (ms) | 22,5 | 24,1 | -0,4 [-10,1; +11,6] | ruído |
| Keystroke → paint, agent streaming (ms) | 27,4 | 24,8 | -2,5 [-3,0; -0,7] | melhora |
| Panel first open: Files (ms) | 25,4 | 26,2 | +0,1 [-1,1; +1,6] | ruído |
| Panel first open: Changes (ms) | 29,5 | 27,3 | -2,4 [-3,2; +0,8] | ruído |
| Panel first open: Commit & PR (ms) | 23,7 | 22,9 | -0,2 [-1,6; +0,3] | ruído |
| Panel first open: Find in files (ms) | 29,6 | 29,2 | -1,3 [-2,2; +6,1] | ruído |
| Panel first open: Worktrees (ms) | 26,4 | 26,1 | -0,5 [-2,2; 0,0] | ruído |
| Panel first open: Browser (ms) | 38,4 | 32,8 | -3,1 [-6,0; -2,7] | melhora |
| MCP servers modal, first open (ms) | 42,4 | 41,9 | -0,5 [-1,4; +0,2] | ruído |
| Command palette, first open (ms) | 60,5 | 52,1 | -11,6 [-14,9; -7,0] | melhora |
| Settings, first open (ms) | 57,9 | 58,3 | -1,0 [-1,9; +2,2] | ruído |
| OxeChat cold open: first content (ms) | 135 | 118 | -11,0 [-19,0; -11,0] | melhora |
| OxeChat cold open: sidebar blank (ms) | 38,0 | 37,0 | -1,0 [-2,0; +1,0] | ruído |
| /resume: session list, cold (ms) | 251 | 254 | +3,8 [+1,4; +9,1] | **regride** |
| /resume: session list, main-process stall (ms) | 0,9 | 0,6 | -0,1 [-0,4; +0,3] | ruído |
| /resume: session list, second open (ms) | 4,9 | 5,0 | +0,3 [-0,1; +0,3] | ruído |
| /resume: second open, main-process stall (ms) | 0,5 | 0,8 | +0,3 [-0,3; +0,7] | ruído |
| /resume: import the 200 MB session (ms) | 61,6 | 62,0 | +0,7 [+0,1; +2,5] | **regride** |
| /resume: import, main-process stall (ms) | 7,1 | 6,7 | +3,2 [-4,9; +4,5] | ruído |
| /resume: open the resumed conversation (ms) | 43,0 | 43,0 | +4,0 [-32,0; +18,0] | ruído |
| Context indicator: first read (ms) | 1,4 | 1,4 | 0,0 [-0,1; 0,0] | ruído |
| Context indicator: update after a turn (ms) | 0,7 | 0,7 | 0,0 [-0,1; 0,0] | ruído |
| Context indicator: update, main-process stall (ms) | 0,3 | 0,3 | +0,1 [-0,1; +0,9] | ruído |
| Context indicator: resumed conversation (ms) | 0,4 | 0,4 | 0,0 [-0,1; 0,0] | ruído |
| Memory, 4 terminals, working set (MB) | 706 | 707 | +1,1 [-1,9; +1,4] | ruído |
| Memory, 4 terminals, private bytes (MB) | n/a | n/a | n/a | não medido |
| Renderer entry chunk (KiB) | 266,89 | 323,63 | +56,74 | **regride** |
| Renderer entry chunk, gzip (KiB) | 87,61 | 108,76 | +21,15 | **regride** |

Total: 4 regridem, 6 melhoram, 22 ficam no ruído e 1 não foi medida.

## Limites desta medição

- **O ganho de boot é marginal.** Refeito com outro gerador aleatório sobre os valores por rodada do log (arredondados), o intervalo de process → interactive fica em -13 ms [-22; 0] e encosta em zero.
- **As duas regressões de /resume podem não vir do compilador.** Elas cronometram chamadas IPC ao processo main (`session.list` e `thread.command`), e no run 44985364737 as saídas de main e preload foram idênticas com e sem o plugin. Com cerca de 30 comparações, falsos positivos são possíveis. A decisão não depende delas: o chunk de entrada e o tempo de build já reprovam.
- **`e2e/perceived-perf.spec.ts:466` falhou em 10 das 14 execuções do gate**, 5 de cada lado. A causa não aparece no log guardado e não foi investigada.
- **`scripts/bench-thread.mjs` não produziu números.** Falhou nas duas tentativas do run 44985364737 com ``Unknown option `--outputJson` `` do Vitest, um defeito do script em main.
- **Windows e macOS não foram medidos.**

## Quando reavaliar

Uma nova medição faz sentido se o build ficar dentro de +20% (versão nova do plugin ou outra toolchain) e a entrada couber no orçamento, por exemplo compilando só Sidebar e a árvore de ThreadView pelo modo `annotation` ou por `sources`. Esse recorte não foi medido. Uma adoção futura é um card próprio, porque acrescenta dependência.
