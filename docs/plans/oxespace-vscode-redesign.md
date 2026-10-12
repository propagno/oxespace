# Plano de refatoração visual do OXESpace

**Estado:** implementação visual aplicada em 2026-09-26 · **Data do plano:** 2026-09-25 · **Escopo:** renderer/front-end

## 1. Objetivo e contrato

Redesenhar o OXESpace inteiro como uma releitura do workbench mostrado nas duas imagens do usuário: densidade e hierarquia próximas do VS Code, paleta escura violeta-cinza da referência, navegação compacta, divisórias finas, painel central amplo e superfícies elevadas discretas. A imagem 1 orienta a composição de navegação, conversa e compositor. A imagem 2 orienta o menu de customizações e as páginas de configuração. O produto mantém nomes, marca, fluxos e capacidades próprias do OXESpace.

O trabalho altera apenas apresentação, composição de componentes React, CSS, ícones, microtexto e preferências **locais de interface**. Não cria tabelas, IPCs, serviços, processos, telemetria ou novas capacidades de agente. Cada controle visível deve abrir uma ação existente e verificável. Um controle da referência sem ação correspondente no produto fica fora da interface. Os modos Code e Thread compartilham a mesma linguagem visual e preservam seus modelos de interação.

Este plano substitui, para a futura implementação visual, as medidas e cores dos contratos anteriores em `docs/plans/desktop-ui-contract.md`, `docs/plans/thread-ui-spec.md`, `docs/plans/thread-workbench/UI-SPEC.md` e `docs/NAVIGATION_REDESIGN.md` quando houver conflito. As garantias de comportamento desses documentos continuam sendo critérios de regressão.

## 2. Estado verificado no repositório

| Área | Implementação atual | Implicação para o redesign |
| --- | --- | --- |
| Casca | `src/App.tsx` alterna `applicationView` entre Code e Thread; `src/styles/base.css` define grade sidebar + superfície | Criar chrome de workbench compartilhado no renderer, preservando a árvore montada dos workspaces e da Thread. |
| Navegação | `Sidebar.tsx` e `ThreadSidebar.tsx` já compartilham `NavigationBrand`, `NavigationFooter`, busca, largura e colapso | Refatorar a apresentação comum e manter conteúdo específico de cada modo. |
| Code | `WorkspaceSurface.tsx`, `WorkspaceGrid.tsx`, `WorkspaceSplitGrid.tsx`, panes e painéis laterais | Alterar topbar, divisórias, cabeçalhos e barras de painel sem recriar terminais. |
| Thread | `ThreadGrid.tsx`, `ThreadView.tsx`, `ThreadWorkbench.css`, `ThreadView.css` | Reorganizar cabeçalho, timeline, ações e compositor sem mudar protocolo de mensagens. |
| Configurações | `SettingsCenter.tsx`, `WorkspaceSettingsModal.tsx`, `SettingsModal.tsx`, `ToolsModal.tsx` | Aplicar o menu e a grade editorial da imagem 2 aos destinos existentes. |
| Tema | `tokens.css` oferece 11 temas; `ThemeProvider.tsx` aplica tema por workspace; `workspaceOptions.ts` lista opções e prévias | Repaletar o identificador padrão `midnight` com as cores da referência, sem mudar o valor salvo ou criar identificador novo; preservar os demais temas escolhidos. Atualizar prévias e tokens JS. |
| CSS | `styles.css` importa folhas legadas em `@layer oxe-legacy`; `ui-kit.css` contém primitivas | Migrar por superfície, sem criar uma folha global de overrides que esconda conflitos de cascata. |
| Janela | `electron/main/index.ts` cria `BrowserWindow` com moldura nativa e mínimo 960×640 | O topo inspirado na imagem é uma barra **dentro do aplicativo**. Não desenhar botões de sistema fictícios nem alterar `BrowserWindow`. |

Há mudanças locais não commitadas na Thread e em serviços de conversa. Implementar em fatias pequenas, partindo do estado corrente; não reverter nem sobrepor esse trabalho.

## 3. Direção visual mensurável

Valores abaixo foram amostrados das imagens fornecidas. São pontos de partida para tokens; o ajuste final depende de capturas no Electron e medição de contraste.

