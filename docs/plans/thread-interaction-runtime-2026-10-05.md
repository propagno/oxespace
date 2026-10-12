# Thread: interação, execução observável e recuperação

Data: 2026-10-05. Status: aprovado pelo usuário; implementação e validação em andamento.
Base: checkout derivado de v0.16.0-beta.5, com trabalho Team não commitado preservado.
Evidências: [avaliação das dez imagens](bugprojetos-assessment-2026-10-05.md).
Integração: [equipes persistentes](persistent-agent-teams.md). Este plano corrige a execução e a interação necessárias às equipes; não substitui o restante de seu roadmap.

## Resultado esperado

O usuário consegue acompanhar uma solicitação, responder a um grilling, autorizar ou negar uma ferramenta, observar comandos e agentes paralelos e receber sua consolidação. A interface informa a diferença entre execução, espera humana, espera por tarefa, desconexão e resultado desconhecido. Terminal abre um shell utilizável. Nenhuma retomada depende de enviar “continue” automaticamente por tempo decorrido.

## Cobertura dos pedidos

| Pedido | Entrega | Etapa |
| --- | --- | --- |
| 1. Writing response sem transparência | Atividade recente real, progresso público, saída incremental e estados verificáveis | E3 |
| 2. Grilling interativo | Cartão de perguntas com escolhas, texto livre, teclado e confirmação | E1 |
| 3. Shells e agentes em background | Registro persistente, painel unificado por origem e retorno à conversa | E2/E3 |
| 4. Terminal indisponível | Terminal próprio do projeto Thread com PTY e ciclo de vida explícito | E4 |
| 5. Enable full access ruim | Seleção compacta e confirmação em diálogo separado | E5 |
| 6. AskUserQuestion falha | Correção do contrato nativo, pedidos pendentes e respostas correlacionadas | E1 |
| 7. MCP/permissões | Política efetiva por provedor e diagnóstico com ação específica | E1/E5 |
| 8. Demais evidências | Resultados com avisos, changes por escopo, caminhos Linux, atividade sem JSON cru | E3/E6 |
| Dois agentes sem retorno | Eventos após result, entrega persistida e consolidação pelo coordenador | E2/E7 |

## Contratos de arquitetura

- **Conexão, turno e tarefa são entidades distintas.** Terminar um turno não encerra a observação da sessão ou comprova conclusão dos filhos.
- Um leitor/decoder por conexão e geração. Correlacionar mensagens ao turno e à tarefa; não criar ouvintes acumulados a cada send nem descartar eventos tardios por um booleano de turno concluído.
- Identidade de execução inclui provedor, sessão, geração e ID nativo da tarefa. IDs podem se repetir entre sessões. Reaplicar eventos não duplica cartões ou resultados.
- Observação por eventos é principal; reconciliação ocorre após reconexão, retorno do aplicativo e quando há tarefas pendentes sem informação recente. Consultas têm atraso progressivo, limite e não enviam prompts de inferência.
- Estados desconhecidos são explícitos quando o provedor não permite consultar uma tarefa. Não inventar sucesso a partir de silêncio ou prosa.
- Um único escritor por sessão nativa. Code e Thread não criam sessões concorrentes para acompanhar o mesmo agente.
- Estado e decisões persistem; não persistir tokens, credenciais ou transcrições completas em logs diagnósticos. Eventos técnicos usam IDs, versões, duração e categorias, com detalhes redigidos.
- Capacidades dependem da versão e de evidência real. Testes simulados não conferem a marca de validação nativa.

## E0 — Instrumentação e contrato nativo (P0)

1. Registrar versões de OXESpace, Claude/Codex, sistema e modo efetivo no diagnóstico.
2. Traçar pedido enviado/aceito, ferramenta solicitada, pedido humano recebido/exibido/respondido, resposta entregue, tarefa iniciada/encerrada e result do turno.
3. Investigar em Linux a ausência de pedidos humanos, distinguindo negativa anterior ao callback, formato não reconhecido, descarte no transporte e falha de renderização. `--permission-prompts host` já existe; não assumir flag ausente.
4. Capturar fixtures redigidas do protocolo real, incluindo eventos depois do result e retomada. Confirmar os contratos nas versões suportadas antes de escolher campos de tarefas ou comandos de reconciliação.

