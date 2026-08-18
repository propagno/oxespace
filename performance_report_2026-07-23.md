# Relatório de performance do OXESpace

Data: 23/07/2026  
Versão avaliada: `0.3.0`  
Plataforma: Windows 11 build 26200, Intel Core i7-11370H (4 núcleos/8 threads), 15,8 GB RAM, Node 22.17.1, npm 10.9.2

## Resumo executivo

- A suíte visual final terminou com **14/14 cenários aprovados**, cobrindo inicialização, troca entre workspaces com terminais nativos, shell, sidebar, layouts, editor, GitHub/Source Control, Review, Worktrees, Scripts, busca, Web Preview, multi-repositório, jobs, configurações, MCP, Skills, atividade semântica e uso/limites.
- Após as otimizações, o aplicativo chegou à primeira janela em **669,2 ms** e ficou interativo **426,8 ms** depois: **1,096 s** do lançamento até a interação.
- A criação de workspace caiu para **952,7 ms**.
- Após abrir um workspace, os processos Electron somaram **635,2 MB de working set**, com pico de **638,0 MB**; o heap JavaScript do renderer permaneceu em **40,1 MB**. A soma de working sets pode contar páginas compartilhadas mais de uma vez.
- Aberturas quentes dos painéis principais ficaram, em geral, entre **65 e 88 ms**. O primeiro acesso ficou perto de **378–423 ms**, indicando custo comum de carregamento/montagem.
- Os pontos mais perceptíveis foram: menu de comandos, troca entre os dois renderizadores de layout, criação real de split, fechamento de modais com backdrop e operações Git/rg que criam processos no Windows.
- Busca semântica passou pelo gate de qualidade e reduziu o contexto em **93%**, mas o Recall@1 de **33%** mostra que ainda existe margem relevante para melhorar ranking.

As cores emitidas pelos benchmarks usam dois limites heurísticos: 16,7 ms (um frame a 60 Hz) e 100 ms (latência normalmente perceptível). Eles servem para priorização, não são ainda budgets formais de CI.

## Resultado após a otimização aprovada

Foi aplicada uma segunda rodada focada na abertura de terminais e na troca entre workspaces. A comparação abaixo usa a mesma máquina e o mesmo build de produção. Os tempos de um único evento, especialmente a criação de split, devem ser tratados como indicativos; as transições quentes usam múltiplas amostras.

| Fluxo | Antes | Depois | Variação |
|---|---:|---:|---:|
| Lançamento → UI interativa | 1.212,7 ms | 1.096,0 ms | **−9,6%** |
| Wizard → grid do workspace | 1.017,3 ms | 952,7 ms | **−6,4%** |
| Working set agregado | 661,8 MB | 635,2 MB | **−4,0%** |
| Recolher sidebar, quente | 55,4 ms | 41,0 ms | **−26,0%** |
| Expandir sidebar, quente | 81,3 ms | 61,2 ms | **−24,7%** |
| Split-tree → grid legado, quente | 131,3 ms | 74,2 ms | **−43,5%** |
| Grid legado → split-tree, quente | 123,8 ms | 80,6 ms | **−34,9%** |
| Criar split, render visível | 454,7 ms | 384,8 ms | **−15,4%** |

A nova medição específica de troca A↔B entre dois workspaces já montados, ambos com terminal nativo, terminou em **93,6 ms de média quente** e **113,9 ms de p95**. Durante a própria rodada de otimização ela caiu de 115,3 ms para 93,6 ms (**−18,8%**). O terminal do novo split chegou ao estado `running` em **397,8 ms**.

As mudanças responsáveis por esses ganhos foram:

- assinaturas Zustand mais específicas e rasas, evitando redesenhar terminais e superfícies que não mudaram;
- superfícies de workspace e linhas da sidebar memoizadas;
- MRU de workspaces mantido montado e podado após o frame, com o workspace ativo incluído imediatamente;
- `fit` do xterm consolidado em um único frame e um ajuste tardio, sem enviar resize IPC quando colunas e linhas não mudam;
- detecção WebGL cacheada e resolução de executáveis de shell com cache positivo;
- inicialização do terminal reduzida a uma consulta SQL preparada;
- polling de Git, integrações, watcher semântico e hidratações pesadas pausados ou adiados para workspaces inativos;
- `content-visibility` e containment nas superfícies ocultas.

Validação final: os 14 cenários visuais passaram quando executados em três grupos (1 inicialização, 2 shell/workspace e 11 painéis/modais), além de 47 testes de integração direcionados, typecheck, verificação dos módulos nativos para a ABI 125 do Electron e build de produção. A abertura real de PTY no benchmark cobre o caminho nativo de SQLite e `node-pty`.

As tabelas detalhadas após a metodologia preservam a linha de base anterior à otimização para permitir comparação e rastreabilidade.

## Metodologia

