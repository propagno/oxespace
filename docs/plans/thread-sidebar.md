# Sidebar específico do modo Thread

Evolução planejada em 2026-09-17: [Thread Desktop](thread-desktop-redesign.md) substitui a proposta de shell compartilhado e define catálogo por identidade real de projeto, login e contrato visual próprio.

Status: implementado no checkout; validação de store/componentes, typecheck e build concluída. E2E Electron concluído com fixtures em 900/1280 px, incluindo preservação de terminais/draft, autenticação/retry e collapse/expand. Captura de 900 px inspecionada.

Implementação usa o shell existente de Sidebar com conteúdo específico por modo; catálogo via list(workspaceId), sem migração ou nova API.

## Objetivo e diagnóstico

Ao selecionar Thread, substituir a navegação de workspaces/panes por navegação de conversas. Ao voltar para Code, recuperar a seleção anterior de workspace/pane e manter os terminais em execução.

App.tsx renderiza Sidebar incondicionalmente; applicationView controla somente a área central. ThreadView mantém lista e seleção locais e está associado, por key, ao workspace ativo. A seleção de outro workspace remonta a conversa e perde seu estado local. O histórico atual fica em um menu na toolbar.

Este plano substitui a orientação de docs/plans/thread-ui-spec.md de preservar o sidebar de projetos no modo Thread. Permanece o requisito de uma única coluna lateral.

## Contrato de interface

- Code: sidebar atual, com workspaces e panes.
- Thread: mesmo espaço lateral, largura e controles de recolher/expandir; conteúdo próprio, sem linhas de panes, sessões de terminal ou grupos de integração.
- Cabeçalho: Threads, busca e Nova thread. Manter marca, configurações e versão no shell comum.
- Corpo: projetos com grupos expansíveis e conversas abaixo. Fixadas primeiro dentro de cada projeto; demais por updatedAt decrescente. Não duplicar fixadas em outra seção.
- Linha: título, provedor e indicador de estado; destaque da conversa selecionada. Diretório disponível em descrição/tooltip para distinguir worktrees.
- Projeto vazio: oferecer Nova thread. Sem projetos disponíveis: orientar a adicionar um projeto pelo fluxo existente de workspace; criação de projeto independente fica fora desta etapa.
- Busca local por título, provedor, projeto e diretório. Mostrar claramente ausência de resultados; busca não inclui o conteúdo completo das mensagens.
- Nova thread abre configuração compacta com workspace de origem, provedor e diretório registrado. Criar usando a API atual; criar não envia mensagem nem inicia inferência.
- Remover o menu History e a navegação de threads da toolbar central. A área central contém cabeçalho da conversa, timeline e composer.
- Recolhido: rail com expansão e Nova thread, sem reaproveitar os ícones de workspaces Code como se fossem conversas.
- Estados: carregamento, serviço indisponível, erro com retry, vazio e seleção removida. Falha de um workspace não deve ocultar os demais.
- Navegação por teclado, nomes acessíveis, foco visível e foco restaurado após fechar a configuração. Validar viewport estreito e popovers sem corte.

## Estado e identidade

Criar src/store/thread.store.ts como proprietário de metadados, seleção e rascunhos. ThreadSidebar e ThreadView consomem a mesma fonte; não manter duas listas concorrentes.

- selectedThreadId e contexto de criação independentes de activeWorkspaceId/activePaneId de Code.
- Selecionar thread resolve workspaceId, projectId e rootPath registrados na thread, sem chamar setActiveWorkspace e sem ativar/focar um terminal.
- App passa o workspace de origem à conversa por thread.workspaceId, e não por activeWorkspaceId. Retirar key atrelada ao workspace Code.
- Agrupar por projectId persistido na thread. Workspace é origem/contexto, não identidade do projeto; não deduplicar projetos por nome. Usar serviço existente de projetos para obter rótulos, se disponível; fallback para nome do workspace com descrição do diretório.
- Metadados indexados por threadId; snapshots completos carregados apenas para a conversa selecionada.
- Rascunhos por threadId, preservados ao alternar conversa e modo durante a sessão; não prometer persistência após reiniciar.
- Seleção e expansão Thread separadas das preferências Code. Persistir somente IDs/preferências leves de navegação; validar IDs após carregar o catálogo. Não persistir transcript em storage do renderer.
- Na entrada inicial, escolher a última seleção válida; fallback para conversa mais recente do workspace Code atual, depois a mais recente disponível. Sem conversas, mostrar o estado vazio.
- Status running/approval de uma thread deve continuar visível mesmo com outra conversa aberta. Trocar modo ou seleção não interrompe execução.
- Ao remover workspace/thread, retirar metadados, seleção e rascunhos associados; selecionar fallback ou estado vazio. Respostas antigas não podem restaurar seleção removida.