Aceite: um diagnóstico permite localizar em qual etapa uma pergunta/aprovação ou retorno de tarefa deixou de avançar, sem expor dados sensíveis. Incertezas da análise permanecem identificadas até reprodução.

## E1 — Perguntas, grilling, permissões e MCP (P0)

### Perguntas

- Corrigir Claude: mapear ID de UI para o texto original de cada pergunta; devolver answers com chaves nativas e preservar questions. Truncamento visual não altera o payload nativo.
- Cartão “Sua resposta é necessária” na conversa, com título, progresso “Pergunta 1 de N”, radios/checkboxes, descrições e alternativa de texto livre. Permitir revisar respostas antes de enviar o conjunto requerido pelo protocolo.
- Ações: Responder, voltar para revisar, cancelar quando suportado. Enter segue o comportamento do controle; textarea mantém quebra de linha; Tab e setas funcionam. Nunca responder por seleção inicial implícita.
- Resposta sai uma vez por pedido/generation. Duplo clique, troca de thread, repetição de evento e confirmação tardia não duplicam envio. Rascunho preservado por pedido; pedido inválido após reinício informa que precisa ser refeito, sem fingir entrega.
- Erro de transporte mantém rascunho e oferece repetição somente quando seguro. Recusa, cancelamento, expiração e erro não aparecem como “respondido”.
- Grilling emitido somente como prosa não vira request nativo por heurística. O fluxo/skill deve usar a ferramenta estruturada quando disponível. Quando não houver suporte, a UI informa a limitação e permite resposta textual, sem simular pausa nativa. Verificar restrições de perguntas em subagentes por versão e encaminhar ao coordenador quando suportado.

### Permissões e MCP

- Definir matriz por provedor: leitura, escrita no projeto, acesso ampliado, rede, caminhos externos, hooks e regras herdadas. Para Claude, corrigir o atual mapeamento indistinto de read-only/workspace-write. Não anunciar sandbox de SO sem mecanismo efetivo.
- Se uma garantia não puder ser aplicada com segurança pelo protocolo suportado, desabilitar o modo ou nomear sua semântica real. Um filtro superficial de texto de comandos não basta para garantir read-only.
- Separar pergunta de autorização. Aprovação apresenta ferramenta, servidor MCP, ação, destino e escopo. Oferecer permitir uma vez/recusar; lembrar autorização apenas quando o provedor suporta esse escopo e o usuário o escolhe.
- Classificar MCP: servidor desconectado, autenticação expirada, ferramenta indisponível, política recusou, usuário recusou, timeout e falha remota. Conectar/reauth/revisar acesso/repetir só aparecem para casos aplicáveis.
- Não editar settings do usuário automaticamente para contornar recusa. Mudança de configuração durante execução respeita o turno atual e deixa explícito quando só vale para o próximo.

Arquivos principais: `claude-conversation.ts`, registro de requests, `thread-orchestrator.ts`, cards de pedidos, `ThreadConfigurationBar.tsx`, manifesto de capacidades, Connections.

Aceite: sessão nova e retomada realizam pergunta sem ID, perguntas múltiplas, multi-select e texto livre; Claude recebe as escolhas corretas. Write e MCP aprovados/recusados apresentam resultados distinguíveis. O fluxo mantém teclado, foco e rascunho ao trocar de thread. Regressão equivalente no Codex.

## E2 — Tarefas em background e retorno dos agentes (P0)

