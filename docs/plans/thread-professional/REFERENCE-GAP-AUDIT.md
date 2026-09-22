# Batimento com a referência enviada — 2026-09-17

Base: imagem enviada pelo usuário (janela com projeto CodexMonitor), código atual e evidências anteriores de Electron. A imagem é a referência visual escolhida; não autentica a distribuição do aplicativo nem comprova comportamentos ao clicar. Não foi executada uma nova captura comparativa nesta auditoria. Itens fora da imagem são identificados separadamente.

## Diagnóstico

O maior desvio é de composição e integração: a referência reúne navegação, conversa/atividade e revisão Git em três regiões. O modo Thread atual oferece navegação e conversa; recursos do modo Code não contam como recursos integrados à Thread.

| Área | Referência observável | Estado atual do OXESpace | Lacuna / prioridade |
|---|---|---|---|
| Composição | Sidebar, conversa central e painel lateral direito | ThreadSidebar + ThreadView; sem painel de trabalho direito | Painel redimensionável e recolhível, sem apertar o composer. P1 |
| Superfícies | Sidebar escuro, centro azul/cinza, painel direito separado; divisórias discretas | Tokens compartilhados, resultado dependente do tema; separação central simples | Hierarquia de superfícies consistente com contraste verificado. P1 |
| Projetos | Nomes destacados, agrupamentos e conversas subordinadas | Agrupamento por projeto, branch, filtro e fixados | Densidade, recuo e peso tipográfico mais consistentes. P1 |
| Lista de threads | Indicador de estado à esquerda, tempo à direita, seleção com acento | Tempo e ícones à direita; fundo selecionado simples | Linguagem de estado e seleção consistente, sem depender só da cor. P1 |
| Lista longa | “More…” por projeto | Todas as conversas renderizadas no grupo | Mostrar recentes e expansão progressiva; preservar busca/seleção. P2 |
| Ações de sidebar | Captura não comprova criação/exclusão | Agora há + por projeto, exclusão de thread confirmada, remoção reversível de projeto | Polir ações contextuais para evitar excesso de ícones; manter foco e descoberta. P1 |
| Uso de conta | Cartão Session/Weekly, percentuais, reset e créditos | Consulta Codex /usage em painel; sem cartão persistente | Dados por conta/provider, indisponibilidade explícita; nunca inventar créditos Claude. P1 |
| Cabeçalho | Projeto e branch navegável; controles de editor/terminal/painéis | Título da conversa, projeto/branch informativos, ações e pin | Contexto de trabalho acionável, menu de branch e controles de painel. P1 |
| Mensagens | Balão azul do usuário e superfície distinta para resposta | Usuário alinhado à direita com superfície neutra; assistente em texto aberto | Ajustar contraste, largura e espaçamento dos blocos. P1 |
| Resumo de atividade | Grupo com contagem de ferramentas e mensagens | Agrupa somente ferramentas consecutivas | Grupo por segmento de execução, contagens e expansão sem engolir mensagens/aprovações. P1 |
| Atividade detalhada | Linha vertical, comentários, comandos compactos, arquivos editados | Details aninhados, nomes legíveis e output; tipos limitados | Itens específicos para comando/arquivo/comentário, destinos clicáveis e falhas destacadas. P1 |
| Comentários de execução | Texto público de progresso intercalado | Mensagens públicas exibidas, sem categoria visual específica; adapter não mapeia todos os eventos de reasoning | Exibir só progresso/resumos expostos pelo provider; não criar nem prometer raciocínio privado. P2 |
| Status do turno | Tempo decorrido e Working perto do composer | Working/Waiting for approval e stop; sem contador de duração | Status compacto com duração e resultado do turno. P1 |
| Compositor | Região inferior ampla, divisória e ações em duas linhas | Cartão arredondado limitado à coluna, seletores dentro do footer | Separar texto, ações e configurações, com alinhamento estável. P1 |
| Modelo/esforço | Seletores persistentes em chips | Implementados via catálogo nativo, revisão e fila para próximo turno | Refinar chips; provar efeito em inferência real e sincronizar overrides externos. P1 funcional |
| Acesso | Chip Full access visível | Read only/Workspace access e planejamento | Política equivalente ainda não existe; rótulo não pode simular acesso irrestrito. P1 funcional |
| Voz | Botão de microfone no composer | OXEVoice existe no Code/editor; não está conectado ao input Thread | Captura/transcrição na Thread com cancelar, erros descartáveis e draft preservado. P1 |
| Contexto/anexos | Ícone de inclusão/contexto junto ao input; significado completo não comprovado | Composer textual e capacidades de attachment=false nos adapters | Fluxo de arquivos/imagens/menções só habilitado quando o provider suporta. P2 |
| Indicador inferior circular | Indicador circular visível, significado não comprovado | Sem indicador equivalente na Thread | Definir semântica a partir de dados reais; não assumir que é uso de contexto. P2 |
| Git | Branch, total +/−, lista UNSTAGED, arquivos e contagens | /diff abre texto; componentes Git/review existem em outras áreas | Status por worktree, diff selecionável e atualizações sem sair da conversa. P1 |
| Commit | Campo de mensagem e botão Commit | Sem fluxo de commit no modo Thread | Stage/unstage/commit explícitos, estados vazios/erro/conflito e atualização da lista. P2 |
| Árvores/painéis | Abas por ícone no painel direito | Sem navegação equivalente na Thread | Definir abas e reutilizar serviços existentes; imagem não comprova todas as funções. P2 |