| Papel | Valor inicial | Uso |
| --- | --- | --- |
| Canvas/editor | `#21222C` | Região central, conversa, conteúdo das páginas. |
| Sidebar e barra superior | `#282A36` | Navegação e chrome do workbench. |
| Superfície elevada | `#32333C` | Cartões da imagem 2, compositor, menus e popovers. |
| Seleção neutra | `#353846` | Item ativo e campo discreto na imagem 1. |
| Divisória | `#414249` | Bordas de painéis e seções, normalmente 1 px. |
| Texto principal | `#F8F8F2` | Títulos e conteúdo principal. |
| Texto secundário | `#C5C5C5` | Descrições, caminhos e metadados legíveis. |
| Texto discreto | `#A6A6A7` | Placeholder e informação auxiliar, após checagem WCAG. |
| Acento de foco | violeta frio próximo de `#717FB8` | Foco, seleção de comando e vínculo ativo; nunca substituir cor semântica de sucesso/erro. |

**Geometria:** sidebar padrão ~280 px na composição da imagem 1, redimensionável dentro dos limites atuais 240–360 px; rail recolhido de 56 px; barra do workbench de 34–40 px; cabeçalho de conteúdo 40–48 px; linhas de navegação de 28–32 px no compacto e 36–40 px no confortável; ícones de 14–16 px; raios de 4–6 px em campos/linhas, 7–8 px em cartão/compositor. Usar a tipografia atual Inter para UI e mono atual para terminal/código, com pesos e alturas de linha consistentes. O layout deve reter legibilidade no mínimo nativo 960×640 e em zoom de 125%/150%.

**Composição:** superfícies planas e divisões claras. O painel central não recebe uma moldura arredondada gigante como na captura se isso sacrificar espaço útil; a releitura mantém a hierarquia da referência com 1 px de separação. O verde atual continua apenas em estados semânticos de sucesso e diff adicionado, não como cor estrutural da interface. Ícones e badges usam cor com parcimônia.

**Tokens:** criar papéis semânticos (`--wb-canvas`, `--wb-sidebar`, `--wb-chrome`, `--wb-raised`, `--wb-selection`, `--wb-border`, `--wb-focus`) e mapear os tokens legados (`--bg-app`, `--bg-sidebar`, `--pane-surface`, `--bd-base`, `--accent` etc.) ao novo tema. Evitar hex locais em componentes. Atualizar `src/design-system/tokens.ts`, `DesignSystemPage` e as prévias de tema da configuração. Primitivas compartilhadas: `WorkbenchHeader`, `NavigationSection`, `NavRow`, `ToolbarButton`, `SurfaceCard`, `SectionHeading`, `SearchField`, `StatusChip`, `ActionMenu`, `EmptyState`, `WorkbenchDialog` e foco visível.

## 4. Arquitetura de interface alvo

```text
Janela nativa Electron
└─ OXESpace workbench (renderer)
   ├─ barra compacta: marca/contexto + troca Code/Thread + ações reais
   ├─ navegação compartilhada
   │  ├─ ações e filtro do modo atual
   │  ├─ seções Code (workspaces/terminais) ou Thread (projetos/conversas)
   │  └─ entradas existentes: ferramentas, contas/configurações, recolher
   └─ superfície de trabalho
      ├─ Code: contexto do workspace + grid de panes + painéis existentes + status
      └─ Thread: contexto da conversa + timeline + compositor + painel auxiliar
```

A troca Code/Thread deve estar sempre descoberta no topo da navegação expandida e acessível no rail recolhido. Nenhum segundo seletor compete com ela. O contexto central mostra workspace ou conversa atual; somente ações reais aparecem. O menu lateral tem grupos claros e itens compactos, como na imagem 1. Páginas de configuração usam título, descrição, conteúdo em largura de leitura e cartões contidos, como na imagem 2.

### Inventário funcional do menu

| Entrada proposta | Ação que já existe | Regra de exibição |
| --- | --- | --- |
| Code / Thread | `setApplicationView` e retorno ao estado montado | Sempre; mantém seleção, draft e terminais. |
| Novo workspace / Nova thread | Fluxos atuais de criação | Texto e atalho somente se o atalho estiver implementado; no rail, ícone com tooltip. |
| Buscar/filtrar | Filtro local do modo e busca global existente no Code | Rótulos distinguem filtro da sidebar e busca global. |
| Workspaces / Terminais | Grupos e panes reais da sidebar Code | Seleção ativa pane existente. |
| Projetos / Conversas | Grupos e sessões reais da sidebar Thread | Indicadores running/approval/error usam estado real. |
| Ferramentas | `ToolsModal` e integrações existentes | Não listar catálogo de ferramentas como se todas tivessem ação no menu. |
| Contas | Painel existente de contas Thread, quando aplicável | Se acesso direto não existir no contexto Code, usar apenas destino já navegável. |
| Configurações | `SettingsCenter` | Escopos Aplicação/Workspace continuam explícitos. |
| Recolher/expandir | `useUIStore`/`useNavigationPrefs` | Conserva largura e preferência. |

