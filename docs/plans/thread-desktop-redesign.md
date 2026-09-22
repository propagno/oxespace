# Thread Desktop: layout, navegação e login por assinatura

Data: 2026-09-17. Status: implementação no working tree; validação automatizada Windows concluída, pilot autenticado e Linux pendentes.

Este documento substitui o contrato visual anterior de thread-ui-spec.md e a exigência de compartilhar o shell de Code em thread-sidebar.md. As capacidades de execução existentes dos provedores continuam sendo um escopo separado. Referência: experiência de conversas do Codex Desktop, adaptada ao OXESpace.

## Implementação e evidências — 2026-09-17

O runtime agora usa ThreadSidebar próprio, catálogo canônico de projetos,
ThreadView com grid de três linhas e NativeAccountService separado da execução.
O protótipo abaixo permanece como referência; as capturas de implementação usam
Electron real com mensagens e contas simuladas, sem revelar dados de contas reais.

| Tarefa | Resultado verificável |
| --- | --- |
| T01 | Reproduzido antes da correção em 900x600: shell/surface cresceram para 27.807 px, composer terminou em y=767,75 e foi cortado. Causa confirmada: linha intrínseca do grid sem limite e ancestrais sem min-height:0 |
| T02 | Codex instalado passou initialize/initialized; ambos os clientes passaram account/read ou auth status --json. Fonte embarcada do Claude 2.1.274 confirma auth login com readline(process.stdin), prompt de código e saída process.exit(0). Pipes são compatíveis com esse comando; OAuth real não foi concluído neste teste |
| T03 | Thread shell usa linha minmax(0,1fr), sidebar próprio 248/224–320 e cabeçalho 48. A regra antiga orca-shell.css de inset que cobria a barra Code foi corrigida. Hosts/terminais Code continuam montados |
| T04 | Catálogo usa MemoryProjectService/git-common-dir com concorrência 4; SQLite+Git real comprova main/worktree convergindo e pane em repositório homônimo separado, com contexto indisponível reportado |
| T05 | Turnos agrupados sem reescrever DB; timeline independente, composer 96 px na altura curta e bottom=592/600. Seguir streaming somente junto ao fim; drafts/scroll por thread e botão Latest messages |
| T06 | Estados/IPC tipados, parsers sanitizados, URLs HTTPS oficiais, cancelamento/timeout, dedupe e callbacks tardios; credenciais ambientais de API/OAuth omitidas nos processos Thread |
| T07 | Contas Claude/Codex com Conectar/Reconectar/Verificar/Cancelar e código temporário; preflight antes de persistir mensagem; login não envia automaticamente; adaptadores idle renovados; reconexão bloqueada durante turno do provedor |
| T08 | Capturas Electron nos temas midnight e one-dark, larguras 900/1280/1440 e zoom Chromium 125/150%; regressão de resize/DOM de três terminais. Pilot real de browser/inferência/resume, Linux e DPI Windows nativo continuam pendentes |

65 testes direcionados passaram: 45 de unidade/componentes/Sidebar Code, 16 de
SQLite/migração/projetos, 2 smokes nativos e 2 cenários Electron E2E.

Testes: unidade/componentes e Sidebar Code, integração SQLite executada sob
Electron ABI e smoke opt-in de protocolos nativos. Typecheck, lint e build/bundle
budgets passam; lint conserva os avisos existentes do projeto. E2E inclui histórico
100 turnos, wheel/Home/End/PageUp, leitura durante streaming, retorno Code/Thread,
rascunho, sidebar longa/busca e modal de contas com login simulado.

Capturas inspecionadas da implementação (fixtures):
[900 px / one-dark](thread-desktop-implemented-900.png),
[1280 px / midnight](thread-desktop-implemented-1280.png),
[painel de contas](thread-desktop-accounts.png).

A confirmação visual vem de capturas da implementação, não apenas do HTML de
preview. A medição do histórico longo confirma shell/surface/view=600 px,
timeline clientHeight=446 px < scrollHeight=18.778 px e composer bottom=592 px.
Zoom Chromium é uma verificação de layout equivalente à escala; não certifica
todos os monitores nem DPI nativo Windows.

**Limite de validação:** os fluxos gerenciados de login/cancelamento são cobertos
por fixtures e os protocolos reais de status passaram. Ainda é necessário que o
usuário conclua o login no navegador para confirmar inferência e retomada com
sua assinatura. A4 e a parte do pilot de T08 não são declarados integralmente
validados enquanto esse teste não for realizado.

## Resultado esperado