- UI: aplicativo Electron compilado, automatizado por Playwright e medido com `performance.now()`.
- Cada painel recebeu seis ciclos; a estatística “warm” descarta a primeira amostra.
- Superfícies puramente visuais usam IPC nativo simulado para isolar a renderização. O cenário de shell/split usa banco, IPC e terminal nativos.
- Serviços: repositórios e árvores de arquivos temporários reais, com Git e ripgrep executados como processos filhos.
- CPU: benchmarks Vitest para sanitização do terminal, chunking e ranking semântico.
- Semântica: 30 consultas em português sobre 417 arquivos e 2.913 chunks.
- A máquina tinha aproximadamente 3,1 GB de RAM livre ao final da rodada. Antivírus, cache do sistema e carga de fundo podem afetar principalmente processos Git/rg e cold starts.

## Inicialização e memória

| Operação | Resultado |
|---|---:|
| Processo iniciado → primeira janela | 736,7 ms |
| Primeira janela → UI interativa | 476,0 ms |
| Total até interação | 1.212,7 ms |
| Wizard → grid do workspace | 1.017,3 ms |
| Working set agregado após workspace | 661,8 MB |
| Pico agregado | 665,8 MB |
| Heap do renderer | 40,1 MB |

## Shell, sidebar e layout

Este cenário usa serviços nativos.

| Operação | Média | Média quente | p95 quente |
|---|---:|---:|---:|
| Recolher sidebar | 55,1 ms | 55,4 ms | 61,5 ms |
| Expandir sidebar | 84,7 ms | 81,3 ms | 132,2 ms |
| Abrir menu de comandos | 124,9 ms | 114,3 ms | 128,5 ms |
| Fechar menu de comandos | 204,2 ms | 197,4 ms | 215,9 ms |
| Abrir menu Tools | 148,4 ms | 104,7 ms | 146,1 ms |
| Fechar menu Tools | 23,4 ms | 24,0 ms | 32,2 ms |
| Split-tree → grid legado | 126,6 ms | 131,3 ms | 159,0 ms |
| Grid legado → split-tree | 118,4 ms | 123,8 ms | 134,5 ms |
| Criar novo split (banco + IPC + render) | 454,7 ms | — | — |

O fechamento do menu de comandos é consistentemente mais lento que sua abertura. A criação de split cruza main process, SQLite, store e renderer; por isso é o fluxo local de UI mais caro desta rodada.

## Editor, repositório e painéis

| Superfície | Abrir quente | p95 quente | Fechar quente |
|---|---:|---:|---:|
| GitHub / Source Control | 74,7 ms | 81,5 ms | 66,1 ms |
| Editor / Files | 72,0 ms | 78,3 ms | 69,3 ms |
| Review | 88,4 ms | 111,2 ms | 83,0 ms |
| Worktrees | 75,7 ms | 81,6 ms | 68,8 ms |
| Scripts | 68,7 ms | 75,6 ms | 64,4 ms |
| Find in Files | 69,2 ms | 83,5 ms | 66,1 ms |
| Web Preview | 65,2 ms | 72,5 ms | 66,0 ms |
| Multi-repo coordination | 79,2 ms | 85,2 ms | 51,2 ms |
| Background Jobs | 71,6 ms | 84,7 ms | 63,1 ms |

Trocar de Files para Source Control levou **76,4 ms em média quente**; o caminho inverso, **67,7 ms**. O primeiro acesso aos painéis ficou entre 377,8 e 422,7 ms, o que sugere um custo compartilhado de inicialização do menu/painel, não um problema isolado em uma feature.

## Modais e ferramentas

| Modal | Abrir quente | Fechar |
|---|---:|---:|
| Agent Settings | 71,5 ms | 63,8 ms |
| MCP Servers | 78,8 ms | 284,8 ms |
| Skills | 70,2 ms | 267,3 ms |
| Semantic Activity | 68,2 ms | 287,0 ms |
| Workspace Settings | 83,0 ms | 41,2 ms |
| Usage & Rate Limits | 308,5 ms | 250,1 ms |

MCP, Skills e Semantic compartilham backdrops com blur e estruturas semelhantes, e também compartilham o mesmo perfil lento no fechamento. O modal de Usage usa o fluxo Radix com animação de saída e ainda inclui a pesquisa/seleção no menu de comandos na medição de abertura.

## Busca e Git reais

Fixtures:

- Busca: 2.000 arquivos, cerca de 40 linhas por arquivo.
- Git: 300 arquivos versionados, 100 modificados.
- Os tempos incluem criação de processos no Windows.

| Operação | Média | p99/máximo observado |
|---|---:|---:|
| Listar 2.000 arquivos | 67,45 ms | 79,10 ms |
| Busca literal, 200 arquivos com resultado | 137,37 ms | 187,39 ms |
| Busca sem resultado | 110,19 ms | 120,29 ms |
| Ler branch/status básico | 126,48 ms | 138,75 ms |
| Construir diff de 100 arquivos | 216,44 ms | 228,36 ms |
| Stage + unstage de um arquivo | 136,74 ms | 144,72 ms |
| Stage + commit de um arquivo novo | 194,94 ms | 199,27 ms |