Não adicionar Automations, Back/Forward, Run, extensões, Marketplace, notificações, atualização, MCP Servers, Plugins, Skills, Hooks ou Agents por semelhança com a captura. Um desses destinos só pode aparecer quando já houver página/ação correspondente no frontend atual e o ponto de entrada for testado. O menu da imagem 2 inspira **a forma** das páginas de customização; conteúdo é derivado do OXESpace real.

## 5. Frentes de implementação

### A. Fundação e design system

1. Fazer inventário de cores literais, dimensões, botões e estados visuais nas superfícies prioritárias; identificar estilos duplicados e conflitos de especificidade.
2. Repaletar o tema padrão `midnight` com a referência em `tokens.css`, suas prévias em `WorkspaceSettingsModal.tsx` e o nome mostrado em `workspaceOptions.ts` se necessário. Conservar o ID `midnight`, o tipo `WorkspaceThemeId`, o default e os valores já salvos; os demais temas continuam selecionáveis. Para quem já usa `midnight`, a mudança de aparência é intencional e faz parte deste redesign.
3. Definir tokens de geometria, tipografia, estados e motion. Estabelecer contratos de hover, seleção, foco, desabilitado, loading, erro, sucesso e drag/resize.
4. Extrair as primitivas compartilhadas e exemplos no viewer do design system; substituir CSS local de cada superfície à medida que for migrada. Auditar regras legadas que ganham por cascata.

**Entrega:** tema selecionável e documentado, primitivas demonstradas, nenhuma string de cor de referência espalhada nos componentes migrados.

### B. Casca e menu

1. Adicionar barra compacta no renderer, com marca OXESpace, contexto atual e troca de modo; posicionar sem duplicar o título da janela nativa.
2. Consolidar o chrome de `Sidebar` e `ThreadSidebar`: cabeçalho, ação de criar, filtro, seções, rodapé, rail e divisor de resize. Manter árvores de dados específicas.
3. Aplicar a densidade da imagem 1: alinhamento de ícones, indentação de filhos, seleção neutra, contadores discretos e estados vazios úteis.
4. Substituir ícones de ação sem rótulo por tooltip e nome acessível; menu contextual para ações secundárias existentes (abrir lado a lado, remover, fechar etc.).
5. Rever `SettingsCenter`, `ToolsModal` e modais principais como superfícies do mesmo workbench. Em Configurações, usar navegação lateral e páginas com largura de leitura, cabeçalho, descrição e grade de cartões onde houver destinos reais.

**Entrega:** navegação comum em Code/Thread, menu de configurações inspirado na imagem 2, todas as entradas com ação comprovada.

### C. Modo Code

1. Reestilizar `WorkspaceSurface` e topbar como contexto de arquivo/workspace: nome, caminho ou branch quando disponível, status real e ações existentes.
2. Reestilizar `WorkspaceGrid`, `WorkspaceSplitGrid`, `PaneContainer` e `TerminalPane`: cabeçalhos compactos, bordas de 1 px, pane ativo claro sem brilho forte, toolbar reduzida a controles reais.
3. Unificar a apresentação dos painéis Editor, Review, GitHub, Search, Scripts, Preview, Integration, Background e Worktree com títulos, close, loading/empty/error e resize consistentes. Painéis continuam carregados sob demanda.
4. Ajustar o terminal xterm ao novo tema de superfície e seleção; garantir contraste de cursor, ANSI e texto sem manipular sessão/processo.
5. Reequilibrar status bar: workspace, branch, pane e sessões em segundo plano mantêm seu significado. Evitar repetir metadados no topo e no rodapé.

**Entrega:** Code visualmente coeso em 1/2/4 panes, maximização, painéis laterais e workspace vazio, sem remontar o DOM de terminais.

### D. Modo Thread