## Requisitos anteriores que a imagem não comprova

- Paridade total de comandos ainda não atingida. Remover Advanced CLI não equivale a implementar os comandos indisponíveis.
- Modelos/esforços: UI e validação estrutural existem; probe Codex confirmou configuração sem inferência. Validar turnos reais em ambos os providers.
- Histórico: armazenamento ainda limitado; falta paginação/virtualização completa para uso prolongado.
- Acessibilidade: há Radix/foco e testes básicos, mas falta auditar contraste e teclado de todas as novas superfícies no tema de referência.
- Scroll: implementado e exercitado com histórico longo e zoom; não deve ser contado como ausente. É preciso manter a âncora ao abrir atividades/painel Git.
- Login por assinatura: painel de contas existe. A screenshot não prova autenticação nem sua política.

## Sequência recomendada

1. Composição de três regiões, superfícies, sidebar e cabeçalho. Painel direito recolhe em larguras pequenas; preservar composer/scroll.
2. Timeline com atividades tipadas, arquivos acionáveis, comentários públicos e duração do turno.
3. Git integrado por diretório real da thread: status, arquivos e diff, depois staging e commit.
4. Composer com voz, contexto/anexos suportados, controles permanentes e indicadores reais.
5. Cartão de limites por provider, histórico progressivo e conclusão do manifesto de comandos.

Critérios de aceite: capturas do mesmo fixture em 900×600, 1280×800 e 1600×1000; sidebar/painel abertos e fechados; zoom 125/150%; teclado; turno real por provider; Git isolado por worktree; nenhum terminal automático; ausência de saltos de scroll durante streaming/expansão.

## Evidência no checkout

- `src/App.tsx`: montagem de ThreadView e restrição dos atalhos de voz ao modo Code.
- `src/components/Threads/ThreadSidebar.tsx`: projetos, branches e ações recentes.
- `src/components/Threads/ThreadView.tsx` e `.css`: composição, mensagens, scroll e composer.
- `src/components/Threads/ThreadActivityGroup.tsx`: grupos de ferramentas e detalhes.
- `src/components/Threads/ThreadConfigurationBar.tsx`: catálogo e controles persistentes.
- `electron/main/services/conversation/codex-conversation.ts`: eventos nativos, limites e configuração.
- `shared/types/thread.ts`: contrato de eventos e capacidades de anexos.
- `docs/plans/thread-professional/IMPLEMENTATION.md`: limites e provas da implementação anterior.

As ações de sidebar do pedido anterior passaram em TypeScript e nos 20 testes focados de UI/store. Foi corrigido um seletor de teste que confundia o botão da conversa com o novo botão de exclusão.