Uma área de trabalho para conversas com agentes: navegação própria, histórico legível e rolável, composer sempre acessível e conexão das contas pelo aplicativo. O usuário deve conseguir selecionar Claude ou Codex, entrar no navegador com sua assinatura, voltar ao aplicativo e enviar uma mensagem sem digitar comandos em um terminal de Code.

O artefato visual companion thread-desktop-preview.html representa a direção proposta; usa dados e login simulados, sem conexão com provedores. As medidas e os estados implementáveis estão em thread-desktop-ui-contract.md.

Prévia verificada em Chromium local/headless: capturas em 1280x720 e 900x600; captura de 900 px inspecionada. Com histórico longo, scrollHeight 4192 px > clientHeight 417 px, composer termina em y=592 dentro de viewport 600 px, body permanece com 600 px e wheel altera scrollTop. Isso valida a geometria proposta do protótipo, não corrige nem valida o runtime Electron atual. Capturas: thread-desktop-preview-1280.png e thread-desktop-preview-900.png.

## Evidências e limites do diagnóstico

| Problema | Evidência atual | Implicação |
| --- | --- | --- |
| Visual reaproveitado de Code | App passa threadContent ao componente Sidebar; continuam marca/versão, footer Tools e estilos de navegação Code | Criar ThreadShell e sidebar completo independente; reutilizar apenas componentes pequenos/tokens |
| Projetos repetidos | ThreadSidebar agrupa threads por projectId, mas adiciona um grupo vazio workspace:<id> para cada workspace sem thread | Resolver o catálogo de projetos antes de renderizar; workspaces/worktrees são contextos de um projeto |
| Histórico e composer cortados na imagem | body tem overflow:hidden; app-shell é grid sem minmax(0,1fr) explícito para a linha; workspace-surface não declara min-height:0/overflow; ThreadView tem alertas como siblings do scroller | Hipótese principal: sizing intrínseco dos ancestrais expande a área e o body a corta. Confirmar por medidas no Electron com histórico longo, não declarar uma causa fechada sem reprodução |
| Espaço excessivo | toolbar de modo 42 px + cabeçalho de duas linhas; mensagens margin-bottom:24 px/line-height:1.7; welcome margin:50 px; composer margin-bottom:20 px | Um único cabeçalho; escala menor e consistente; eliminar camadas de status e CSS obsoleto |
| Leitura prejudicada durante streaming | ThreadView chama scrollIntoView em qualquer atualização dos eventos | Autoscroll condicionado à proximidade do fim; posição de leitura preservada |
| Login insuficiente | authFailure fornece claude auth login e Retry; não existe serviço de autenticação para Thread; Codex não tem recuperação equivalente | Serviço nativo de contas, UI de conexão e erros tipados comuns |
| Teste anterior não cobre o bug | E2E usa conversa curta e viewport 800 px de altura | Testar overflow real, alturas curtas, alertas e streaming, além de screenshot |

Evidência local de capacidade: codex-cli 0.154.0, Claude Code 2.1.274. Help confirma claude auth login --claudeai, claude auth status --json e codex login. Schema gerado localmente em diretório temporário confirma account/read, login chatgpt e chatgptDeviceCode. Isso confirma contrato/CLI, não login bem-sucedido nem inferência autenticada.