1. Harmonizar `ThreadSidebar`, `ThreadGrid` e `ThreadView` com o mesmo chrome do Code; projetos e conversas preservam filtro, pin, seleção, status e ações existentes.
2. Reorganizar cabeçalho da conversa em faixa compacta: título, contexto, branch e ações reais; overflow abriga ações secundárias sem esconder ação bloqueadora.
3. Ajustar a largura de leitura da timeline, espaçamento entre turnos e tratamento visual de usuário/assistente; preservar virtualização, streaming, scroll ancorado e evidência de arquivos.
4. Dar ao compositor a geometria da imagem 1: caixa elevada discreta, campo expansível, ações em duas linhas quando necessário, controles de modelo/acesso reais e estado de envio/Stop/fila legível.
5. Aplicar os tokens às atividades de ferramenta, aprovação, pergunta, falha, plano, mudanças e review auxiliar. Não transformar saída técnica em cartão grande sem necessidade; manter origem e estado verificáveis.
6. Tratar larguras pequenas pelo espaço disponível da célula: painel auxiliar vira drawer quando necessário; composer e ações refluem sem reduzir texto crítico.

**Entrega:** Thread nova, em execução, concluída, com erro, com aprovação e com painel de mudanças mantêm a mesma identidade visual e todas as ações atuais.

### E. Configurações, ferramentas e superfícies periféricas

1. Aplicar a composição da imagem 2 ao `SettingsCenter`: nav compacta, título/descrição, largura central limitada, cartões 2–3 colunas apenas onde o conteúdo existente faz sentido.
2. Ajustar formulários de workspace, temas, densidade, terminal, agentes, voz, notificações, atualizações e diagnóstico sem alterar as regras de salvar/cancelar.
3. Harmonizar modais de criação, contas, ferramentas, delegação e diálogos da Thread com a mesma escala de superfície/foco.
4. Revisar viewer do design system e capturas de documentação para refletir a linguagem final.

**Entrega:** nenhuma página periférica parece pertencer a outro tema; estados de confirmação e erro continuam explícitos.

## 6. Sequência de execução e gates

| Fase | Dependências | Resultado revisável | Gate para avançar |
| --- | --- | --- | --- |
| 0. Baseline | Nenhuma | Capturas Code/Thread/Settings no Electron em 960, 1280 e 1600 px; inventário de controles e mapa CSS | Fluxos atuais e mudanças locais identificados. |
| 1. Tokens e primitivas | 0 | Paleta de referência aplicada ao tema padrão no viewer e nos componentes base | Contraste medido; outros temas ainda selecionáveis; typecheck. |
| 2. Casca/menu | 1 | Barra, sidebar Code/Thread, rail e Settings nav | Troca de modo, resize, filtro e foco preservados; sem controle inerte. |
| 3. Code | 2 | Workspace, panes, status e painéis com novo visual | Terminal não remonta ao trocar modo/abrir painel/maximizar. |
| 4. Thread | 2 | Timeline, compositor e review com novo visual | Draft, envio, streaming, aprovação e scroll preservados. |
| 5. Periféricos | 3–4 | Configurações, Tools e diálogos revisados | Save guard, retorno de foco e ações principais preservados. |
| 6. Auditoria final | 5 | Capturas comparativas, checklist de ações e documentação | Critérios da seção 7 atendidos. |

Cada fase vira uma alteração pequena e revisável; não fazer substituição global de CSS antes de comparar Code e Thread lado a lado. O plano é de frontend: qualquer proposta que dependa de um endpoint, IPC, migração de dados ou nova integração sai do lote e não ganha botão visual.

## 7. Critérios de aceite e verificação

1. **Fidelidade visual:** nas capturas a 1280×820 e 1600×900, canvas/sidebar/cartões correspondem à paleta amostrada; menu, alinhamento, densidade e área central remetem claramente às referências, mantendo marca e fluxos OXESpace. A 960×640 e zoom 150%, nada essencial fica cortado ou sobreposto.
2. **Consistência:** Code, Thread, Settings, Tools e diálogos usam os mesmos tokens de superfície, borda, tipografia, foco e estado. Nenhum verde estrutural residual no tema workbench. Temas legados continuam válidos.
3. **Funcionalidade:** inventário de cada botão/menu com destino, condição de disponibilidade e resultado; nenhuma ação vazia, atalho anunciado sem handler, item desabilitado sem explicação ou métrica inventada.
4. **Regressão Code:** seleção de pane existente não abre novo terminal; troca de modo, split, maximize e painel lateral mantêm sessão, scrollback e foco. Testar `Sidebar.test.tsx`, `navigation-redesign.spec.ts` e fluxos de panes existentes.
5. **Regressão Thread:** draft por conversa, envio imediato, falha com recuperação, streaming, follow-up, approvals, histórico virtualizado, mudanças e painel auxiliar permanecem corretos. Testar `thread-view.test.tsx`, `thread-view.spec.ts` e testes dos componentes alterados.
6. **Configurações:** busca, troca de escopo, confirmação de mudanças não salvas, salvar/descartar, fechamento e retorno de foco funcionam. Testar `SettingsCenter.test.tsx` e captura de páginas.
7. **Acessibilidade:** navegação por teclado, `aria-current`/`aria-pressed`, tooltips, foco visível, contraste WCAG AA para texto comum, estados sem depender apenas de cor; `prefers-reduced-motion` respeitado.
8. **Qualidade:** `npm run typecheck`, `npm run lint`, testes focados, `npm run build`; capturas `shots:ui`/`shots:settings` ou script de comparação equivalente. Não ampliar testes sem risco concreto.