`stage + unstage` mede duas invocações Git; `stage + commit` inclui duas invocações e a criação de um arquivo pequeno. Fetch, pull, push, PRs, releases e workflows não receberam números porque dependem de rede, autenticação, servidor remoto e rate limit. Simular esses fatores produziria uma medida pouco útil.

## Terminal e CPU

| Hot path | Média |
|---|---:|
| Remover ANSI de 2 KB | 0,0142 ms |
| Remover ANSI de 16 KB | 0,0893 ms |
| Sanitizar saída ANSI de 2 KB | 0,0468 ms |
| Sanitizar saída ANSI de 16 KB | 0,2760 ms |
| Similaridade de um par semântico | 0,0008 ms |
| Selecionar melhor entre 5 chunks | 0,0050 ms |
| Ranking de consulta sobre 10.000 arquivos | 49,59 ms |
| Chunking de 80 KB | 0,0011 ms |

Sanitização e parsing de terminal não são gargalos. O ranking síncrono de 10 mil itens excede um frame e deve continuar fora do caminho crítico de pintura. O round-trip interativo de um shell específico não foi usado como métrica porque prompt, perfil do PowerShell e scripts de inicialização variam por máquina; o caminho nativo foi exercitado na criação do workspace e do split.

## Qualidade e custo semântico

Modelo: `multilingual-e5-base`.

| Métrica | Resultado |
|---|---:|
| Consultas | 30 |
| Corpus | 417 arquivos / 2.913 chunks |
| Recall@1 | 33% |
| Recall@5 | 70% |
| MRR chunked | 0,494 |
| MRR híbrido | 0,493 |
| Contexto semântico | 25.868 tokens |
| Contexto híbrido | 1.737 tokens |
| Redução híbrida | 93% |
| Quality gate | aprovado |

O benchmark heurístico complementar, com oito tarefas, mediu **73% de redução total de tokens**: RCS 792,1 contra baseline de 2.930,1 tokens por tarefa. Esse teste não usa o binário RTK real e deve ser interpretado como estimativa controlada.

Resultados detalhados:

- `tests/token-bench/results/eval-2026-07-23T16-21-20-994Z.md`
- `tests/token-bench/results/bench-2026-07-23T16-21-45-840Z.md`

## Build e budgets

O build de produção terminou em 62,7 s e todos os budgets passaram:

| Artefato | Tamanho | Budget |
|---|---:|---:|
| Main | 796 KB | 900 KB |
| Preload | 23 KB | 40 KB |
| Renderer JS | 369 KB | 500 KB |
| CSS | 475 KB | 500 KB |

O CSS está em **95% do budget**, sendo o artefato com menor folga.

## Prioridades recomendadas

1. **Reduzir o custo de saída dos overlays.** Medir separadamente desmontagem, animação e `backdrop-filter`; buscar fechamento abaixo de 120 ms para Command, MCP, Skills, Semantic e Usage.
2. **Evitar remontagem pesada ao alternar layouts.** Preservar instâncias de panes/terminais entre grid legado e split-tree ou limitar a atualização aos wrappers de layout.
3. **Otimizar o menu de comandos.** Perfil de React e Radix durante abertura/fechamento; memoizar grupos/ações e reduzir trabalho disparado pela mudança de `open`.
4. **Mascarar a latência do split.** Inserir placeholder otimista imediatamente e concluir banco/IPC em segundo plano, com rollback visual em caso de erro.
5. **Reduzir spawns Git/rg.** Agrupar status/diff quando possível, manter cache curto e cancelar pesquisas substituídas por uma consulta mais nova.
6. **Melhorar ranking semântico.** O ganho de tokens é excelente, mas Recall@1 de 33% justifica ajustar corpus, normalização, pesos híbridos e reranking.
7. **Controlar o crescimento de CSS.** O bundle está a 25 KB do limite; remover regras duplicadas e dividir estilos de superfícies raramente abertas.
8. **Adicionar gates estáveis de CI.** Usar mediana de várias execuções em runner fixo e budgets separados para cold start, warm UI, serviços e memória.

## Comandos reproduzíveis

```powershell
npm run build
npm run bench:cpu
npm run bench:services
npm run bench:ui
npm run bench:semantic
npm run bench:semantic:gate
node scripts/token-reduction-bench.mjs
npm run typecheck
```

## Validação desta rodada

- `npm run bench:cpu`: aprovado.
- `npm run bench:services`: aprovado.
- `npm run bench:ui`: **13/13 aprovado**.
- `npm run bench:semantic`: concluído.
- `npm run bench:semantic:gate`: aprovado.
- `npm run build` + budgets: aprovado.
- `npm run typecheck`: aprovado.
- ESLint dos arquivos criados/alterados pelo benchmark: aprovado sem avisos.
