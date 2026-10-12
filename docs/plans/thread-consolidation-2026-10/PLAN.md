# Consolidação visual e operacional do Thread

Data: 2026-10-04. Estado: **implementação em andamento; produto não certificado por este documento**.
Entrada: pedido do usuário para revisão Playwright e plano dos P0/P1/P2. Evidência: [REVIEW.md](REVIEW.md), [medições](measurements.json), [resume local](../../validation/resume-latency-2026-10-03.md).

## Objetivo e baseline

Abrir e continuar conversas extensas de Codex/Claude com contexto preservado, histórico acessível, estado verificável e interface consistente. Separar abertura do histórico, conexão, aceitação do envio e inferência; cada etapa possui origem e tempo próprios.

Já existem: paginação do banco local, virtualização, cache de snapshots, rascunhos isolados, journal de operações, requests estruturados, checkpoints, review e manifestos. Evoluir esses serviços, não reconstruí-los. As correções locais anteriores de leitura recente, encerramento de conexão e remoção do watchdog de silêncio são baseline a revisar e integrar; ainda não constituem nova versão instalada.

Não tratar os planos antigos marcados concluídos como prova de produção. Hooks/apps experimentais, providers adicionais e controle independente de subagentes não são requisitos deste ciclo; não prometer suporte que o protocolo não oferece.

## Contrato visual consolidado

- Preservar tema aprovado e preferências existentes. Fonte de terminal (Cascadia Mono 16, line-height 1,4, spacing 0) não deve mudar quando o usuário altera texto da Thread. Fonte da conversa mantém preferência própria e reset explícito.
- Um título por célula; branch apenas no contexto superior. Cabeçalho compartilha tokens do chrome, sem introduzir outra paleta. Ações frequentes visíveis; ações secundárias no menu com rótulo e atalho.
- Canvas amplo comum à timeline e composer, respeitando largura útil; prosa com medida de leitura própria, tabelas/diffs usando mais espaço. Evitar impor novamente o antigo teto 800 px. Painel lateral só quando sobram pelo menos 480 px para conversa e 320 px para painel; abaixo, drawer com foco isolado e retorno ao iniciador.
- Compositor com aproximadamente 96–112 px para uma linha, crescimento limitado a 160 px de textarea. Modelo/esforço/acesso efetivos distinguíveis de alterações para o próximo turno. Input utilizável enquanto prepara follow-up; envio, fila e Stop com semânticas explícitas.
- Sidebar com opção compacta 36–40 px por thread, nome como prioridade e metadados sob demanda; opção confortável preservada. Ícones dos agentes iguais ao Code. Detalhes disponíveis por foco/teclado, não somente hover.
- Azul: pronto/parado/concluído; verde: execução observada; amarelo: requer ação; vermelho: falha; cinza: interrompido/estado desconhecido, sempre com texto e ícone distintos. Conexão online não transforma o turno em execução. Tokens de texto de status podem diferir dos de bolinha para manter contraste.
- Agrupar atividades consecutivas; perguntas/aprovações/falhas permanecem descobríveis. Resultado final em prosa, resumo de arquivos compacto e detalhes expansíveis; nenhum resumo gerado artificialmente para ocultar informação do agente.
- Um ponto principal de recuperação por falha; detalhes técnicos recolhidos com copiar relatório redigido. Não mostrar horário de retry/reset sem fonte comprovada.
- Modais com header/footer persistentes e corpo rolável; um padrão de labels, validação inline, loading e confirmação. Sem `<select>` nativo nas superfícies redesenhadas. Nova thread pelo + herda o projeto, mostrando nome/caminho e uma ação secundária de troca.
- Alvos desktop ≥28 px; contraste de texto normal ≥4,5:1 e foco/controles ≥3:1. Foco visível, Escape fecha a camada mais interna, retorno ao iniciador ou fallback documentado. Reduced motion e anúncio de transições, sem anunciar cada token.