## 8. Riscos e decisões que evitam retrabalho

- **Tema por workspace:** manter os IDs e não regravar `themeId` persistido. A casca pode refletir o workspace ativo; sem workspace, usa a nova paleta de `midnight`. Verificar transição Code↔Thread quando a Thread aponta para outro workspace.
- **Terminal e Thread montados:** `App.tsx` e `WorkspaceSurface.tsx` mantêm instâncias vivas para não perder sessões. Refatorar wrappers e classes sem alterar keys/condições de montagem.
- **CSS em camadas:** estilos legados, CSS das Threads e primitivas UI coexistem. Consolidar tokens e remover regra substituída na mesma fatia; auditar especificidade com captura real.
- **Largura variável:** grid de panes, sidebar e painel auxiliar disputam espaço. Basear o comportamento na largura útil da superfície, não apenas no viewport.
- **Sem backend:** status, contagens, branch, conta, modelo e ferramentas vêm somente dos estados já disponíveis. Se a informação não estiver disponível, mostrar ausência honesta ou omitir.
- **Janela nativa:** barra superior do mockup é inspiração de layout. Implementação prevista é no renderer; não incluir controles de minimizar/maximizar/fechar ou botões de navegação histórica sem suporte real.

## 9. Ordem recomendada de arquivos

`src/styles/tokens.css` → `src/design-system/tokens.ts`/tema/prévias → `src/components/Navigation/*` e `src/App.tsx` → `src/components/Sidebar/*`/`src/components/Threads/ThreadSidebar.tsx` → `src/components/Workspace/WorkspaceSurface.tsx`/`src/components/Grid/*`/`src/components/Panes/*` → `src/components/Threads/ThreadView*`/`ThreadWorkbench.css` → `src/components/Settings/*`/modais → viewer/documentação/capturas.

**Definition of done:** o novo tema e a composição são utilizáveis de ponta a ponta em Code e Thread; o menu reúne somente destinos funcionais; as capturas mostram a paleta e a hierarquia das referências; os gates de comportamento e acessibilidade passam sem mudança de backend.

## 10. Registro da implementação e verificação

O redesign aprovado foi aplicado ao tema padrão `midnight`, cujo identificador persistido foi mantido e cujo nome exibido passou a ser **Workbench**. Os novos papéis `--wb-*` centralizam canvas, sidebar, chrome, superfície elevada, seleção, borda e foco. O cabeçalho do aplicativo usa o contexto real de Code ou Thread; a sidebar compartilhada parte de 280 px e preserva o redimensionamento e o rail. Os painéis do Code, a leitura e o compositor da Thread, o menu de ferramentas, a prévia de tema e as Configurações seguem a mesma paleta. A página Geral de Configurações usa a grade da imagem 2 com seis cartões que abrem páginas existentes. Nenhuma ação, IPC ou serviço foi criado para preencher o layout.

**Evidência:** `npm run typecheck` e `npm run build` passaram; `npm run lint` terminou sem erros (35 avisos já presentes); 39 testes focados passaram. Os testes Electron `navigation-redesign.spec.ts` e `thread-view.spec.ts` passaram juntos (2/2), assim como `npm run shots:ui`. As capturas atuais em `e2e/screenshots/` cobrem menu, Code, Tools, GitHub, Settings e outras superfícies; `test-results/thread-1440.png` mostra a largura de leitura e o compositor. Na paleta principal, o texto discreto `#A6A6A7` sobre o canvas tem contraste calculado de 6,49:1; sobre o cartão, 5,16:1.

**Limite da validação:** as capturas e os testes automatizados exercitam estados representativos, não todas as combinações de agentes, painéis e tamanhos. Os outros temas permanecem disponíveis; a releitura das referências foi concentrada no tema padrão. Não foi feita uma troca global dos estilos locais antigos dos painéis, pois isso mudaria estados semânticos e temas secundários sem evidência visual suficiente.