- Refatorar o transporte Claude para observar toda a sessão, inclusive notificações e continuações posteriores ao primeiro result. Preservar resposta automática nativa sem gerar um segundo prompt concorrente.
- Normalizar tarefas nativas, shells gerenciados, delegações MCP e membros Team com origem explícita. Reutilizar entidades existentes; não migrar todos os sistemas para um job fictício nem duplicar processos.
- Persistir vínculos parent/child, IDs nativos, estado, timestamps, referência de saída e comprovantes de entrega. Estados: iniciando, executando, aguardando entrada, concluído, falhou, cancelado e desconhecido.
- Receber eventos fora de ordem e repetidos. Persistir conclusão antes de notificar a UI. Resultado entregue ao coordenador e resultado apresentado ao usuário são confirmações distintas.
- Agentes nativos: aproveitar a notificação/continuação do provedor. Agentes independentes criados pelo MCP: outbox/inbox durável e agendamento explícito de entrega ao coordenador, com autorização existente, sessão exclusiva, deduplicação e controle de concorrência. Respeitar parada solicitada pelo usuário; não acordar sessão cancelada silenciosamente.
- Se o coordenador estiver ocupado, enfileirar; se desconectado, manter pendente; se aceitação do envio for incerta, reconciliar antes de repetir. Não prometer inferência externa exatamente uma vez.
- Controlar parar/abrir saída/abrir agente somente onde há suporte; processo arbitrário não gerenciado não pode ser apresentado como tarefa rastreável. Informar claramente limites de visibilidade.

Aceite: dois agentes iniciam, um finaliza após result da sessão principal, outro falha ou pede entrada; ambos têm estado e retorno visíveis. O coordenador recebe cada resultado sem duplicação e consolida. Troca de thread não interrompe observação. Reinício recupera tarefas identificáveis e marca as demais como desconhecidas.

## E3 — Transparência na conversa e painel Activity (P1)

- Faixa compacta: estado atual, descrição útil, duração e quantidade de tarefas. Estados orientados por eventos: enviando, aceito, preparando, executando ferramenta, aguardando você, aguardando agentes, recebendo resposta, reconectando, resultado não confirmado.
- “Escrevendo resposta” apenas enquanto há evidência atual de texto sendo recebido. Mensagem antiga não domina o estado. Sinal de conexão é diferente de progresso de trabalho.
- Mostrar comentários públicos do agente, resumos de raciocínio disponibilizados pelo provedor, plano e ferramentas; não inventar pensamento nem prometer raciocínio interno oculto.
- Resumos tipados: “Executando npm test”, “Editando src/App.tsx”, “Consultando PR no Azure DevOps”. Argumentos completos e saída ficam em detalhes, nunca `{` como resumo.
- Saída incremental limitada e virtualizada quando necessário; detalhes volumosos sob demanda. Scroll segue o final apenas quando o usuário já estava nele.
- Rodapé distingue turno concluído, concluído com avisos, trabalho em background pendente, falha e resultado desconhecido. Falha recuperada permanece inspecionável sem anunciar falha total automaticamente.
- Activity reúne fontes, filtros, timestamps e contadores consistentes. Zero jobs locais não significa zero trabalho nativo. A conversa tem atalho para a tarefa relevante.

Aceite: nenhum JSON cru como título, nenhuma execução silenciosa sem estado identificável, tarefas nativas e gerenciadas corretamente contabilizadas, estado de reasoning posterior a texto não vira writing response antigo. Atualizações frequentes não roubam foco nem provocam tremor de rolagem.

## E4 — Terminal funcional do projeto Thread (P1)

- Abrir painel com ação “Novo terminal” e shell padrão do usuário no diretório do projeto. Criar um PTY real, sem criar workspace Code duplicado.
- Reusar serviço PTY existente com identidade/owner de projeto Thread; definir iniciar, alternar, interromper, encerrar e tratamento de processo morto.
- Trocar de thread ou fechar painel mantém shell conforme política explícita. Encerrar aplicativo não promete preservar processo que não é persistente: histórico pode ser restaurado e novo shell precisa ser identificado como novo.
- Oferecer múltiplos terminais com títulos simples. Comandos de ferramenta aparecem como saída da tarefa; não alegar que abrir terminal permite anexar a qualquer shell nativo do agente.
- Dimensionar no primeiro paint e ao redimensionar, aplicar fonte configurada, sem precisar maximizar/minimizar. Falha de diretório/shell apresenta ação de recuperação.

Aceite: abrir, executar comando, redimensionar, trocar thread e voltar preserva o processo vivo e saída; fechar painel não encerra acidentalmente; encerrar terminal funciona. Windows e Linux sem novo workspace Code.

## E5 — Redesign de acesso e pedidos de autorização (P1, política depende de E1)