## Sequência e entregáveis

Cada etapa termina com evidência do critério associado. Corrigir V01/V02/V03 cedo, mas não declarar estabilidade antes dos P0. A sequência abaixo é de execução; não exige agentes paralelos.

| Etapa | Pri. | Trabalho concreto | Dependência | Aceite |
|---|---|---|---|---|
| T01 | P0 | Fixar baseline, corpus anônimo e manifesto de versão/build/plataforma. Separar fixture, protocolo real e inferência real no relatório. Inventariar protocolo instalado dos dois providers. | — | A-B1 |
| T02 | P1 | Corrigir retorno de foco do DesktopDialog/Project settings e ampliar cobertura para outros modais/drawers. Resolver contraste Failed e alvos pequenos com tokens compartilhados. | T01 | A-V1, A-V2 |
| T03 | P0 | Definir contrato de página nativa/cursor/proveniência e persistência do progresso de importação, separado da paginação SQLite. | T01 | A-H1 |
| T04 | P0 | Implementar leitura reversa delimitada Codex e índice incremental Claude em worker, incluindo rotação/append/rewind e cancelamento. | T03 | A-H1, A-H2 |
| T05 | P0 | Integrar carregar anteriores à store/timeline, deduplicação, âncora e erro/retry por página. Remover dependência do CLI para ler histórico anterior elegível. | T04 | A-H2, A-V6 |
| T06 | P0 | Implementar reconciliação por provider e journal: resultado confirmado, turno ativo, request pendente, interrupção ou desconhecido. Verificar posse da sessão sem tomar a sessão do CLI. | T01 | A-R1, A-R2 |
| T07 | P1 | Unificar projeção visual de estado/diagnóstico no composer, cartão, sidebar e painel. Origem e idade dos sinais; ações específicas para autenticação, quota, offline, sessão ocupada e resultado desconhecido. | T06 | A-D1 |
| T08 | P1 | Manifesto por versão/capacidade/autorização efetiva com evidência por recurso, invalidação após trocar runtime/conta/configuração e tratamento de método indisponível. | T01, T06 | A-C1 |
| T09 | P2 | Consolidar densidade do sidebar e cabeçalho; preservar identidade, nomes completos acessíveis, ações e contexto único. | T02, T07 | A-V4 |
| T10 | P2 | Consolidar modais Nova thread/Contas/Project settings e menus; selecionar projeto com primitiva compartilhada e estados locais. | T02, T08 | A-V3 |
| T11 | P2 | Consolidar conversa/atividades/Changes e erros: reduzir repetição, reforçar origem e conteúdo acionável, manter outputs contidos. | T05, T07 | A-V5, A-V6 |
| T12 | P2 | Completar estados visuais e teclado de Connections, Changes, delegação, Files, Git, Jobs e Preview. Nenhum controle disponível sem handler/capacidade real. | T08, T10, T11 | A-V7 |
| T13 | P0 | Validar sessão longa no aplicativo instalado: importar, executar, responder, interromper, fechar/reabrir e continuar. Inclui upgrade a partir da beta anterior com dados preservados. | T05–T08 | A-I1 |
| T14 | P0 | Campanha nativa Codex e Claude em projetos descartáveis, com inferência e efeitos conferidos, cobrindo a matriz abaixo. | T08, T12, T13 | A-N1 |
| T15 | P1 | Campanha prolongada de 2 h, latências por etapa, RAM/processos, troca entre threads e stress de eventos/conteúdo. Corrigir regressões e repetir apenas cenários afetados. | T12–T14 | A-P1 |
| T16 | P2 | Reauditar matriz visual/teclado, regressão Code, documentação, evidências por build e decidir candidato de release. | Todas | A-G1 |

## P0: desenho técnico de histórico

