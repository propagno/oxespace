# Roadmap FRONTEND 1.4.0

Padrão de cada item e DoD comum: ver [README](README.md).


Dono de `src/**`, `shared/locales/**`, `e2e/visual/**`, `docs/design/**` e `mobile/design-export/` (exportação dos tokens).

### F1 · Design system 2.0: estados completos e catálogo vivo (G)
- **Objetivo:** todo estado da interface vem de uma primitiva, para o app parecer um produto só.
- **Escopo:**
  - novos `SuccessState` e `OfflineState`, além de `useConnectivity` (online/offline vindo do main);
  - rótulos padrão das primitivas traduzidos;
  - zerar os vazios e alertas feitos à mão (catraca vai a 0);
  - seções Motion, Success e Offline no visualizador.
- **Fora:** redesenho de telas.
- **Contratos:**
  - **C1:** `app:connectivity` (push do BE, item B8);
  - **C4:** tokens.
- **Aceite:** catracas `-empty` = 0 e `role="alert"` solto = 0. Os 6 estados aparecem no visualizador nos dois modos e nos dois idiomas.
- **Testes:** unidade das primitivas; visual de cada estado; e2e desligando a rede.
- **Riscos:** migração extensa → um PR por área (Code, Thread, OxeQuery, OxePod, OxePost, Settings).

### F2 · Identidade visual em todos os pontos de contato (M)
- **Objetivo:** a marca Mandacaru aparece de forma consistente.
- **Escopo:**
  - cores do `OxeLogo` em token;
  - splash de boot em `index.html` (marca + fundo do modo, sem esperar o React);
  - favicon;
  - ícones PNG em 16–1024 gerados do SVG;
  - marca no ErrorBoundary, no ErrorState de página inteira, nas notificações nativas (ícone vindo do BE) e nos diálogos de crash;
  - diálogo About real (versão, canal, licenças, links);
  - banner da documentação.
- **Fora:** novo logo.
- **Contratos:**
  - **C1:** `app.about` (BE B8) e `icon` nas notificações (BE B8).
- **Aceite:** lista de pontos de contato em `docs/design/brand.md`, todos marcados e com captura.
- **Testes:** visual do splash, do About e do erro; teste que proíbe hex no `OxeLogo`.
- **Riscos:** o splash atrasar a primeira pintura → orçamento de boot fica no gate de perf (< 1,5 s).

### F3 · Motion com assinatura OXESpace (M)
- **Objetivo:** movimento próprio, especificado e acessível.
- **Escopo:**
  - `docs/design/motion.md` com duração, easing e coreografia de entrada/saída para painel, lista, diálogo, toast e troca de modo;
  - loader de marca (o mandacaru "brotando", em SVG/CSS) usado no splash, nos carregamentos longos e no OfflineState;
  - microinterações (aprovação, envio e cópia);
  - eliminar os cerca de 20 keyframes avulsos (catraca a ≤ 3: spin, shimmer e marca);
  - Reduced troca movimento por opacidade.
- **Fora:** animações em Monaco e xterm.
- **Contratos:** **C4** (tokens de motion também vão para o Android).
- **Aceite:**
  - nenhuma duração fixa;
  - com Reduced, nenhuma animação acima de 0 ms, exceto spin lento;
  - spec com tabela de tokens.
- **Testes:** lint de keyframes; visual com animações congeladas; e2e alternando `data-motion`.
- **Riscos:** custo de GPU → animar só transform e opacity, verificado no `bench:ui`.

### F4 · WCAG 2.2 AA (G)
- **Objetivo:** acessibilidade verificável, não só declarada.
- **Escopo:**
  - axe com `wcag22aa` em Linux e Windows;
  - checagens de 2.5.8 (alvo ≥ 24 px, via lint mais e2e), 2.4.11 (foco não encoberto), 2.5.7 (alternativa ao arrastar no Splitter e na reordenação) e 3.3.7/3.3.8 (sem redigitar, login acessível);
  - roteiro NVDA/Orca executado e registrado;
  - suporte a `prefers-contrast: more`.
