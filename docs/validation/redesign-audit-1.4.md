# Auditoria de redesign 1.4

Pedido do usuário, pela visão de produto: quais páginas, modais, feedbacks, modais de permissão e itens de menu
precisam de redesign. A auditoria roda sobre a `main` atual, num perfil de teste (banco temporário, mocks de e2e),
em pt-BR e en, claro e escuro. O app é testado de fora, como uma pessoa exigente que não conhece o código.

Cada achado traz:
- a tela ou o componente;
- a gravidade: **bloqueia** (impede o uso ou engana a pessoa), **atrapalha** (confunde, dá trabalho ou fica
  inconsistente) ou **cosmético**;
- a evidência: o print em `e2e/screenshots/homologation/<pasta>/` ou os passos;
- um critério de aceite sugerido.

As funcionalidades avançadas que faltam ficam numa seção à parte, como propostas de roadmap, e não como defeitos.

Fases:
1. Modais de permissão (prioridade).
2. Menus, paleta e feedbacks.
3. Páginas e modais por modo.

Roteiros: `e2e/homologation/audit-*.spec.ts`, no PR de homologação (#184).

## Fase 1 · Modais de permissão

Método (caixa-preta):
- o app real, sem os mocks, num perfil temporário, com um repositório Git novo como workspace;
- o teste age como um agente: chama o MCP interno com a porta e o token que o app entrega aos agentes;
- o aprovador nativo é aberto na tela de verdade com pedidos montados como `agent-gateway.ts`/`agent-actions.ts`
  montam e fotografado pelo sistema.

Roteiros no #184: `audit-permissions-real.spec.ts`, `audit-native-dialogs.spec.ts` e `probe-huge-dialog.spec.ts`. As
capturas de tela inteira ficam só locais, porque mostram a área de trabalho de quem roda.

| # | Tela / componente | Gravidade | Problema | Evidência | Critério de aceite |
|---|---|---|---|---|---|
| P1-0 | Todo pedido de permissão (aprovador de ações MCP `confirm`, OxeQuery, automação de preview) | **bloqueia** | Relatado pelo usuário: no **Ubuntu**, a permissão também abre num modal nativo do sistema operacional (GTK). O app entrega a decisão mais sensível a um diálogo do sistema, fora da marca, sem hierarquia e com os limites de texto de cada plataforma (P1-1 a P1-5). Afeta Windows e Linux. | Relato do usuário (Ubuntu); capturas do Windows nesta fase | Nenhum pedido de aprovação abre `dialog.showMessageBox` com a janela do app aberta, garantido por teste. A aprovação é um modal do app (Mandacaru) em Windows e Linux, com o nativo só como reserva sem janela. Captura em Windows e Linux. |
| P1-1 | Aprovador nativo (OxeQuery `db_execute`, ações MCP `confirm`) | **bloqueia** | Um `detail` longo não é exibido pelo Windows. Com 2 mil caracteres, o diálogo mostra só o título, a mensagem e os botões, e a pessoa aprova sem ver o comando. O `db_execute` aceita SQL de até 100 mil caracteres. O diálogo continua aberto, esperando resposta. | Print do usuário (título "t", mensagem "m", sem detalhe); `probe-huge-dialog`: com 2k, 20k e 100k o diálogo fica aberto até o abort | O texto a aprovar aparece inteiro, rolável e copiável, em qualquer tamanho até o limite da ferramenta. Pedido grande demais para mostrar é recusado, e nunca exibido sem o texto. Teste com 100 mil caracteres. |
| P1-2 | Aprovador nativo | **bloqueia** | O texto do agente se mistura aos avisos do app. Linhas "• Verificado pelo OXESpace: nenhuma alteração" vindas do SQL aparecem iguais ao aviso real "• Changes data on a shared database", logo acima, e um `DROP TABLE` fica atrás de "-- leitura apenas, seguro". | `audit-permissions/native-oxequery-write.png` (local) | Os avisos do OXESpace e o texto do agente ficam em áreas visualmente distintas. O texto do agente vai num bloco monoespaçado rotulado "Texto enviado pelo agente". Um teste com bullets falsos no texto prova que eles não se confundem com os avisos. |
| P1-3 | Aprovador nativo | **bloqueia** | Um agente pode se passar pelo app. O resumo é "`<actor.label>` wants to …", e o agente controla o nome do painel que abre (`oxespace_agents_change start` com `name`). Um painel chamado "OXESpace" produz "OXESpace wants to start a trusted server". | `audit-permissions/native-agent-action-impersonation.png` (local); schema de `oxespace_agents_change` | O rótulo do solicitante vem só do que o app atribui (provedor e número do painel), nunca de um nome escolhido pelo agente. Nomes reservados ("OXESpace", "Sistema", "OxeQuery"…) são recusados como nome de painel. |
| P1-4 | Aprovador nativo | atrapalha | O idioma vem misturado: título ("OxeQuery — request from an agent", "OXESpace — request from an agent"), resumo ("… wants to change data") e o botão de sessão ("Allow reads on this connection for this run") ficam fixos em inglês, enquanto Negar e Permitir uma vez saem em pt-BR. | `native-oxequery-write.png`, `native-oxequery-read-session.png` (local); `agent-gateway.ts:167-168`, `agent-actions.ts:66-67` | Todo texto do aprovador vem por código C3, em en e pt-BR. Um teste de catálogo cobre título, resumo, alvo e botões. |
| P1-5 | Aprovador nativo | atrapalha | O diálogo do sistema não tem a marca nem a hierarquia do app: o ícone de alerta é genérico, não há destaque de risco, produção não é distinguida de desenvolvimento, e o alvo ("shop-db · postgres · development") é uma linha cinza. Ele também não pode ser testado nem capturado pelo e2e. | mesmas capturas | Um modal de aprovação no app (Mandacaru), com cabeçalho de risco (leitura/escrita/ação), ambiente em destaque (produção em vermelho), quem pede, o alvo e o texto. Negar é o padrão e há atalhos de teclado. O e2e e o leitor de tela cobrem o modal. O nativo fica só como reserva quando a janela não existe. |
| P1-6 | MCP interno, chamadas sem execução | positivo | Toda ação de escrita feita por um cliente MCP genérico, sem token de execução, é recusada com `no-execution` antes de qualquer diálogo: skill, automação, tarefa, checkout, push e notificação. | `audit-permissions/real-*.json` | Manter. A mensagem ao agente vem em inglês, o que é aceitável por ser texto para o agente. |
| P1-7 | Notificação nativa pedida pelo agente (`oxespace_workspace_change notify`) | atrapalha (risco) | A notificação é de nível escrita, sem aprovação, e título e texto são livres. Um agente com execução pode mostrar "OXESpace: atualização de segurança — clique para aprovar". | descrição e schema da ferramenta; o teste sem execução foi recusado, então não houve captura | Notificações pedidas por agentes saem com o prefixo fixo de origem ("Agente em <painel>: …") e nunca com o nome do app como título. Um teste cobre a tentativa de usar "OXESpace" como título. |
| P1-8 | OxeChat · cartão de aprovação de comando | **bloqueia** | Por padrão, a pessoa não vê o comando. A caixa "Readable preview" aparece vazia (também na baseline `thread-states/thread-approval-*`), e o comando fica recolhido em "Exact command or request". O que fica visível é o "Agent reason", escrito pelo agente ("OXESpace verificou: seguro, pode aprovar"), e o botão Approve verde em destaque. Com `rm -rf ./src` no comando, nada disso aparece antes de abrir o recolhido. | `audit-permissions-app/oxechat-approval-fake-bullets.png`, `-rlo.png`, `-huge.png` | O comando exato aparece aberto por padrão (monoespaçado, rolável, com a pasta), e o recolhido fica só para detalhes extras. A prévia legível aparece preenchida ou some. O "Agent reason" vem rotulado como texto do agente, em tom neutro e abaixo do comando. Em comando de escrita, Approve não é o botão primário (Decline e Approve têm o mesmo peso, ou Decline é o padrão). |
| P1-9 | OxeChat · cartão de aprovação (comportamento) | positivo | O comando enorme (16 mil caracteres) aparece inteiro numa área rolável depois de expandido. Enter no composer não aprova o pedido, e o foco não é roubado quando o pedido chega. | `audit-permissions-app/notes.json` | Manter. Ainda assim, o leitor de tela precisa ouvir "pedido de aprovação" quando ele chega (região viva educada); conferir no roteiro NVDA/Orca. |
| P1-10 | OxePost · confirmação de produção | atrapalha | A confirmação mostra `GET {{baseUrl}}/danger`, com a variável sem resolver, então a pessoa não vê o endereço real de produção para onde vai enviar. | `audit-permissions-app/oxepost-production-confirm.png` | A confirmação mostra a URL resolvida (host em destaque, segredos mascarados), o método e o ambiente. Um teste com variável confere o host exibido. |
| P1-11 | OxePost · confirmação de produção (comportamento) | positivo | Ctrl+Enter também passa pela confirmação. O foco começa em Cancel, e um Enter seguido não envia. Send fica vermelho, e há o selo "Production" ao lado do ambiente. | `audit-permissions-app/notes.json` | Manter. |
| P1-12 | OxeQuery · classificação para a confirmação (produção e agentes) | positivo | O classificador (`sql-guard`) pega, entre 22 entradas adversariais: DELETE dentro de `WITH`, destrutivo depois de SELECT, comentários que disfarçam, caixa misturada, `EXPLAIN ANALYZE` (executa), `dblink`, `lo_export` e `pg_terminate_backend` (saem do banco), `SELECT INTO`, `TRUNCATE`, `GRANT` e `PREPARE/EXECUTE`. Uma string `$q$DELETE…$q$` fica como leitura, corretamente. | sonda em Node sobre `sql-guard.ts` da `main` f211ca7f | Manter, com as 22 entradas viradas teste de regressão. |
| P1-13 | OxeQuery · motivo mostrado na confirmação | atrapalha | Três casos chegam à confirmação sem dizer o pior: `COPY … TO PROGRAM '…'` (executa um comando de shell no servidor do banco) vira "write" sem motivo; um `DO $$ … DELETE FROM users; … $$` e um `CALL purge_users()` viram "write" simples, sem inspecionar o corpo, e o DELETE de dentro não aparece como destrutivo; `SELECT … FOR UPDATE` (trava linhas) é tratado como leitura. | mesma sonda | `COPY … TO/FROM PROGRAM` é destrutivo, com o motivo "executa um comando no servidor do banco". `DO`/`CALL` levam o motivo "executa código no banco; o efeito não é conhecido antes" e são tratados como destrutivos em produção. `FOR UPDATE` e `FOR SHARE` levam o aviso de trava. Os quatro casos entram como teste. |

Ainda não cobertos nesta fase:
- a edição de config protegida;
- a quarentena e a confiança de MCP;
- o pareamento do celular (sem tela ainda);
- o firewall na primeira escuta do gateway;
- a confirmação de produção do OxeQuery na tela (a classificação foi coberta acima; o fluxo com o nome digitado tem e2e próprio, `e2e/oxequery-production.spec.ts`).

Entram na próxima rodada da fase 1.

### Fase 1, segunda rodada (`main` bab99b50)

Roteiros no #184: `check-quarantine*.spec.ts` (fixture `OXESPACE_E2E_MCP_FIXTURE=quarantine` do #237) e
`audit-permissions-rest.spec.ts`. As capturas ficam em `quarantine/` e `audit-permissions-rest/`.

| # | Tela / componente | Gravidade | Problema | Evidência | Critério de aceite |
|---|---|---|---|---|---|
| P1-14 | Servidores MCP · quarentena fora da lista | atrapalha (virou F25) | Com 2 servidores em quarentena e 1 sem revisão, nada fora da lista avisa: o ícone do MCP, o sino, "Sistemas 1/5" e a aba "Instalados", que mostra só "4". O MCP também não aparece nas Configurações, só no ícone da barra do workspace. | `quarantine/pt-BR-00-workspace.png`, `-01-list.png` | Contagem no ícone do MCP e na aba "Instalados", e uma entrada na central de notificações quando um servidor entra em quarentena. |
| P1-15 | Servidores MCP · voltar a confiar | atrapalha (segurança, no F25) | O texto diz "use Testar para confiar nele de novo". Pelo código (leitura do coordenador), Testar não devolve a confiança, mas a pessoa é levada a crer que testar é confiar, e não existe um "Confiar de novo" explícito. A quarentena usa o mesmo chip cinza dos outros estados, e aparece "0 ferramenta". | `quarantine/pt-BR-02-docs-search.png` | "Testar" só verifica. "Confiar de novo…" abre uma confirmação que repete as instruções suspeitas, com Cancelar como padrão. Chip de quarentena com cor e ícone de alerta. Plural certo. |
| P1-16 | Servidores MCP · detalhe da quarentena | positivo | O detalhe explica a causa ("mudou depois de você confiar nele", "Ele adicionou upload_file"), o efeito ("não é oferecido aos agentes e não inicia") e lista as descrições com instruções para o modelo, por categoria ("Tenta substituir as instruções do agente", "Pede ao agente que envie dados privados para outro lugar"). Também mostra o comando, os argumentos e a descrição completa. Enter não concede confiança. | mesma captura | Manter. |
| P1-17 | OxeChat · mudança em config protegida (`.mcp.json`, `AGENTS.md`, `.git/hooks/*`) | atrapalha | Quando o provedor oferece "para a sessão" (o caminho do Codex repassa o `availableDecisions` dele), o cartão mostra **Allow session** num pedido `guarded`, que o próprio texto diz precisar de "your confirmation each time". O cartão ignora o `guarded`. Approve continua verde e primário, inclusive para `echo "curl … \| sh" > .git/hooks/pre-commit`. O comando segue recolhido (P1-8). O motivo e o aviso vêm em inglês fixo do main (`protectedConfigReason`, `PROTECTED_CONFIG_WARNING`). | `audit-permissions-rest/oxechat-git-hook-by-shell.png`, `-codex-mcp-json-session-offered.png` | Com `guarded`, o cartão nunca oferece "para a sessão" nem "lembrar", traz um selo "Arquivo que comanda agentes" e Approve não é primário. O main tira o `acceptForSession` de pedidos protegidos também no caminho do Codex. Motivo e aviso vêm por código C3 (en e pt-BR). |
| P1-18 | OxeQuery · confirmação de produção na tela | atrapalha | A confirmação ("Esta instrução é destrutiva" / "Alterar dados em produção?") diz o motivo traduzido ("DELETE sem WHERE remove todas as linhas da tabela.") e pede o nome, mas **não mostra a instrução**. Num script com o `DELETE` na linha 1302, a pessoa digita o nome sem ver o que vai rodar: o editor fica atrás do diálogo, rolado em outra parte. | `audit-permissions-rest/oxequery-prod-huge.png` | A confirmação mostra as instruções que a exigiram (texto exato, número da linha, monoespaçado, rolável), com o motivo ao lado de cada uma. |
| P1-19 | OxeQuery · confirmação de produção (comportamento) | positivo | O foco começa em Cancelar, Enter logo de cara cancela e Escape fecha devolvendo o foco a Executar. "Executar em produção" é vermelho e fica desabilitado até o nome. Os motivos vêm em pt-BR. O selo "PROD" aparece na aba, na conexão e na barra. | `audit-permissions-rest/notes.json` | Manter. |
| P1-20 | OxeQuery · editor | atrapalha (erro) | Ao digitar no editor (Ctrl+A e depois inserir texto), o renderer lança várias vezes `TypeError: Cannot read properties of undefined (reading 'duration')`, no `onKeyUp` do Monaco (`ClockController`). | `audit-permissions-rest/notes.json` (`oxequeryErrors`) | Nenhum `pageerror` ao editar no OxeQuery, com um teste e2e que falha diante de qualquer `pageerror`. |

Limites desta rodada:
- `DO $$…$$`, `COPY … TO PROGRAM` e `SELECT … FOR UPDATE` rodaram sem confirmação em produção, mas só porque o mock do
  e2e usa uma regex simples (`insert|update|…|alter`). O app real classifica pelo `guardSql`, já homologado no #237.
  Falta conferir o fluxo inteiro contra um Postgres de verdade.
- O pareamento do celular e a explicação do firewall só existem no #221 (tela Devices) e no #180 (gateway), ainda
  abertos. O diálogo de firewall do próprio Windows aparece na tela de quem roda e depende do gateway real, então só
  será conferido com aviso prévio ao usuário.

## Fase 2 · Menus, paleta e feedbacks

| # | Tela / componente | Gravidade | Problema | Evidência | Critério de aceite |
|---|---|---|---|---|---|
| P2-1 | Paleta de comandos (rótulos) | atrapalha | Os rótulos misturam três estilos: "Categoria: ação" ("Activity: Mark all as read", "Design System: Open Viewer"), verbo ("Open activity center", "Restart terminal", "Toggle sidebar") e substantivo solto ("Linear issues", "Usage & limits", "Provider accounts"). Quem procura não sabe se digita a área ou a ação, e a lista fica sem ritmo. | Inventário de `src/commands/*.ts` na `main` f7f54346 (23 comandos estáticos; a lista completa, com 85, sai da passada com o app aberto) | Todo comando da paleta segue "Categoria: ação no infinitivo" (por exemplo, "Atividade: marcar tudo como lido" e "Terminal: reiniciar"), em en e pt-BR. Um teste de catálogo falha com um rótulo fora do padrão. |
| P2-2 | Menu do app × paleta | atrapalha | O mesmo comando tem nomes diferentes no menu e na paleta, mesmo em en: "Keyboard shortcuts" × "Show keyboard shortcuts", "About OXESpace (v1.3.3)" × "About OXESpace", e "Toggle sidebar" × "Mostrar ou ocultar a barra lateral" (menu em pt-BR). Quem aprende num lugar não reconhece no outro. | `audit-menus/notes.json` (menu e paleta capturados em en e pt-BR, `main` f211ca7f) | Menu e paleta tiram o rótulo da mesma chave de catálogo, no padrão do F17. Um teste compara os dois para cada comando presente em ambos. |
| P2-3 | Paleta em pt-BR | atrapalha | 21 de 86 itens seguem em inglês (Show keyboard shortcuts, Report a problem, About OXESpace, Toggle sidebar, Split pane right, Restart terminal, Usage & limits…), enquanto o menu do app já está todo em pt-BR. | `audit-menus/notes.json` | Coberto pela F6 (#197). Reverificar depois do merge: nenhum item da paleta em inglês no pt-BR. |
| P2-4 | Paleta: itens por terminal e workspace | cosmético | Cada terminal vira um item ("Terminal 1"…"Terminal 4"), e o workspace aparece com o caminho temporário inteiro ("demo-repo · C:\Users\…\Temp\…"). Com muitos painéis, a lista cresce sem agrupamento. | `audit-menus/notes.json` | Terminais e workspaces vão num grupo "Ir para", com o caminho encurtado (pasta e projeto) e o completo no title. |
| P2-5 | Workspace · split depois de trocar o layout | **bloqueia** | Reproduzido em 3 passos: "Toggle split layout" (desliga o layout dividido) → "Layout: 16 panes" → "Split pane right". O renderer lança `TypeError: Cannot read properties of undefined (reading 'rows')`, o ErrorBoundary da raiz troca a janela inteira por "OXESpace could not show this window", os painéis somem e a paleta não abre mais. Controles: os passos 1+3 e 2+3 isolados não quebram. | `audit-menus/sequence-*.json` e `sequence-0-57.png`; `probe-sequence.spec.ts` com `SEQ_FILE=sequence-b.json` | Um split em qualquer layout nunca derruba a janela: vira um painel novo ou uma recusa com motivo. Teste com os 3 passos, e outro que executa todos os itens da paleta em sequência sem perder a paleta. Enviado ao FRONTEND. |
| P2-6 | Novo workspace · pasta que não existe | atrapalha (alta) | Digitar no assistente um caminho que não existe (`C:\nao\existe\pasta`) e confirmar cria em silêncio um workspace "pasta", com 4 terminais "Rodando" apontando para uma pasta inexistente. Não aparece erro, aviso nem pergunta "criar a pasta?". O serviço real (`workspace.service.ts › create`) também não confere se a pasta existe, então não é só o mock. | `audit-feedback/wizard-missing-folder.png`; `workspace.service.ts:93` | O assistente confere o caminho antes de criar. Se a pasta não existe, diz isso em pt-BR/en, sugere "Criar a pasta" ou "Escolher outra" e não cria o workspace. O main recusa `rootPath` inexistente com um código C3. Há teste no main e e2e no assistente. |
| P2-7 | Toasts | cosmético (atrapalha em toasts longos) | (a) Repetir a mesma ação empilha toasts idênticos: 4 cópias seguidas viram 4 "Copiado: Caminho". (b) Cada toast some em cerca de 2,7 s, sem botão de fechar nem pausa ao passar o mouse ou focar; serve para "copiado", mas não para um toast com texto longo ou com ação. (c) O texto "Copiado: Caminho" soa como rótulo técnico; em português natural seria "Caminho copiado". O papel é `status`, o que está certo. | `audit-feedback/toast-burst.png`; `audit-feedback/notes.json` | Toasts iguais em sequência viram um só, com contador ou renovação. A duração cresce com o tamanho do texto (mínimo de 4 s com ação) e pausa com hover ou foco. Todo toast com ação tem fechar acessível pelo teclado. Os textos seguem a forma "<coisa> copiado", em en e pt-BR. |

## Fase 3 · Páginas e modais por modo

Roteiro: `audit-pages.spec.ts` (no #184). São 29 superfícies por combinação: a tela inicial, os 5 modos, os modais de
cada modo (novo workspace, nova conversa, nova conexão, importar no OxePost, remover container, Team, atalhos, About,
relatar problema) e todas as categorias de Settings, do app e do workspace. Combinações: claro/pt-BR, escuro/en e
escuro/pt-BR, na `main` f211ca7f. Cada superfície é capturada e medida: rolagem horizontal, alvos abaixo de 24 px,
contraste abaixo de AA e inglês restante no pt-BR.

| # | Tela / componente | Gravidade | Problema | Evidência | Critério de aceite |
|---|---|---|---|---|---|
| P3-1 | Todas as superfícies medidas | positivo | Nas 3 combinações × 29 superfícies não houve nenhuma rolagem horizontal, nenhum texto abaixo do contraste AA e nenhum erro de console. | `audit-pages/<combo>/metrics.json` | Manter. A matriz pode virar gate do lote visual (F8). |
| P3-2 | Controles segmentados, chips e seletores pequenos (primitiva) | atrapalha | Alvos abaixo de 24 px em série, vindos da mesma primitiva: Aparência (escala 90–125%, densidade, movimento) e Atualizações com 22 px de altura; o motor Docker/Podman do OxePod com 22 px; o ambiente Local/Desenvolvimento/Produção e as amostras de cor (18×24) na nova conexão; a caixa "Favorita" com 16×16; o workspace no seletor de escopo de Settings com 168×20. | `audit-pages/light-pt-BR/metrics.json` (`small`); `21-modal-new-connection.png` | A primitiva segmentada, os chips e as amostras têm pelo menos 24×24 de área de toque (ou o espaçamento da exceção do WCAG 2.5.8), nas duas densidades. O lint de alvo da F4 passa a cobrir essas primitivas. |
| P3-3 | Modal Team | atrapalha | Em pt-BR o modal está todo em inglês ("Persistent roles for this project, shared by Code and Thread", "Loading team…"). O carregamento é um texto escrito à mão, não a primitiva LoadingState da F1. | `audit-pages/dark-pt-BR/24-modal-team.png` | Textos pelo catálogo (F6/F12, OxeCode/OxeChat) e carregamento pela primitiva. Conferir que o carregamento termina, porque na captura de 0,5 s ele ainda estava em andamento. |
| P3-4 | Tela inicial e primeiros passos em pt-BR | atrapalha | 16 textos em inglês na tela inicial ("Agents and terminals for your projects", "Select a folder…", "New workspace", "Open Thread", o FirstRunChecklist inteiro) e no modal de novo workspace. | `audit-pages/light-pt-BR/00-start.png`, `01-modal-new-workspace.png` | Coberto pela F6 (#197). Reverificar: nenhum texto em inglês nessas duas superfícies no pt-BR. |
| P3-5 | About e Relatar problema pela paleta, em pt-BR | atrapalha | Buscando "Sobre" ou "Relatar" na paleta em pt-BR, nada aparece ("No results", também em inglês). Só o menu Ajuda chega a essas telas. | `audit-pages/light-pt-BR/26-modal-about.png`, `27-modal-report.png` | Coberto pelo PR curto do FRONTEND depois do #197 (rótulos e palavras-chave da paleta pelo catálogo). Reverificar a busca em pt-BR. |

Ainda nesta fase:
- a combinação claro/en;
- o progresso de operações longas (import/export do OxeQuery, índice semântico);
- as telas de quarentena e config protegida com a fixture do #237.

## Propostas de roadmap (funcionalidades avançadas que faltam)

| # | Proposta | Por quê |
|---|---|---|
| R-1 | Aprovação dentro do app, com fila e histórico (quem pediu, o quê, a decisão, quando), além do log do OxeQuery | Hoje cada pedido é um diálogo nativo isolado; com vários agentes, a pessoa não vê o que já aprovou nem o que está na fila. |
| R-2 | Prévia do efeito antes de aprovar SQL de escrita (linhas afetadas por um `EXPLAIN`, ou uma transação de ensaio com rollback) | "Permitir uma vez" num DELETE sem saber quantas linhas ele afeta é decisão às cegas. |