Arquivos de referência: `native-session-history.ts`, `thread-history.ts`, `thread-orchestrator.ts`, `electron/main/ipc/thread.ipc.ts`, `shared/types/thread.ts`, `shared/types/ipc.ts`, preload, `src/store/thread.store.ts`, `ThreadTimeline.tsx`, `useThreadVirtualizer.ts`.

1. Nova API de página nativa retorna mensagens públicas, cursor opaco, origem, `hasMore` e cobertura (`partial/indexing/complete/unsupported`). Total desconhecido não pode ser apresentado como total zero. UI distingue páginas já importadas no SQLite das ainda disponíveis na origem.
2. Cursor vinculado à identidade do projeto/provider/native ID, geração do arquivo e limite de bytes observado. Validar root/cwd no header; não aceitar caminho arbitrário vindo do renderer. Identificar truncamento, rotação e alterações por rewind; cursor obsoleto produz recuperação explícita.
3. Codex: ler blocos de trás para frente, alinhar UTF-8/JSONL e acumular uma página por limite de mensagens E bytes. Grandes ferramentas são puladas sem materializar o payload. Página sem mensagem em meio a ferramentas não significa fim do histórico: devolver cursor/progresso e continuar com orçamento de trabalho/cancelamento.
4. Claude: respeitar uuid/parentUuid e ramo ativo; não trazer mensagens de sidechain ou ramo desfeito. Índice em segundo plano quando a estrutura exige travessia; nunca substituir por concatenação ingênua do tail.
5. Projeção idempotente usa ID nativo quando existe, senão posição/proveniência estável na geração do arquivo. Não usar só hash de texto: mensagens iguais podem ser legítimas. Esquema local deve permitir inserir páginas anteriores sem corromper sequence/journal, nem misturar mensagens importadas com eventos vivos duplicados.
6. Serializar merge com append vivo, deduplicar, preservar ordem e draft. Âncora por chave + deslocamento; resposta de uma thread não é aplicada a outra. Cancelar/substituir solicitações pendentes quando root/geração muda.
7. Índice incremental recuperável, escrita atômica, orçamento de RAM/I/O e worker cancelável. SQLite não pode ser regravado integralmente a cada página/token. Falha do índice não apaga a origem nem impede leitura da página já importada.

## P0: desenho técnico de reconciliação

Referências: adapters Codex/Claude, `thread-session-supervisor.ts`, `thread-orchestrator.ts`, `thread-recovery.ts`, journal em `thread-history.ts`, registry de requests e `ThreadLiveActivity.tsx`.

- Separar cinco fatos: processo/transporte, conta, entrega/ACK, turno nativo e cobertura de histórico. Um estado não serve como prova dos demais.
- Adapters expõem observação de estado somente quando o protocolo instalado permite. Verificar schema/capacidades antes de escolher métodos; não assumir que `thread/read` consulta um turno vivo ou que Claude tem a mesma API do Codex.
- Persistir operation ID, native turn ID, generation, último ACK/sinal e resultado. Em reconnect, consultar de forma somente leitura antes de habilitar novas mutações. Aplicar eventos da geração correta; resultados terminais não regridem.
- Se não há consulta confiável, classificar como **resultado desconhecido**, explicar o limite e oferecer inspeção/atualização ou ação explícita. Não mascarar a limitação como reconciliação concluída.
- Silêncio aciona aviso e, se suportado, consulta com backoff; não mata processo, não faz retry de prompt e não libera envio concorrente como se houvesse término. Timeout de requisição é distinto de timeout de inferência.
- Crash antes/depois ACK, conexão perdida após edição, processo encerrado, request expirada e conflito de escritor devem ter transições próprias. Verificar que os controles de perguntas antigas não podem ser reutilizados após generation change.
- Retry só após estado/posse conhecidos e ação explícita; operação incerta jamais é reenviada automaticamente. Interromper precisa confirmar ou marcar interrupção desconhecida. Não fechar terminal Code ou matar CLI para abrir Thread.