- **Fora:** WCAG AAA.
- **Contratos:** nenhum.
- **Aceite:** zero achado crítico ou grave em 2.2 AA; tabela do roteiro preenchida com data e versão.
- **Testes:** axe na CI; e2e de alvo e foco; teste manual registrado.
- **Riscos:** falsos positivos no xterm e no Monaco → exclusões documentadas.

### F5 · Responsividade e escala (M)
- **Objetivo:** layouts corretos de 960×640 a 4K, em 90–125%.
- **Escopo:**
  - tokens de breakpoint e container (`--bp-*`) e lint que proíbe `max-width` avulso;
  - container queries nos painéis;
  - matriz de captura 960×640 ×125% e 1920×1080 ×100%.
- **Fora:** tablet e touch no desktop.
- **Aceite:** nenhum corte nem rolagem horizontal na matriz.
- **Testes:** visual da matriz.
- **Riscos:** explosão de baselines → matriz só nas 6 telas âncora.

### F6 · i18n completo (M)
- **Objetivo:** nenhum texto em inglês no pt-BR.
- **Escopo:**
  - telas restantes de Code (ProviderSessionFinder, dicas do WorkspaceSplitGrid, FirstRunChecklist e as que faltarem fora da lista MIGRATED);
  - `src/ui`;
  - renderização dos códigos de erro e de quarentena vindos do BE (**C3**).
- **Fora:** outros idiomas.
- **Contratos:** **C3** (códigos de mensagem do main).
- **Aceite:** a lista MIGRATED cobre `src/**` inteiro; captura pt-BR das telas âncora.
- **Testes:** `ui-copy`, `i18n-catalog` e e2e em pt-BR.
- **Riscos:** chaves órfãs → o teste de catálogo já barra.

### F7 · Performance percebida (M)
- **Objetivo:** equivalente aos Core Web Vitals no Electron.
- **Escopo:**
  - marcas de long task e de latência de input (INP) no renderer, publicadas em `runtime-diagnostics` (**C1**, BE B8);
  - cenários novos no `bench:ui`: abrir OxePost, OxePod e Settings;
  - orçamentos de INP p95 < 200 ms e TBT de boot < 300 ms.
- **Fora:** telemetria remota (X4).
- **Aceite:** gates verdes com `OXESPACE_PERF_GATE=1`.
- **Testes:** benchmark na CI.
- **Riscos:** ruído no runner → p95 de 10 execuções.

### F8 · Regressão visual como gate de lote (M)
- **Objetivo:** visual validado sem travar cada PR.
- **Escopo:**
  - job `visual` no CI da `main` (pós-merge, Linux e Windows) que abre issue automática se houver diferença;
  - baselines em pt-BR, Comfortable e forced-colors para as telas âncora;
  - script de revisão lado a lado.
- **Fora:** visual por PR (decisão anterior sua).
- **Aceite:** o job falha numa diferença plantada; o lote de baselines é revisado pelo coordenador.
- **Testes:** o próprio job.

### F9 · Telas do produto que faltam no 1.4 (G, um PR por tela)
- **Itens:** V16 (Abrir em…), V17 (painel de detalhes), V18 (modos de transcrição), interfaces de Q2/Q3/Q4/Q5/Q6/Q7, H4–H9, P4/P7, A5 (comentar o diff), A4 (UI) e a página "Dispositivos" do mobile (M7).
- **Fora:** os itens marcados "Decisão sua" no roadmap continuam esperando a sua decisão.
- **Contratos:** cada tela consome um contrato do BE já mergeado (regra C0).
- **Riscos:** depender do BE → stubs `e2e/mock-ipc.ts` a partir do contrato, nunca da implementação.

### F10 · Settings › Ferramentas (M)
- **Objetivo:** a pessoa vê e controla quais ferramentas do OXESpace cada sessão tem e quanto custam.
- **Escopo:** página em Settings com os grupos (core, dados, documentação, app, orquestração, OxePost, OxePod), o que cada um faz, se está sempre ligado, sob demanda ou desligado por projeto (`thread.tools` no oxe.yaml), e o custo fixo medido pelo T8; atalho para ligar um grupo no projeto.
- **Fora:** editar a política da organização (só leitura aqui).
- **Contratos:** consome o que o B7.2 expuser (lista de grupos e custos); até lá, mock do contrato.
- **Aceite:** a página reflete o oxe.yaml do projeto e o modo de cada grupo; textos em en e pt-BR; offer-audit verde.
- **Testes:** unidade; e2e ligando um grupo no projeto.
- **Riscos:** números de custo desatualizados → vêm do mesmo cálculo do teste T8, não de valor fixo.