- Popover compacto com opções de acesso, descrição curta e marca de seleção. Política efetiva e alterações pendentes ficam legíveis.
- Acesso ampliado abre diálogo independente com título “Permitir acesso ampliado?”, projeto/diretório com quebra adequada, resumo exato das permissões e botões Cancelar/Permitir acesso ampliado.
- Confirmação não fica empilhada dentro de menu rolável. Aplicar padrão DesktopDialog, foco inicial previsível, Escape, retorno de foco ao acionador e ausência de mudança antes da confirmação.
- Requests de MCP/write usam o mesmo padrão visual, mantendo distinção entre autorizar uma ação e mudar o modo da sessão.

Aceite: usável por teclado e em janela 900×600, sem rodapé cortado, sem linhas órfãs de caminho e sem confirmação com semântica falsa de sandbox. Conferir 1280×720 e 1920×1080, temas e fonte ampliada.

## E6 — Changes e demais evidências (P1/P2)

- Agrupar por turno e arquivo; classificar projeto, externo e estado do agente. Metadados internos ficam em grupo secundário, não dominam mudanças do produto.
- Distinguir proposto, executado, falhou e diff verificado. Permitir inspecionar evidência sem atribuir autoria exclusiva indevida.
- Respeitar identidade de caminhos por plataforma: não unir arquivos Linux diferentes somente por caixa. Caminhos longos quebram no detalhe e têm cópia acessível.
- Melhorar vazios, carregamentos, falhas e recuperação em Activity, Connections, Changes e Terminal; evitar mensagens fixas que não ajudam a prosseguir.

Aceite: Read não cria mudança, Write negado não aparece como edição confirmada; arquivo externo é identificável; dois arquivos Linux distintos por caixa continuam separados; Markdown abre no leitor existente.

## E7 — Campanha de validação e entrega

| Camada | Cobertura obrigatória |
| --- | --- |
| Unitária/contrato | Payloads reais redigidos, correlação de perguntas, eventos tardios/duplicados/fora de ordem, políticas e reducer de estados |
| Integração | Persistência, reinício, outbox/inbox, ownership de sessão/PTY, sem reenviar mensagem em estado incerto |
| Playwright/Electron | Grilling completo, acesso, MCP recusado/permitido, dois agentes, Activity, terminal, changes, troca de thread, teclado/foco/scroll |
| Nativa instalada | Claude e Codex autenticados; sessão nova e longa retomada; perguntas, aprovações, MCP, cancelamento, background e reabertura; versões registradas |
| Desempenho | Baseline antes/depois com mesma máquina e fixture; 60 min alternando threads, saída volumosa e painéis; memória, CPU ociosa, latência input/render e listeners |

Metas propostas: feedback visual de clique até 100 ms e abertura de painel local até 300 ms no percentil 95 no ambiente de referência; estabelecer baseline na E0. Latência do provedor é medida separadamente. Após ciclos repetidos, não haver crescimento sustentado de listeners/processos/objetos de tarefas encerradas; memória deve estabilizar após coleta e caches previstos. Investigar regressão superior a 10% no mesmo ensaio.

Cenário principal: grilling → responder escolhas → aprovar ferramenta → iniciar dois agentes → acompanhar saída/tarefas → receber ambos os resultados → consolidar → trocar de thread → fechar/reabrir e conferir histórico/estado. Executar também com negativa humana, falha de um agente, desconexão durante resposta e cancelamento explícito.

Registrar cada caso com ambiente, versões, resultado e limite conhecido. Evidência visual é inspeção do fluxo; capturas isoladas não equivalem a validação. Autenticação indisponível ou ambiente Linux ausente deixam caso pendente, não aprovado. Não publicar nova release como solução desses P0 enquanto os fluxos reais correspondentes estiverem sem comprovação.

## Sequência e fronteira da entrega

E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7. E1/E2 bloqueiam a conclusão do fluxo coordenador; acabamento pode ser preparado depois dos contratos estabilizados. Preservar implementações Team existentes e acrescentar integração sem reescrever suas identidades/mensagens.

Fora desta entrega: migração para outro SDK sem necessidade comprovada, recriação do terminal do provedor na Thread, acesso irrestrito como solução de MCP, novas funcionalidades de gestão Azure DevOps e inspeção universal de processos externos. O uso do MCP Azure existente entra na campanha de permissões; funcionalidades de PM permanecem no plano Team.