## P1: diagnóstico e capacidades

Diagnóstico apresenta etapas `Carregando histórico → Conectando → Enviando → Aceito → Executando/Aguardando sua resposta → Finalizado`, com caminhos de falha/resultado desconhecido. Não estimar pensamentos privados nem inventar percentual de progresso. Modelo/esforço/acesso mostram configuração confirmada e pendente separadamente.

Manifesto separa `implemented`, `advertised/observed`, `enabled`, `authorized`, `verified`, versão e data/fonte da verificação. Conectar o transporte não promove todas as capacidades a verificadas. Cache por provider/runtime/conta/configuração; ausência de método rebaixa apenas aquele recurso com motivo útil. Informação técnica detalhada fica em Diagnostics; o fluxo principal mostra disponibilidade e ação relevante.

## Critérios de aceite

| ID | Critério verificável |
|---|---|
| A-B1 | Corpus/versionamento/build registrados; cada evidência identificada como fixture/protocolo/inferência/instalado; zero segredo/transcript sensível no relatório. |
| A-H1 | Histórico público elegível do corpus acessível até início, inclusive arquivo ≥709 MB, linhas >32 MiB, Unicode dividido entre blocos, arquivo em crescimento, rotação e identidade incorreta. Sem impor janela de 8 MiB como limite final da conversa. |
| A-H2 | Repetir/cancelar páginas não duplica nem perde mensagens; prepend durante streaming mantém mensagem âncora e offset em até 2 px após estabilização de fonte/imagem; total desconhecido rotulado corretamente. |
| A-R1 | Matriz de crashes antes/depois ACK/efeito/finalização, stale events, requests e reconnect preserva journal e no máximo uma execução por envio. **Zero replay automático de mutação incerta.** |
| A-R2 | Sessão ocupada por CLI tem resposta explícita quando comprovada; nenhuma posse roubada. Provider sem observação confiável apresenta unknown e não falso idle/completed. |
| A-D1 | Uma recuperação principal por falha; estado/CTA concordam entre cartão, composer, sidebar e diagnostics. Falha antiga não é confundida com saúde atual. Nenhum retry time fabricado. |
| A-C1 | Mudança de versão/conta/config invalida evidência aplicável. Recurso indisponível não dispara fallback de prompt/terminal. Fixture não é exibida como certificação nativa. |
| A-V1 | Tab/Shift+Tab, Enter, Space e Escape funcionam por superfície; foco retorna ao iniciador/fallback; output não rouba foco; 15 ciclos de abertura/fechamento sem perda. |
| A-V2 | Texto normal ≥4,5:1, controles/foco ≥3:1; alvos ≥28 px desktop; sidebar selecionado/hover incluídos; nenhuma leitura depende somente de cor. |
| A-V3 | Nova thread, Contas, Project settings e confirmações têm loading/empty/error/success/disabled, header/footer acessíveis em 900×600/150%, caminhos legíveis por expansão/cópia, sem seletor nativo remanescente nesse escopo. |
| A-V4 | Sidebar compacto e confortável mantêm título identificável, status e ações por teclado; branch única; seleção/scroll preservados com 100 conversas e projetos homônimos. |
| A-V5 | Atividades compactas sem ocultar aprovação/falha; Changes distingue turno/projeto, origem e autoria. Arquivo sem patch não simula diff. Resumo não soma dirty anterior. |
| A-V6 | Sem overflow da página, sobreposição ou composer cortado; troca/reload/resize/prepend não causam salto ou tremor contínuo. Código/tabelas possuem scroll próprio; texto aumentado preserva seletores essenciais. |
| A-V7 | Connections/Changes/delegação e painéis auxiliares passam matriz de estados e foco; operação negada/erro preserva contexto e oferece recuperação real. |
| A-I1 | Build instalado identificado por versão/hash: sessão longa conclui novo turno, recebe resposta de pergunta, interrompe com estado confirmado/explicitamente desconhecido, reinicia e continua sem perder contexto/draft/histórico ou criar workspace Code. |
| A-N1 | Cada cenário aplicável da campanha real abaixo passa 3 vezes por provider; falha de ambiente/quota é bloqueio registrado, não sucesso; efeitos conferidos fora da resposta textual da LLM. |
| A-P1 | Metas medidas no mesmo hardware/dataset: cold open p95 ≤500 ms, warm switch ≤150 ms, input ≤50 ms, slash/painel ≤100 ms; ≤80 rows montadas; após 20 ciclos e repouso, crescimento residual de RAM ≤15% sobre baseline aquecido e sem tendência contínua em 2 h. Tempo de inferência é reportado separado, sem promessa de 500 ms. |
| A-G1 | P0/P1 fechados, zero finding HIGH aberto nos fluxos críticos; suites/build/budgets/migração e regressão Code aprovados; limitações e recursos experimentais explícitos. Nada é liberado apenas por contagem de testes. |

