# Rust onde paga: desempenho de atividades paralelas

Pesquisa de 30/10/2026, pedida pelo usuário depois de a máquina de desenvolvimento (16 GB, 8 núcleos) ficar com 0,5 GB livres com o OXESpace 1.3.3 aberto e quatro sessões de agentes trabalhando nele.

## Medição (30/10/2026, Windows 11, OXESpace 1.3.3 instalado)

Memória por grupo de processos no pico:

| Processos | Quantidade | RAM | Observação |
|---|---|---|---|
| node | 25 | 2,6 GB | builds e testes das sessões: `electron-vite build` (2,3 GB), dois `tsc` (1,1 GB), Playwright, vitest |
| claude (CLI) | 9 | 2,4 GB | ~300–400 MB por sessão de agente |
| java | 2 | 1,4 GB | daemons do Gradle parados (app Android) |
| msedge | 19 | 1,0 GB | navegador |
| OXESpace | 5 | 0,45 GB | main, renderer, GPU, utility, crashpad |

CPU do OXESpace com 6 agentes em TUI de tela cheia, amostra de 10 s:

| Processo | CPU (% de um núcleo) |
|---|---|
| renderer | 21 % |
| GPU | 20 % |
| main | 6 % |

Tempo de CPU acumulado na sessão: renderer 5.970 s, GPU 5.599 s, main 3.210 s.

**Conclusão da medição:** o colapso de memória veio do trabalho de desenvolvimento em paralelo (builds, verificação de tipos, testes, Gradle), não da arquitetura do OXESpace. O OXESpace custa pouca memória, mas cerca de meio núcleo contínuo para desenhar terminais de agentes, e esse custo cresce linearmente com o número de terminais visíveis. É esse custo que importa para o produto: o OXESpace existe para rodar muitos agentes em paralelo.

## Onde o tempo vai (caminho de um terminal)

1. O PTY (`node-pty`) entrega bytes ao processo principal.
2. `PtyOutputBatcher` junta a saída a cada 16 ms ou 32 KiB e manda ao renderer por IPC, por pane.
3. O renderer passa os bytes ao xterm.js, que interpreta as sequências ANSI em JavaScript e desenha com WebGL.

As TUIs dos agentes (Claude Code em tela cheia, Codex) redesenham a tela inteira continuamente: spinners, contadores e barras de status geram saída mesmo quando o agente "só está pensando". Com 6 panes visíveis, isso vira 6 fluxos de parse ANSI em JavaScript e 6 superfícies WebGL redesenhando a cerca de 60 quadros por segundo, inclusive panes que a pessoa não está olhando.

## Opções, da mais barata à mais cara

### 1. Sem Rust, primeiro (1.4): renderização econômica por visibilidade

Ganho esperado alto, risco baixo. Nada disso exige Rust:

- **Ritmo por foco:** pane focado a 60 qps; visível sem foco a até 10 qps (batcher com 100 ms); fora da tela ou de outra aba, sem envio ao renderer (o main guarda no `PtyRingBuffer` e entrega o retrato ao voltar, como já acontece com panes destacados).
- **Uma superfície WebGL por janela** (atlas compartilhado), em vez de uma por pane; o `webglBudget` já limita o número, passa a priorizar o pane focado.
- **Polling por pane** (créditos, uso de contexto) trocado por um único temporizador por janela.
- **Meta na CI:** cenário novo no `bench:ui` com 6 TUIs transmitindo; renderer + GPU abaixo de 25 % de um núcleo com um pane focado.

### 2. Rust onde paga (1.5), em ordem de retorno esperado

Cada item entra só se a medição do item 1 mostrar que o gargalo continua no ponto que ele ataca. Todos como módulo nativo (napi-rs) dentro do Electron atual, um por vez, com ganho medido antes do merge.

| # | Onde | Ideia | Ganho esperado | Custo |
|---|---|---|---|---|
| R1 | Terminal | Estado do terminal no processo principal em Rust (crates `vte`/`alacritty_terminal`): o parse ANSI acontece uma vez, em Rust; o renderer recebe só as linhas que mudaram, no ritmo do foco | o maior: tira o parse do JavaScript e reduz o tráfego por IPC | alto: renderizador próprio ou alimentação mínima do xterm; e2e e capturas dos terminais |
| R2 | CodeGraph | Parse com tree-sitter nativo em vez de WASM, mais o índice em Rust | indexação 2–5× mais rápida e menos memória nos picos de reindexação | médio: binários por plataforma, o vendor do CodeGraph muda |
| R3 | Busca | Busca de texto e listagem de arquivos com o motor do ripgrep (crates `grep`/`ignore`) | busca em repositórios grandes sem travar o main | baixo |
| R4 | Supervisor de PTY | `portable-pty` em Rust no lugar do `node-pty` | pequeno; vale só se o `node-pty` virar problema de build | médio |

### 3. Trocar o Electron (avaliado em separado)

Ver a análise de Tauri: não na 1.4; prova de conceito de Tauri com o backend Node como processo auxiliar depois da 1.4 estável, com critério de decisão definido antes (pelo menos 30 % de memória a menos e Linux sem regressão).

## Disciplina de desenvolvimento (efeito imediato)

O que travou a máquina hoje se resolve sem código de produto:

- uma trava única da máquina para processo pesado (build, `tsc` completo, testes de Electron, Playwright, Gradle): um por vez, para todas as sessões;
- Gradle sem daemon ou parado depois do uso; emulador desligado fora de uso;
- suítes longas na CI.

## Recomendação

1. Agora: a disciplina acima e o item 1 (renderização econômica por visibilidade) na 1.4, com a meta de CPU na CI.
2. Na 1.5: medir de novo com o painel de Diagnóstico (B8.3) e seguir R1 → R2 → R3 só onde a medição apontar.