### F11 · Ajuda › Diagnóstico (M)
- **Objetivo:** a pessoa entende a saúde do app e entrega os problemas para análise em um clique.
- **Escopo:** cartões no visual Mandacaru (CPU, memória, disco, banco, processos e agentes, rede e celular), cada um com alerta em linguagem simples e a ação sugerida; linha do tempo do diário de problemas com filtro por área; "Copiar informações", "Exportar pacote" (com prévia do conteúdo) e "Pedir análise", que abre uma conversa no OxeChat com o resumo do pacote anexado.
- **Fora:** gráficos históricos longos; telemetria.
- **Contratos:** consome o B8.3; até lá, mock do contrato.
- **Aceite:** o painel só mede enquanto aberto; en e pt-BR; offer-audit verde; e2e exportando o pacote e abrindo a análise.
- **Testes:** unidade; e2e; visual no lote.
- **Riscos:** alerta alarmista → limites e textos revisados com o BACKEND; cada alerta diz o que fazer.

### F12 · OxeCode e OxeChat (M)
- **Objetivo:** os cinco modos com a mesma família de nomes: OxeCode, OxeChat, OxeQuery, OxePod, OxePost (decisão do usuário, 30/10/2026).
- **Escopo:** nomes visíveis: seletor de modos, menus e paleta, títulos, Settings, onboarding, atalhos (rótulos), notificações e diálogos (textos do main pelos códigos C3, com o BACKEND), documentação, README e roadmaps. No OxeChat, cada item é uma "conversa" (pt-BR) / "conversation" (en).
- **Fora:** identificadores internos: canais IPC (`thread:*`), ferramentas MCP (`oxespace_thread_*`), banco, nomes de arquivos e de componentes. Mudar esses quebraria contratos e agentes sem ganho visível.
- **Contratos:** C3 para os textos do main; nenhum canal muda.
- **Aceite:** nenhuma ocorrência visível de "Code" ou "Thread" como nome de modo em en e pt-BR (teste de catálogo); e2e e helpers (`openView`) usando os nomes novos; offer-audit verde.
- **Testes:** catálogo; e2e de troca de modo nos dois idiomas; visual no lote.
- **Riscos:** e2e quebrarem em massa → trocar os nomes nos helpers primeiro e num PR só.

### F13 · Seções na lista do OxeChat (P)
- **Objetivo:** organizar muitas conversas sem perder as importantes.
- **Escopo:** criar, renomear e apagar seções; arrastar conversas para dentro; alternativa por teclado e menu (WCAG 2.5.7); conversas aninhadas (A15) acompanham a principal.
- **Aceite:** seções persistem; arrastar e o menu fazem a mesma coisa; en e pt-BR.

### F14 · Painel da sessão (V17) (M)
- **Objetivo:** ver numa barra lateral tudo sobre a conversa.
- **Escopo:** ambiente (projeto, worktree, branch), contexto detalhado (mensagens, ferramentas, MCP, sistema, skills, livre) com botão de compactar (T5), ferramentas e servidores MCP ligados (F10), saídas (arquivos mudados, previews), trabalho em segundo plano; seções reordenáveis.
- **Aceite:** os números de contexto batem com os eventos de uso; en e pt-BR; offer-audit verde.

### F15 · Chat lateral, conversas aninhadas e coordenadora (M)
- **Objetivo:** as telas de B1.2, B1.3 e B1.4.
- **Escopo:** gaveta do chat lateral com atalho (Ctrl+.) e custo visível; árvore de conversas filhas com status, abrir e levar para a grade; marcar uma conversa como coordenadora (fixada no topo do projeto) com a visão geral das conversas e de quem espera decisão.
- **Aceite:** e2e de cada fluxo pelo mock; en e pt-BR.

### F10 (extensão) · Aprovação por ferramenta
- Em cada grupo e servidor MCP, cada ferramenta com permitir / pedir aprovação / bloquear (B7.3).