Os SLOs são alvos de aceite, não resultados já medidos. Registrar CPU/RAM/Electron/provider/modelo/esforço, cache frio/quente, tamanho dos arquivos e número de amostras. No mínimo 30 amostras de abertura/troca por cenário; custo de varrer diretórios, índice, IPC, primeira pintura, ACK e primeiro evento medidos separadamente.

## Campanha real e aplicativo instalado

| Caso | Execução | Prova |
|---|---|---|
| N01 | Nova sessão, CLI → Thread e Thread → CLI após cessão de posse; repetir com sessão extensa | Native IDs, continuidade de fato conhecido e nenhum escritor simultâneo |
| N02 | Agente faz pergunta com opções, usuário responde/recusa/cancela | Request nativa, ACK/resolução e comportamento correspondente do próximo turno |
| N03 | Comando requer aprovação; aprovar e negar em casos separados | Efeito autorizado presente; negado ausente; escopo correto |
| N04 | MCP de leitura/mutação, indisponível e OAuth/elicitation quando suportado | Resultado conferido no servidor; cancelamento não aprova ação |
| N05 | Imagem anexada, remoção e retry | Resposta sobre conteúdo da imagem e input estruturado; sem fallback textual falso |
| N06 | Follow-up/fila, editar/remover, steering se suportado, Stop | Ordem de turnos, configuração capturada, ausência de duplicata e interrupção observável |
| N07 | Desconexão/crash/restart antes/depois ACK, quota/auth | Journal e estado reconciliado ou unknown; rascunho preservado; sem replay |
| N08 | Duas threads/worktrees, delegação com opt-in, recusa/revogação | Diretório, sessão, autorização e arquivos corretos em cada lado |
| N09 | Sessão longa: página anterior, novos eventos, compactação/rewind se suportado | Histórico e ramo corretos; conversa continua utilizável após reiniciar |
| N10 | Changes, review e comentário; edição/teste real simples | Diff/arquivos/teste conferidos, comentário no draft, autoria e origem corretas |

Usar projetos de teste com Git e efeitos controlados. A sessão original do usuário não pode ser assumida livre nem alterada silenciosamente: preferir fork nativo autorizado e identificado para diagnóstico; prova no original exige posse livre e tarefa delimitada. Fork/teste curto não substitui o aceite no corpus longo. App instalado deve usar perfil isolado para testes de migração; backup consistente de SQLite inclui WAL quando aplicável, sem copiar banco ativo de modo inconsistente.

No Windows executar todos os casos. No Linux empacotado repetir startup/resume/requests/arquivos/restart e os fluxos alterados por diferenças de processo/path. Sem ambiente Linux, registrar bloqueio daquela plataforma e limitar explicitamente a declaração de suporte; modo dev não comprova pacote instalado.

## Matriz de consolidação visual

