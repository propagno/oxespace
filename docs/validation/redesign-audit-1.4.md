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

Ainda não cobertos nesta fase:
- a edição de config protegida;
- a quarentena e a confiança de MCP;
- o pareamento do celular (sem tela ainda);
- o firewall na primeira escuta do gateway;
- a confirmação de produção do OxeQuery (o OxePost foi coberto).

Entram na próxima rodada da fase 1.

## Fase 2 · Menus, paleta e feedbacks

| # | Tela / componente | Gravidade | Problema | Evidência | Critério de aceite |
|---|---|---|---|---|---|
| P2-1 | Paleta de comandos (rótulos) | atrapalha | Os rótulos misturam três estilos: "Categoria: ação" ("Activity: Mark all as read", "Design System: Open Viewer"), verbo ("Open activity center", "Restart terminal", "Toggle sidebar") e substantivo solto ("Linear issues", "Usage & limits", "Provider accounts"). Quem procura não sabe se digita a área ou a ação, e a lista fica sem ritmo. | Inventário de `src/commands/*.ts` na `main` f7f54346 (23 comandos estáticos; a lista completa, com 85, sai da passada com o app aberto) | Todo comando da paleta segue "Categoria: ação no infinitivo" (por exemplo, "Atividade: marcar tudo como lido" e "Terminal: reiniciar"), em en e pt-BR. Um teste de catálogo falha com um rótulo fora do padrão. |

## Fase 3 · Páginas e modais por modo

_A seguir._

## Propostas de roadmap (funcionalidades avançadas que faltam)

| # | Proposta | Por quê |
|---|---|---|
| R-1 | Aprovação dentro do app, com fila e histórico (quem pediu, o quê, a decisão, quando), além do log do OxeQuery | Hoje cada pedido é um diálogo nativo isolado; com vários agentes, a pessoa não vê o que já aprovou nem o que está na fila. |
| R-2 | Prévia do efeito antes de aprovar SQL de escrita (linhas afetadas por um `EXPLAIN`, ou uma transação de ensaio com rollback) | "Permitir uma vez" num DELETE sem saber quantas linhas ele afeta é decisão às cegas. |