## Carregamento e eventos

A API atual list(workspaceId) já retorna metadados. Para a primeira versão, carregar os workspaces disponíveis com concorrência limitada, armazenar resultado por workspace e tratar falhas individualmente. Não carregar todos os históricos.

Manter um único listener thread.onChanged no store. Coalescer eventos e atualizar o snapshot ativo e os metadados do workspace afetado. Utilizar o mapa threadId -> workspaceId; ID desconhecido exige atualização limitada do catálogo. Aplicar controle de geração para descartar respostas obsoletas e limpar listener no encerramento.

O evento atual contém somente threadId e o backend atualiza updatedAt a cada evento. Evitar reordenar visualmente a lista a cada delta: estabilizar posição durante o turno e reordenar ao concluir ou fixar. Caso o volume de workspaces torne o carregamento caro, evoluir para listagem agregada de metadados e eventos com workspaceId; isso exige alteração tipada de IPC/preload e validação de sender.

## Etapas de implementação

1. Extrair shell comum do sidebar: marca, largura, resize, collapse e rodapé. Isolar listener de busca e ações de panes no conteúdo Code para não reagirem quando ocultos. Evitar duplicar manipuladores globais.
2. Implementar thread.store: catálogo, seleção independente, rascunhos, carregamento de snapshot, eventos, criação/fixação e tratamento de remoção. Reutilizar APIs existentes; sem migração nesta etapa.
3. Criar ThreadSidebar e linhas/grupos próprios com busca, estados, fixação, status e configuração de nova thread. Preferências de expansão próprias.
4. Integrar em App: escolher conteúdo lateral por applicationView, resolver workspace da thread separadamente, preservar hosts de terminal e adequar tema/status/contexto visível ao modo selecionado. O status Thread deve refletir rootPath/provedor/estado da conversa, sem exibir o pane Code como contexto ativo.
5. Refatorar ThreadView para receber seleção/snapshot e ações do store. Remover lista local, seleção local e History; mover draft para o store e eliminar refresh duplicado. Preservar autenticação/retry, stop e approvals.
6. Validar fluxos e atualizar docs/thread-view.md e docs/plans/thread-ui-spec.md para descrever o contrato final.

## Critérios de aceite e verificação

- Trocar Code -> Thread substitui as linhas Code por projetos/conversas; existe apenas um sidebar.
- Selecionar conversa de outro workspace não muda workspace/pane selecionados no Code; retornar restaura seleção e terminais.
- Alternar conversa, projeto e modo preserva rascunhos separados e não interrompe turnos.
- Reiniciar recupera histórico/fixação/seleção válida; execução anterior aparece interrompida conforme o backend existente.
- Criar, fixar, buscar e selecionar funcionam em dois projetos e em dois diretórios de um mesmo projeto, sem confundir suas identidades.
- Eventos de conversa não selecionada atualizam seu estado; deltas não causam saltos contínuos na ordenação nem substituem a conversa ativa.
- Falha parcial, serviço indisponível, remoção durante leitura e respostas fora de ordem têm comportamento definido e retry.
- Testes de store: seleção independente, rascunhos, eventos/races, remoção e carga parcial. Testes de componente: agrupamento/busca/seleção/estados/acessibilidade. E2E: troca de modos, seleção entre projetos, terminal DOM preservado, turno em background e draft retention.
- Typecheck e lint direcionado; E2E Electron com fixtures em 900 e 1280 px e inspeção visual. Teste autenticado de inferência não é necessário para validar a navegação.

## Fora desta entrega

Escrita de arquivos, novas permissões dos provedores, memória/CodeGraph/MCP/preview/delegação, importação de transcript, anexos, rename/archive/delete de conversas e projetos independentes do cadastro de workspaces. O sidebar não deve exibir ações sem suporte funcional.