Estados obrigatórios: vazio, carregando, carregamento lento, sucesso, erro, desabilitado, confirmação/ação pendente e recuperação, conforme aplicável a cada superfície. Superfícies: sidebar/projeto, nova thread, timeline/atividade, composer/configuração/anexo, request, erro/usage, histórico, Connections/Contas, Changes/Markdown, Files/Git, delegação/Jobs, Preview e Diagnostics.

Cobrir 900×600, 1280×800, 1440×900 e 1600×1000; zoom 100/125/150%; texto mínimo/padrão/máximo; sidebar expandido/colapsado/redimensionado; painel aberto/fechado; uma/duas células e fallback estreito; `midnight`/`one-dark` e demais temas oficialmente suportados antes da certificação global. Priorizar combinações extremas e registrar combinações não executadas, sem alegar 100% por uma amostra.

Playwright deve medir bounding boxes, área útil, foco, sequência de teclado, nomes acessíveis, scroll/âncora e contraste calculado. Inspeção humana dos estados representativos avalia hierarquia e legibilidade. Captura isolada não é aprovação do fluxo. O teste opcional atual de auditoria demonstra V01; convertê-lo em regressão padrão depois da correção.

## Riscos e mitigação

- Paginação pode reintroduzir mensagens desfeitas ou duplicar eventos vivos: provenance/cursor/epoch e fixtures de branch/rewind antes da integração visual.
- Consulta de estado pode iniciar processo ou disputar escritor: separar observação de resume/execução e qualificar cada método por runtime.
- Cache de capacidade pode ficar permissivo após troca de conta: invalidar por identidade/revisão, revalidar autorizações no main ao executar.
- Mudanças em tokens e DesktopDialog afetam Code: testes de contraste/foco/menus e preferências nos dois modos.
- Campanha nativa pode consumir quota ou parar por auth: execuções pequenas, sem retry cego; registrar bloqueio e continuar verificações independentes.
- Worker/index e cache podem crescer silenciosamente: limites, cancelamento, retenção e campanha de RAM/processos.

## Entrega e liberação

Entregar por etapa: código, regressão relevante, registro do que passou/falhou e atualização desta matriz. Preservar alterações locais já existentes. Não publicar release durante planejamento. Release posterior depende de A-G1 e deve conter binário efetivamente testado, notas claras, backup/migração/rollback sem exclusão de dados e distinção entre testes simulados e pilotos reais.

O objetivo de liberação é **zero lacuna crítica conhecida no escopo declarado**, não uma nota estética 10/10 nem promessa de ausência absoluta de bugs.

## Progresso da implementação — 2026-10-04

Evidência atual em [VERIFY.md](VERIFY.md). A aprovação cobre o plano inteiro; esta lista registra progresso, sem encerrar as etapas ainda parciais.

- T01: versões locais inventariadas (Codex 0.155.1, Claude Code 2.1.287); schema do Codex consultado localmente.
- T02/T10: retorno de foco corrigido e aprovado no Playwright; corpo rolável/footer persistente no Project settings; Nova thread mostra projeto/caminho e troca pesquisável por opções, sem select nativo; ícones compartilhados; alvos principais ampliados e contraste de Failed/Changes corrigido. Ainda há candidatos de contraste em metadados e outros fluxos a revisar.
- T03/T04/T05, **parciais**: cursor com identidade/snapshot/fingerprint; leitura reversa com limites; páginas anteriores em tabela separada (migração 060); IPC/store/timeline; preservar cursor durante refresh; exportar páginas já importadas; invalidar páginas em recuperação/rewind/troca de sessão. Claude acompanha ancestralidade entre páginas; ambos os provedores leem em worker. Reinício com cursor parcial validado no Electron. Para arquivos Claude append-only, o cursor de ancestralidade substitui o índice prévio; ainda faltam casos de registros gigantes/parentes fora de ordem, migração de importações antigas e cobertura completa das invalidações.
- T06/T07, **parciais**: persistir ID do turno reconhecido pelo Codex e oferecer consulta somente de leitura no Diagnostics. Consulta conectada ou passiva após reinício, validando sessão/diretório e turno exato, sem resume, sem hidratar todos os turnos, sem reenviar e sem concluir o journal local antes de recuperar saída faltante. Ferramentas sem resultado no encerramento ficam desconhecidas, não falhas. Faltam reconciliação de saída/requests, Claude, backoff e projeção unificada na conversa.
- T08–T16: permanecem abertos, exceto os ajustes visuais e medições explicitamente descritos acima. Nenhuma release produzida nesta implementação.