Fontes oficiais consultadas: [autenticação Codex](https://learn.chatgpt.com/docs/auth), [App Server](https://learn.chatgpt.com/docs/app-server), [autenticação Claude Code](https://code.claude.com/docs/en/authentication), [referência de organização da interface](https://learn.chatgpt.com/docs/features).

## Arquitetura visual e interação

ThreadShell ocupa a região da aplicação com dois elementos: ThreadSidebar e ThreadConversation. O seletor Code/Thread muda para a área de marca/navegação; não permanece uma barra horizontal extra em cima do histórico. Não deixar offsets de 42 px dos hosts Code hardcoded: manter posicionamento Code pelo seu próprio container/layout.

A área central usa grid rows: header auto, body minmax(0,1fr), composer auto. O body tem um único scroll vertical; o composer fica no fluxo, sem position:fixed sobre mensagens. Composer pode crescer até um limite e então tem scroll próprio do textarea. Sidebar tem scroll independente para conversas. No viewport suportado, não há scroll global do body nem corte de conteúdo interativo.

Mensagens de usuário ficam em uma superfície discreta; respostas do agente usam texto sem card em volta. Ferramentas são linhas compactas expansíveis. Agrupar eventos por turno no renderer; armazenar os eventos originais sem reescrever o histórico. Falhas de autenticação recentes viram um aviso compacto perto do composer com Conectar; detalhes de falhas antigas ficam recolhidos no turno, sem repetir grandes mensagens técnicas. Aprovações têm conteúdo rolável e ações alcançáveis. Não colocar um painel de erro de altura ilimitada fora do scroller.

Autoscroll: seguir a saída quando distância até o fim <= 64 px; ao usuário subir, interromper seguimento e mostrar Ir para o fim com contador de novas mensagens. Voltar ao fim reativa seguimento. Preservar scrollTop por thread durante a sessão, incluindo Code/Thread; leitura anterior não é substituída pelo último delta. Expandir ferramentas/imagens de texto/resize não deve forçar o fim. Não usar smooth scroll em cada token. aria-live anuncia estado/resumo, sem reler todo o histórico a cada delta.

Estado vazio propõe iniciar uma conversa com projeto/provedor selecionáveis e estado da conta. Enviar após autenticação só ocorre por ação explícita do usuário. Nova conversa pode ser preparada sem login; não é necessário armazenar threads vazias apenas por abrir a tela.

## Sidebar orientado a conversas

Topo: marca discreta, seletor de modo compacto, Nova conversa e Buscar. Corpo: Fixadas (uma única ocorrência de cada thread) e Projetos com conversas recentes, ordenadas por recência de turno. Projeto sem conversas tem uma linha compacta ou fica no seletor de projeto; não renderizar vários blocos No conversations yet. Menus de projeto oferecem nova conversa e seleção de contexto; não oferecem fechar terminal ou layout de panes.

Linha de conversa usa título, tempo relativo e um indicador de atividade/falha; provedor em ícone/tooltip ou metadado discreto. Diretório/worktree aparece no cabeçalho e tooltip, não como novo projeto quando pertence ao mesmo repositório. Footer: Contas e Configurações. Tools de Code não aparece como ação principal em Thread. Sidebar tem largura/expansão próprias persistidas; Code conserva suas preferências.

Backend deve oferecer catálogo tipado ThreadProjectSummary {projectId, displayName, identityLabel, contexts:[{workspaceId,paneId?,rootPath,label}], threadCount}. Resolver via MemoryProjectService/projectIdentity, que já usa git-common-dir e realpath. Não unir projetos por nome nem por caminho textual heurístico. Pane em outro repositório pertence ao seu projeto real. Consultas Git têm timeout e concorrência limitada; falha de resolução mantém identidade conhecida ou contexto indisponível, sem inventar novo projectId. Não criar terminal, alterar branch ou iniciar inferência para listar projetos.

Separar vínculo workspace de identidade do projeto. Esta entrega pode continuar usando workspaceId/paneId registrados como contextos de criação, sem introduzir um cadastro novo de projetos independentes. Remover um workspace segue a política de persistência existente, explicitada na UI; não prometer retenção independente enquanto a FK ainda é cascade. Planejar essa mudança só se o produto passar a exigir conversas após excluir todos os seus contextos.

## Autenticação por assinatura

Princípio: controlar o login dos clientes oficiais; credenciais ficam sob responsabilidade deles. OXESpace não implementa seu próprio OAuth Claude, não recebe senhas, não extrai tokens para fazer chamadas diretas às APIs e não pede API key no fluxo de assinatura.

Codex: sessão de autenticação App Server dedicada, sem thread/start. Após initialize, account/read; Conectar inicia account/login/start {type:chatgpt}, mantém processo vivo e abre authUrl no navegador padrão pelo main. Escutar account/login/completed e account/updated, confirmar conta efetiva e então liberar envio. Cancelamento por account/login/cancel. Fallback de código de dispositivo só se schema/capacidade instalada permitir e o usuário escolher. Login gerenciado continua pertencendo ao Codex. [Contrato oficial](https://learn.chatgpt.com/docs/app-server).

Claude: iniciar o executável configurado com auth login --claudeai; validar comportamento pipes/PTY na versão instalada em spike antes de escolher transporte. O CLI conduz o navegador e callback. Se requerer código de retorno, encaminhar input apenas para a tentativa ativa do processo nativo; não tratar código como token de inferência, não persistir nem registrar. Fallback para uma área de autenticação nativa interna se o protocolo de saída não permitir extração confiável de prompts; nunca apresentar erro genérico e mandar o usuário sozinho para Code como caminho principal. Após conclusão, consultar auth status --json e confirmar método claude.ai/assinatura. Cancelar encerra somente a árvore do processo de login. Políticas administradas prevalecem. [Autenticação oficial](https://code.claude.com/docs/en/authentication).

Assinatura significa acesso disponibilizado pela conta/plano do provedor; conectado não significa quota disponível. Mostrar plano somente quando reportado pelo cliente. Claude Console/API e credenciais API Codex não são classificados como assinatura. Não prometer elegibilidade baseada só no endereço de email ou presença de arquivo de credenciais. Distinguir autenticação, quota e indisponibilidade da rede.

### Serviço, contratos e ciclo de vida

NativeAccountService no main, separado do ThreadManager. Adaptadores Claude/Codex com check, beginLogin, cancelLogin e eventos sanitizados. AuthScope identifica provedor, executable/profile, diretório/configuração efetivos e home de credenciais, sem depender do threadId. UI pode mostrar duas contas, mas não prometer múltiplos usuários simultâneos do mesmo provedor neste escopo.

Contrato AuthSnapshot: provider, scopeId, state, method, accountLabel?, planLabel?, checkedAt, errorCode?. Estados: checking, missing-cli, signed-out, connecting, awaiting-browser, awaiting-code, connected, expired, unsupported, error. method: subscription/api/other/unknown. signed-out não é fallback para erro de parsing/rede. IDs de tentativa possuem geração; callback tardio de tentativa cancelada é ignorado. Uma tentativa por scope; cliques duplicados não iniciam vários callbacks/listeners.

IPC contas: read(scope), login(scope), cancel(attemptId), submitCode(attemptId,code) quando suportado, onChanged. Sender/mainFrame validado como thread.ipc; caminhos/comandos são resolvidos de IDs registrados, não argumentos arbitrários do renderer. URL de login validada por HTTPS e hosts oficiais esperados na versão; callback local permanece no cliente nativo. Não aceitar URLs externas vindas de mensagens do modelo como login. Strings de saída/erro passam por parser com limites e allowlist; não retornar stderr bruto.

Timeout inicial sugerido: probe 8 s; login 5 min ajustável para SSO, cancelável; tentativas expiram ao fechar aplicativo. Nenhuma tentativa pendente reinicia automaticamente após boot. Rechecar conta ao voltar do browser/foco com debounce e ao usuário clicar Atualizar; não criar subprocesso de status a cada delta. Cache curto por scope, sem bloquear a abertura do histórico.

Unificar resolução do executable/cwd/env entre login, check e inferência. process-transport hoje filtra só OXESPACE_; em modo de assinatura, credenciais de ambiente/API, helpers e configuração alternativa podem mudar o método efetivo. Inventariar precedência documentada por provedor, preparar env isolado para os subprocessos de Thread sem alterar a shell do usuário, e validar o método selecionado. Se política/configuração do cliente impedir assinatura, mostrar conflito com ação de configuração e bloquear esse fluxo; não remover arquivos nem fingir que o login substituiu o método ativo.

Após reconectar, invalidar cache e renovar adaptadores de conversa ociosos do scope para não conservar autenticação antiga em processos Codex já vivos. Turnos ativos não são encerrados silenciosamente. Trocar conta ou desconectar afeta o armazenamento nativo compartilhado com CLI/Code: explicitar isso na ação e impedir troca durante turnos ativos ou solicitar interromper pelo fluxo existente. Não adicionar logout ao escopo inicial se isso atrasar o fluxo de conectar/reconectar.

Pré-envio: checar instalação/método/conexão no mesmo contexto; falha anterior a inferência não cria mensagem de usuário/completed em DB. Manter rascunho e abrir conexão. Autenticação expirada durante um turno é erro tipado recuperável; Conectar e depois Reenviar esta mensagem são duas ações explícitas. Dedupe de solicitações de envio pendentes e reset da reserva busy quando preflight falha. Histórico atual permanece íntegro; não apagar as falhas existentes.

## Tarefas e sequência

| ID | Trabalho concreto / arquivos principais | Dependência | Evidência de conclusão |
| --- | --- | --- | --- |
| T01 | Reproduzir clipping em Electron; medir clientHeight/scrollHeight/bounds de app-shell, workspace-surface, host, view, timeline/composer | — | Fixture longa antes da mudança identifica ancestral que expande; relatório curto no plano |
| T02 | Spike auth Claude pipes/PTY e Codex schemas/conta; usar resolver configurado e contexto efetivo | — | Fixtures do protocolo e capacidade detectada; sem capturar tokens; pilot real registrado separadamente |
| T03 | ThreadShell/Sidebar próprios, CSS dedicado, remover toolbar extra/offsets e CSS Thread obsoleto; src/App.tsx | T01 | Um cabeçalho, scroller e composer em alturas curtas; Code terminal DOM preservado |
| T04 | Catálogo de projetos/contextos em thread.ipc/types/preload e serviço de projeto; atualizar thread.store/ThreadSidebar | T03 | Workspaces/worktrees convergem por identidade; homônimos distintos continuam distintos; falha parcial não duplica |
| T05 | ThreadTimeline/Turn/Composer: agrupamento, falhas compactas, auto-follow, scroll por thread, teclado | T03 | Histórico longo + streaming + usuário lendo + resize + approvals verificáveis |
| T06 | shared/types/agentAuth.ts + NativeAccountService/adaptadores, IPC/preload e lifecycle main | T02 | Login/cancel/status/races/env tratados e processos encerrados; tipos/lint |
| T07 | ProviderAccountsPanel/footer, pré-envio ThreadManager/runtime, erro auth para ambos e renovação de adaptadores idle | T05,T06 | Login retorna ao rascunho, nenhum replay implícito, escopos corretos |
| T08 | Revisão visual, Electron E2E, pilot autenticado Windows e smoke processo Linux; atualizar docs | T04,T07 | Matriz de aceite cumprida; limitações restantes descritas sem marcar entrega integral indevidamente |

Ordem prática: fechar geometria e navegação primeiro; implementar contas sobre transporte validado; finalizar integração e regressões. Cada tarefa deve produzir mudança e evidência revisáveis. A validação de layout não depende de autenticar uma conta real; o pilot final de contas depende da conclusão do login pelo usuário no navegador.

## Critérios de aceite

| ID / pedido | Critério mensurável |
| --- | --- |
| A1 visual | Implementação segue companion visual/contrato: superfícies discretas, título 14 px, texto 14 px/1.5, hierarquia clara; screenshots inspecionadas em tema padrão e no tema da imagem |
| A2 scroll | Fixture 100 turnos; timeline.scrollHeight > clientHeight e wheel/PageUp/Home/End mudam scrollTop; composer e cabeçalho dentro do viewport; body não cresce; sidebar também rola |
| A3 espaços | Cabeçalho único 48 px; margem inferior composer <=12 px; intervalo normal entre mensagens 12–16 px; sem toolbar extra de 42 px nem welcome de 50 px |
| A4 login | Conectar Claude e Codex abre fluxo nativo, confirma método assinatura e permite enviar; cancel/timeout/CLI ausente/expiração/SSO conflitante possuem recuperação; nenhum token em IPC/DB/log/screenshot |
| A5 sidebar | Shell Thread independente; sem footer Tools/panes/grupos vazios duplicados; worktrees de um projeto convergem; nova conversa/busca/fixadas/contas acessíveis |
| A6 referência | Organização parecida com Codex Desktop; não copiar recursos sem backend; review visual obrigatório com 900x600, 1280x720, 1440x900 e escala Windows 125/150% |
| A7 continuidade | Code conserva seleção, terminais, resize e processos; Thread conserva rascunho/scroll/seleção; evento de outra thread não pula conversa nem interrompe leitura |
| A8 autenticação antes de envio | Sem login, nenhum turno/msg é persistido; rascunho intacto; voltar conectado não dispara inferência sozinho; quota não vira falha de login |

Testes de unidade para identidade/agregação, state machine auth, parser Claude, RPC Codex, allowlist de URL, cancelamento, timeout, callbacks tardios, conflitos de método/env, preflight e renovação de adapters. Componentes para estado conectado/desconectado, falha recuperável e teclado. Electron E2E com fixture longa e token streaming controlado para validar bounds/scrollTop e conta simulada. Typecheck/lint/build/bundle budgets, regressão Sidebar Code e retenção DOM de terminais. Pilot real: conectar ambos pelo aplicativo, enviar mensagem curta, reiniciar, continuar a mesma sessão; executado conscientemente, sem modificar login atual durante planejamento.

## Riscos delimitados e decisões

- Parsing de login Claude não é um protocolo UI estável como App Server: transporte e fallback nativos são gate de T02, não um parser improvisado de regex sobre qualquer saída.
- Renderizar todos os eventos/rehidratar catálogo a cada delta pode ficar caro: primeiro atualizar snapshot ativo/metadados afetados com throttling; agrupar por turno. Adicionar virtualização só se fixture máxima mostrar necessidade, com medição e preservação de âncora.
- Preview não prova todas as escalas/temas nem autenticação real: testes de geometria e pilot são evidências diferentes.
- Recursos fora desta entrega: write mode, anexos, modelos/reasoning sem suporte, memória/MCP/delegação e gestão completa de archive/delete. Nada disso deve bloquear melhorias de layout e contas.
- Definição padrão resolvida: inspiração Codex Desktop, temas OXESpace preservados, linguagem visual sóbria, conexão por provedor nativo. Nenhuma pergunta adicional é necessária para iniciar essas tarefas.