- T09 avançou: opção compacta persistida, linha ≤40 px verificada no Playwright com 71 conversas; espaçamento confortável preservado. Outros estados/cabeçalhos da etapa ainda em revisão.
- T14 avançou parcialmente: novo/resume Codex real em sessão curta isolada concluídos; probe Claude bloqueado por autenticação. Continua faltando campanha completa de perguntas/aprovações/MCP/anexos/fila/cancelamento e sessão instalada.
- T07 avançou: cartão de silêncio consulta estado com backoff limitado, mostra resultado e preserva rascunho/Stop. Testes com tempo controlado e Playwright aprovados; consulta não substitui recuperação da saída. T06 ainda exige integração de output/requests antes de encerrar o journal local.
- T06 avançou: turno Codex fechado recupera resposta pública por páginas, faz merge idempotente e reconcilia o journal em transação, sem replay/fila. Protocolo real da sessão longa comprovou leitura de oito mensagens. Restam ferramentas/requests, conexão ainda ativa com terminal perdido, Claude e caminhos acima dos limites; detalhes em VERIFY.
- T06 avançou em 2026-10-05: recuperação individual de comandos, mudanças em arquivos, MCP e ferramentas dinâmicas, preservando ordem nativa e evidência de cada resultado. Leitura real recuperou oito mensagens e 60 ferramentas. Suíte completa: 1.158 aprovados, 25 ignorados; build/typecheck/lint direcionado e dois E2E aprovados. Ainda faltam requests, conexão ativa com evento terminal perdido, Claude e campanha instalada; T06 permanece parcial.
- T06/T07: confirmação conectada exige duas leituras idle e ausência de novos sinais/pedidos. Ferramentas desconhecidas de turno local encerrado podem ser recuperadas mantendo a conexão aberta, com confirmação final e sem fila automática. T15: virtualizador conserva a janela durante altura zero do painel oculto. Detalhes de validação e limites em VERIFY.
- T06: turno Codex ainda ocupado com evento final perdido agora pode ser liberado após recuperar a saída, confirmar o provedor e gravar eventos/turno/operação em transação. Checkpoints finalizam sem fila automática; pedidos pendentes bloqueiam o caminho. Probe nativo curto com evento final descartado e próximo envio explícito passou. Campanha instalada/longa, Claude e pedidos perdidos permanecem abertos.
- T06/T07: perguntas embutidas no histórico terminal Codex são recuperadas como evidência somente de leitura, com resposta não confirmada, opções visíveis e conteúdo preservado em copiar/exportar. Não reativa RPCs nem substitui a campanha real de perguntas/aprovações. Parser e UI verificados com fixtures e Playwright.
- T06/T07/T12: registro de pedidos evita ressurreição após invalidação concorrente e envio duplo. Histórico de aprovação fechado preserva detalhes expansíveis e distingue perda de conexão de decisão do usuário. Validado com testes e Playwright; RPCs nunca recebidos e campanha real permanecem pendentes.
- T14: Codex real confirmou pergunta com duas opções/resposta e recusa de aprovação em sessões isoladas, ambos concluídos. Nova tentativa Claude permaneceu bloqueada por authentication. MCP/anexos/fila/cancelamento e campanha instalada continuam pendentes; os probes não elevam automaticamente o manifesto global a verificado.
