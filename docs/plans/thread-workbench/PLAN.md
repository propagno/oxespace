# Thread workbench — plano de evolução visual e funcional

Data: 2026-09-18. Estado: implementação em andamento. A primeira entrega de transparência de arquivos e revisão integrada está descrita em [IMPLEMENTATION.md](IMPLEMENTATION.md); o plano completo permanece aberto.

Governança: as entregas deste workbench que compõem equivalência com o modo Code são coordenadas pelo [plano de paridade CLI/Thread](../thread-cli-parity/PLAN.md). Este plano permanece responsável pelo detalhamento visual e funcional do workbench.

Objetivo: tornar a Thread um ambiente de desenvolvimento e revisão transparente, com composição inspirada no Codex Desktop e funcionalidade equivalente à experiência de sessões do cdesktop, preservando os tokens, componentes e identidade do modo Code do OXESpace.

Referências: três imagens fornecidas pelo usuário, [cdesktop upstream](https://github.com/cdesktop-ai/cdesktop), checkout de referência `C:/Users/dudu-/Downloads/cdesktop-main/cdesktop-main` (package.json 0.2.3; ZIP sem revisão Git identificada). A inspeção do código local é a base da matriz; README e imagens não comprovam execução. [Matriz de paridade e evidências](PARITY.md). [Contrato visual e de interação](UI-SPEC.md).

Imagens preservadas para as próximas sessões: [Codex/revisão](reference-codex-review.png), [cdesktop/painéis](reference-cdesktop-panels.png), [cdesktop/sessões divididas](reference-cdesktop-split.png).

Este plano complementa `../thread-professional/PLAN.md`; não apaga suas pendências de comandos. Substitui a prioridade de iniciar somente pela composição visual: para a transparência solicitada, retenção de alterações e escopo correto são pré-requisitos do painel.

## Progresso da primeira entrega

R01/R02: evidências de protocolo e composição de revisão conferidas. R03–R09: primeira parte implementada (eventos/turnos/artefatos, patches Codex, entradas Claude, resumo e revisão isolada). R10: diffs carregados sob demanda e linhas em lotes; timeline paginada/virtualizada continua pendente. R11: comentários ao rascunho com identificação de revisão; persistência/Reviewed/revalidação pendentes. R15: planos/todos públicos; perguntas estruturadas pendentes. R12–R14 e R16–R24 permanecem abertos. Nenhuma onda inteira é considerada concluída apenas por esta entrega.

## 1. Resultado esperado

Ao pedir uma mudança, o usuário acompanha o progresso, vê quais arquivos foram lidos e modificados, inspeciona o patch daquela execução e recebe um resumo com arquivos únicos e saldo de linhas. Clicar no arquivo abre o diff correspondente ao lado da conversa. O usuário pode comparar isso com o estado atual do projeto, comentar linhas e enviar a revisão à mesma Thread.

O ambiente terá sidebar de projetos/sessões, conversa com compositor fixo e região auxiliar redimensionável. O menu de painéis reunirá Changes, Files, Plan, Preview, Terminal, Git e Logs. Changes/Git/Preview/Terminal/Logs têm correspondentes identificados no cdesktop; Files e Plan dedicados ampliam recursos que lá também aparecem no transcript/árvore. Duas a quatro conversas poderão compartilhar a área de trabalho, preservando contexto, foco e rascunhos independentes.

A primeira entrega será a transparência de arquivos com Changes integrado. Paridade de equipes, rotinas, agentes adicionais e comandos será entregue nas ondas seguintes, não será contabilizada como pronta por existir um botão.

## 2. Diagnóstico verificado no checkout

| Área | Implementação atual | Consequência |
|---|---|---|
| Alterações Codex | `codex-conversation.ts` transforma `item.changes` em caminhos dentro de `tool.detail`; não conserva os patches/tipos individuais | É impossível renderizar um diff histórico confiável só a partir do evento salvo |
| Alterações Claude | `claude-conversation.ts` expõe entradas/resultados genéricos de ferramentas; sem normalização por arquivo | Edit/Write parecem logs; intenção da ferramenta pode ser confundida com alteração aplicada |
| Atividades | `ThreadActivityGroup.tsx` agrupa tools consecutivas e mostra `details/pre` | Faltam entradas específicas de arquivo, resumo por turno, plano e perguntas |
| Markdown | `ThreadMarkdown.tsx` já tem GFM, tabelas, código e cópia; referências locais são spans | Formatação está resolvida na base; falta navegar para arquivos/linhas |
| Composição | `App.tsx` monta uma única `ThreadView`, sem workbench auxiliar | Sem revisão persistente ao lado da conversa ou sessões simultâneas |
| Review existente | Diff unificado/lado a lado, busca, revisado e comentários existem em `ReviewPane`/`DiffCard` | Reaproveitáveis, mas comentários hoje são enviados ao terminal do workspace |
| Escopo de review | `git.store.ts` indexa por workspace; atualização Git não carrega identidade de Thread/worktree no consumidor | Duas sessões em worktrees diferentes podem disputar a mesma seleção/cache |
| Git | Serviços de status/stage/unstage/commit/branches/worktrees e PR existem em `services/github/`; `git.service.ts` constrói diffs | Recursos do modo Code não contam como integração pronta na Thread; separar consultas locais da consulta GitHub/rede |
| Atualização Git | Watcher observa `.git/index`, deduplica por root e retém callback/base originais | Não acompanha todos os edits; `.git` em worktree pode ser arquivo; assinaturas múltiplas precisam multiplexação |
| Histórico | JSON completo por conversa; limites atuais de 2 MB/2.000 eventos antes de enviar, 4 MB/2.200 ao salvar; saves por evento | Adicionar patches inline agravaria custo e limite; armazenamento incremental vem antes de histórico rico |
| Operação | Modelos/esforço/permissões, assinatura, recuperação e diagnóstico de erros já existem | Refinar e integrar; não reimplementar como se estivessem ausentes |
| Limitações | Sem fila de prompts, anexos nos adapters, UI de perguntas/plano, voz no compositor e grid de Threads | Exigem contratos e comportamento real além da mudança de CSS |

Não extrapolar recursos da memória histórica: os achados acima foram conferidos no código desta sessão.

## 3. Decisões de arquitetura

### D01 — Um design system, diferentes composições

Usar `src/styles/tokens.css`, ícones Lucide, `DesktopDialog`, `DetailList` e primitivas Radix existentes. Compartilhar superfícies, tipografia, foco, divisórias, controles e ações com Code. Criar componentes de Thread para sua finalidade, sem transplantar CSS/Tailwind do cdesktop. Light/dark respeitam o tema selecionado; branco/preto das imagens não define uma paleta independente.

### D02 — Identidade de execução e escopo explícitos

Introduzir `ThreadTurn` com ID local, ID nativo opcional, sequência, início/fim, configuração efetiva, status e revisão. Toda atividade, patch, comentário, pergunta, prompt em fila e tarefa aponta para Thread/turno. Consultas de projeto usam contexto resolvido pelo main: `threadId + projectId + canonicalRoot + worktreeIdentity + scopeRevision`. O renderer não escolhe diretório/executável arbitrário por clicar em uma referência.

Estados visuais por célula são separados dos adapters: fechar painel/célula não mata a sessão; interromper exige ação específica. Dois modos podem observar o mesmo diretório, porém não dividir seleção, rascunho ou comando implicitamente.

### D03 — Eventos estruturados, projeção compatível

Manter leitura dos eventos antigos. Acrescentar envelope de execução e payloads tipados para arquivo, comando, resultado de teste observado, plano/todos, pergunta/aprovação, progresso público, subsessão e uso/contexto. Os adapters normalizam apenas campos públicos suportados por versão. Não acessar raciocínio privado nem inferir sucesso de testes a partir de uma frase do agente.

Codex: preservar cada entrada `fileChange` e seus patches/tipos/status; investigar eventos incrementais, plano e perguntas no schema instalado antes de habilitar. Claude: normalizar Edit/Write/MultiEdit e resultados, respeitando negação/falha. Capturar input de uma ferramenta não prova que ela editou o disco. Sem evidência suficiente, marcar alteração solicitada/aplicação não confirmada.

### D04 — Três fontes de alterações, com nomes claros

1. **Da ferramenta:** patch daquela operação, com resultado/status observado.
2. **Do turno:** comparação entre evidência/baseline de início e resultado final daquele turno; resumo deduplica arquivo e mede saldo, sem somar cegamente patches repetidos.
3. **Do projeto agora:** Git staged/unstaged/untracked, atualizado e datado, incluindo trabalho anterior ou de outros processos.

O diff histórico é imutável. O diff atual não pode substituí-lo silenciosamente. Alterações por shell, processo externo ou agente concorrente sem autoria demonstrável ficam como observadas durante o turno/autoria indeterminada. Não atribuir todo `git diff HEAD` à Thread. Git não cobre diretórios não Git, arquivos ignorados ou todo trabalho externo; aproveitar eventos de ferramenta e snapshots pontuais nesses casos.

### D05 — Persistência incremental com patches sob demanda

Criar tabelas de turnos/eventos/artefatos e índices por Thread/turno/seq. Patch/conteúdo ficam em artefatos referenciados, com hash, limites, indicador de truncamento e política de retenção; não duplicar no JSON da Thread. Atualizar o item/delta por ID com flush agrupado; persistir conclusão/aprovação imediatamente. Paginar e carregar diffs apenas quando abertos. Reinício recupera o que foi confirmado; não salva cada token como snapshot integral.

Migrar JSON legado de forma idempotente/transacional, mantendo caminho de leitura durante a transição. Arquivos novos deste plano terão migração numerada conforme o próximo número livre no checkout, não assumir `054`.

### D06 — Reutilizar o review, alterar o destinatário

Extrair renderização e comentários de `ReviewPane`/`DiffCard` para componentes que recebem escopo e callbacks. Code continua com seu comportamento. Thread adiciona comentário ao rascunho/fila da sessão correspondente, com arquivo, lado, linhas e revisão/hash do diff. Envio ao agente somente por ação do usuário. Âncoras ficam obsoletas quando muda o diff e pedem revalidação, sem comentário deslocado para outra linha.

Não acoplar Thread a `pasteIntoAgentTerminal`. Refatorar stores por contexto e multiplexar watchers/updates com escopo e geração para ignorar respostas atrasadas.

### D07 — Ferramentas auxiliares sem desviar o chat

Preview reutiliza o browser Electron existente; Files, editor e Git reutilizam serviços com escopo da Thread. Terminal é uma sessão de shell de projeto aberta explicitamente, em painel embutido e com ciclo de vida próprio. Não é o agente interativo nem fallback de slash; não toma posse do App Server. Logs exibem comandos/serviços com origem e erros sanitizados.

Retomar, mudar tamanho ou digitar `/` não inicia PTYs, processos, servidores nem inferência. Menus listam recursos antes de iniciá-los; Run/Preview server/Terminal são ações deliberadas e identificadas.

### D08 — Undo é uma operação verificável

Resumir arquivos e revisar vem antes de desfazer. Só oferecer Undo do turno com baseline, patches/snapshots suficientes e comparação do estado atual. Verificar arquivos, índice, branch, root e hashes; se houve mudança posterior, bloquear e explicar o conflito. Preservar alterações anteriores, não usar reset/clean para imitar a imagem. Inclusão, exclusão, rename, binários, permissões, staged e arquivos sem Git exigem política e testes próprios. Mostrar proposta exata antes da confirmação; registrar resultado/falha e recuperação de operação parcial.

Checkpoint atual de `github/checkpoints.service.ts` não basta: contém patch contra HEAD e nomes de untracked, não conteúdo anterior completo de todos os arquivos nem baseline do índice.

### D09 — Paridade por capacidade, provider e versão

Criar manifesto para cada recurso/comando, versão, API/equivalente, plataforma, implementação e teste. Retomar a pendência A06 do plano anterior. Catálogo/handler que só retorna indisponível não comprova paridade. Claude e Codex são a primeira dupla; Gemini/OpenCode/Hermes e presets/custom providers entram depois, com sessões, credenciais e catálogos independentes. Replicar o comportamento útil; Electron não precisa migrar para Rust/Tauri/browser para obter a mesma experiência de Thread.

### D10 — Contexto, quota e custos são coisas distintas

Uso/contexto/custo exibem origem e instante. Cartão persistente de quota aproveita a integração Codex atual; Claude só mostra o que sua API/CLI informar. Capacidade de contexto requer tokens/limite observados do modelo, não percentual fictício; custos de API não viram preço da assinatura. Sem fonte, indisponibilidade explícita.

## 4. Entregas e ordem

| Onda | Entrega visível | Passos | Condição de saída |
|---|---|---|---|
| W0 | Inventário fechado e contrato/protótipo visual | R01–R02 | Matriz por provider, geometria/estados revisáveis |
| W1 | Transparência dos arquivos na conversa | R03–R07 | Arquivos, patches e saldo verificáveis persistem sem destruir histórico |
| W2 | Changes/Files ao lado do chat e histórico fluido | R08–R10 | Conversa/compositor preservados, seleção e scroll estáveis |
| W3 | Revisão/Git completos e Undo seguro | R11–R14 | Comentários na mesma Thread; stage/commit e reversão isolados |
| W4 | Operação rica: planos, perguntas, fila, voz e preview | R15–R19 | Recursos reais, canceláveis e com contexto correto |
| W5 | Conversas simultâneas e equipes | R20–R21 | Até quatro células isoladas e subsessões rastreáveis |
| W6 | Rotinas, agentes/providers e fechamento de comandos | R22–R24 | Matriz de paridade sem recursos alegados a partir de placeholders |
| W7 | Auditoria e piloto integrado | R25–R26 | Provas visuais/funcionais reais e limitações publicadas |

Esforço abaixo é relativo (baixo/médio/alto), não uma estimativa de prazo. Etapas altas deverão virar tarefas menores após a descoberta de schemas/capacidades. Podemos entregar W1/W2 antes de completar toda a paridade, mantendo os demais itens explicitamente pendentes.

## 5. Passos com critérios de aceite

### R01 — research · Inventário de referência e protocolos · médio · dependências: nenhuma

Confirmar por feature a matriz PARITY: fonte local, UI/rota correspondente, status, versão instalada de cada CLI e limitações. Fixar hashes dos arquivos da referência/commit quando disponível. Verificar schemas de patches, plano, perguntas, uso e capabilities sem inferência; registrar separado o piloto de edição real.

Arquivos: `PARITY.md`; existentes `shared/threadCommands.ts`, `shared/threadDesktopCommands.ts`, adapters; novos manifestos `docs/plans/thread-workbench/capabilities.json` e `command-coverage.json`.

Aceite: cada recurso tem identidade, origem, handler/equivalente e cenário; nenhuma lacuna confundida com implementação. Verificação: revisão do manifesto + probes de descoberta + conferência de caminhos/versões.

### R02 — design · Composição e estados · médio · dependências: R01

Produzir protótipo local com temas do OXESpace, transcript realista, resumo de arquivos e Changes selecionado. Exercitar painel aberto/fechado, narrow, split e erros com as medidas de UI-SPEC. Definir hierarquia de menus sem acrescentar barras repetidas.

Arquivos: `UI-SPEC.md`, novos `preview.html`, fixtures e capturas nesta pasta; referência `src/styles/tokens.css`, Navigation e ThreadView.

Aceite: 900/1280/1600, light/dark, zoom, teclado e todos os estados descritos; reviewer distingue o protótipo da UI implementada. Verificação: capturas comparáveis às imagens e revisão visual.

### R03 — implement · Repositório incremental de turnos/eventos/artefatos · alto · dependências: R01

Introduzir envelope de turno, armazenamento normalizado e migração legada. Novos patches usam artefatos; preservar o contrato de leitura durante a transição. Separar eventos duráveis, projeção e notificações coalescidas.

Arquivos: `shared/types/thread.ts`, `electron/main/services/conversation/thread-manager.ts`, `electron/main/db/index.ts`; novos `thread-history.ts`, `thread-artifacts.ts` e migração `*_thread_history.sql`.

Aceite: migração roda duas vezes sem duplicar; interrupção/restart conserva ordem; escrita não serializa todo histórico a cada delta; limites controlados com mensagem clara. Verificação: SQLite sob ABI Electron, compatibilidade legada, crash/restart e medição de writes.

### R04 — implement · Alterações estruturadas Codex · médio · dependências: R01,R03

Preservar caminho anterior/novo, operação, patch, resultado e turno dos eventos nativos. Associar deltas e conclusão ao mesmo artefato. Rejeição/aprovação não podem aparecer como arquivo editado.

Arquivos: `codex-conversation.ts`, `shared/types/thread.ts`, novo `thread-change-normalizer.ts`; testes `codex-conversation.test.ts` e novos fixtures.

Aceite: add/modify/delete/rename, patch ausente/truncado e status falho/negado sobrevivem save/resume; referências externas não viram abertura de arquivo fora do escopo. Verificação: fixtures de schema + piloto de arquivo temporário.

### R05 — implement · Alterações estruturadas Claude · alto · dependências: R01,R03

Normalizar ferramentas Edit/Write/MultiEdit, resultado e aplicação confirmada. Preservar conteúdo antes/depois quando suficiente e marcar casos sem patch verificável. Definir coleta pontual de baseline compatível com a permissão e protocolo; não fazer crawl integral por tool.

Arquivos: `claude-conversation.ts`, normalizer e artifacts; `claude-conversation.test.ts` e fixtures novos.

Aceite: tentativa negada/falha não conta como alteração; repetição de tool/result não duplica; ausência de baseline é explícita; sessão retomada mantém o provider correto. Verificação: unit + piloto Edit/Write e negação.

### R06 — implement · Proveniência e resumo do turno · alto · dependências: R04,R05

Capturar estado anterior mínimo, produzir saldo consolidado por arquivo e diferenciar autoria observada/indeterminada. Modelar edição por comando, mudança externa e arquivo repetidamente editado. Não inventar narrativa de “por quê”: apresentar explicação pública do agente quando vinculada ao arquivo, ou somente patch/resultado.

Arquivos: novo `thread-change-tracker.ts`, history/artifacts, manager; DTO de alterações/turno.

Aceite: dirty inicial não é atribuído ao turno; edits repetidos contam arquivo uma vez; saldo final não soma linhas intermediárias; edits concorrentes são sinalizados. Verificação: integração com repositórios temporários, untracked, sem Git e concorrência.

### R07 — implement · Arquivos e resumo clicáveis no transcript · médio · dependências: R02,R06

Renderizar entradas específicas com nome relativo, operação/status, +/− reais, expansão inline e ação Open changes. Ao concluir, mostrar lista consolidada; referências locais de Markdown/code abrem arquivo/linha validado. Preservar comandos/output e resultados observados.

Arquivos: `ThreadView.tsx`, `ThreadActivityGroup.tsx`, `ThreadMarkdown.tsx`, CSS; novos `ThreadFileChange.tsx`, `ThreadTurnSummary.tsx`, `thread-presentation.ts`.

Aceite: card mostra dado faltante em vez de zero fictício; 12 tools ocupam um resumo; falha/aprovação não fica invisível; arquivo longo permite copiar caminho; legacy continua legível. Verificação: testes de projeção/UI e capturas; abertura inicialmente pode ser inline antes de R08.

### R08 — implement · Shell de painéis e Changes · médio · dependências: R02,R07

Montar workbench com conversa e painel auxiliar, catálogo com recursos disponíveis, fechar/redimensionar/expandir e estado por Thread. Selecionar arquivo histórico abre o artefato daquele turno; seletor permite trocar para estado atual. `/diff` abre Changes, sem modal de texto.

Arquivos: `App.tsx`, `ThreadView.tsx`, store; novos `ThreadWorkbench.tsx`, `ThreadPanelHost.tsx`, `ThreadPanelMenu.tsx`, `ThreadChangesPanel.tsx`, `thread-workbench.store.ts`.

Aceite: clique não tira a conversa; painel não inicia processo; fechar restaura foco; composer permanece visível; snapshot histórico conserva patch após edits posteriores. Verificação: Electron E2E em larguras/zoom do contrato.

### R09 — implement · Escopo de review, arquivos e updates · alto · dependências: R03,R08

Refatorar cache/seleção/assinaturas por contexto; adaptar diff renderers; árvore/editor Files usam raiz resolvida da Thread. Resolver git-dir real de worktrees e atualizações de índice/disco, com referência de assinantes, debounce e revisão. Não consultar GitHub/rede para abrir Changes local.

Arquivos: `git.store.ts`, `diff-comments.store.ts`, `shared/types/git.ts`, `shared/types/diff-comments.ts`, `git.service.ts`, `electron/main/ipc/git.ipc.ts`, `file-system.service.ts`, `ReviewPane.tsx`, `DiffCard.tsx`; novo `ThreadFilesPanel.tsx`/API de escopo.

Aceite: duas Threads no mesmo workspace, roots diferentes, não compartilham diff/seleção/comentários; respostas antigas ignoradas; rename/delete/untracked/binary/sem HEAD suportados; Code mantém comportamento. Verificação: integrações de escopo/watcher, UI Code+Thread e tipo/IPC.

### R10 — implement · Paginação, virtualização e scroll · alto · dependências: R03,R07,R08

Paginar turnos/artefatos e virtualizar com cauda de streaming estável. Restaurar âncora ao abrir diffs, carregar mensagens antigas e redimensionar painéis. Renderização e busca não podem exigir todo conteúdo de patches no renderer.

Arquivos: history, `thread.ipc.ts`, preload API, thread store; novos `ThreadTimeline.tsx`, `useThreadTimeline.ts` e testes de medição.

Aceite: fixture de 10.000 eventos carrega janelas; leitor acima não é puxado ao fim; nova mensagem e expansão de output atualizam o scroll somente quando seguindo; refresh durante seleção não perde âncora. Verificação: E2E de histórico e benchmark antes/depois; metas UI-SPEC medidas, não alegadas.

### R11 — implement · Comentários de revisão para Thread · médio · dependências: R09,R10

Enviar comentários por arquivo/lado/linha ao rascunho ou fila, com revisão do artefato e destinatário explícito. Estado Reviewed é privado da revisão e não altera stage.

Arquivos: `ReviewPane.tsx`, `DiffCard.tsx`, `diff-comments.store.ts`, `shared/types/diff-comments.ts`; novo `ThreadReviewActions.tsx`.

Aceite: nenhum comentário vai para terminal; envio explícito à mesma Thread; patch atualizado sinaliza âncora obsoleta; falha no envio preserva comentários. Verificação: testes de hash/âncora/envio e E2E por worktree.

### R12 — implement · Git local: status/stage/commit · médio · dependências: R09

Integrar serviços locais existentes, lista staged/unstaged/untracked, branch, contagens e mensagem de commit. Operações são explícitas, serializadas por worktree e atualizam o estado. Definir stage por arquivo primeiro, hunks depois de validar índice/revisão.

Arquivos: `services/github/repository.service.ts`, Git IPC/tipos/stores; novos `ThreadGitPanel.tsx` e adaptador de status local sem gh/rede.

Aceite: diretório não Git não mostra controles fictícios; operação concorrente tem estado claro; commit contém só staged exibido; nenhum stage/commit automático na conclusão do agente. Verificação: repos temporários com índice misto/sem HEAD/conflitos.

### R13 — implement · Push, PR e branches/worktrees · alto · dependências: R12

Integrar operações existentes de GitHub/branches/worktrees, sem confundir login de assinatura do agente com GitHub. Oferecer worktree isolada ao criar sessão; não mudar raiz de execução ativa. Push/PR/merge têm prévia de branch/remote/diff e resultado real.

Arquivos: `services/github/repository.service.ts`, `review.service.ts`, `shared/types/github.ts`, `src/components/Threads/ThreadSidebar.tsx` (NewThreadDialog), manager/projects; novos controles de branch/PR em ThreadGitPanel.

Aceite: não apagar worktree dirty; atualização de raiz troca contexto atomicamente; operações remotas somente por ação explícita; ausência de gh/login não bloqueia Git local. Verificação: integration para criação de worktree e testes mock de remoto; piloto remoto separado por autorização da execução.

### R14 — implement · Undo/checkpoints de turno · alto · dependências: R06,R12

Criar reversão a partir do baseline de turno, com plano de operação, verificação de hashes e índice e journal para falha parcial. Distinguir Undo de arquivos de rewind/fork da conversa.

Arquivos: tracker/artifacts/history; novos `thread-undo.ts`, `ThreadUndoDialog.tsx`; checkpoint service só após revisar contrato.

Aceite: preserva dirty inicial/staged; alterações posteriores bloqueiam reversão; rename/delete/untracked têm restauração demonstrada; falta de baseline não habilita Undo. Verificação: testes destrutivos somente em diretórios temporários, injeção de falhas e prévia UI.

### R15 — implement · Plan/todos, progresso e perguntas · alto · dependências: R01,R03,R08

Mapear plano/tarefas públicas e perguntas do provider para cartões interativos. Aprovação de comando/arquivo tem conteúdo específico e origem. Expor duração/estado do turno e últimas tarefas, sem tratar modo plan como plano produzido.

Arquivos: adapters, rpc-peer, shared/thread; novos `ThreadPlanPanel.tsx`, `ThreadQuestionCard.tsx`, `ThreadApprovalCard.tsx`, `ThreadTurnStatus.tsx`.

Aceite: respostas enviadas ao request/turno correto; cancelar/interrupt resolve request pendente; todos só atualizam por evento real; nenhum texto privado é exposto. Verificação: protocolos de pergunta/negação/timeout e UI retomada.

### R16 — implement · Fila, editar/repetir, fork e busca/export · alto · dependências: R03,R10,R15

Aceitar follow-up durante execução em fila visível, editável/cancelável, com snapshot de modelo/acesso/contexto. Definir envio após sucesso, interrupção e falha: por padrão pausa em erro/interrupt até ação explícita. Editar mensagem antiga abre proposta de retry/fork; nunca resetar arquivos como efeito implícito. Buscar mensagens/arquivos/turnos e exportar transcript com referências de alterações.

Arquivos: manager/history, `thread.store.ts`, thread/preload API; novos `thread-queue.ts`, `ThreadQueuedMessage.tsx`, `ThreadMessageActions.tsx`, `ThreadSearch.tsx`.

Aceite: fila não duplica após restart; trocar sessão não muda destino; retry preserva original; busca alcança histórico paginado; export real por diálogo de salvar. Verificação: SQLite/concurrency/E2E e cancelamento.

### R17 — implement · Composer: arquivos, imagens, menções e voz · alto · dependências: R01,R09,R15

Extrair ThreadComposer; adicionar seletor/drag-drop/paste de anexos e `@arquivo` com chips removíveis e orçamento. Mapear input estruturado onde o provider suportar, com limites e previews; fallback textual informado não simula suporte a imagem. Conectar `useOxeVoice` ao draft da Thread, preservando captura/cancelamento/erros descartáveis e shortcut sem roubar paste.

Arquivos: `ThreadView.tsx`, `shared/types/thread.ts`, adapters, `src/hooks/useOxeVoice.ts`, `VoiceHud.tsx`, App; novos `ThreadComposer.tsx`, `ThreadContextPicker.tsx`, `ThreadAttachmentList.tsx`.

Aceite: limites/MIME/paths são validados no main; anexos não mudam arquivos do projeto sem ação informada; envio/cancelamento/IME preservam draft; voz não reaparece após fechar; recursos unsupported têm motivo. Verificação: input nativo e testes de permissões/cancel/race/paste.

### R18 — implement · Painéis Preview/Terminal/Logs · alto · dependências: R08,R09

Reutilizar browser e PTY, separar ciclo de vida de ferramenta do adapter. Run scripts/configuração de URL resolvem contexto correto e exibem origem. Preview com controles/devtools/inspeção já existentes; logs sanitizados, filtros e tarefas background só onde observáveis.

Arquivos: `WebPreviewPanel.tsx`, `WorkspaceWebPreviewPanel.tsx`, `terminal.service.ts`, terminal IPC, services de scripts; novos `ThreadPreviewPanel.tsx`, `ThreadTerminalPanel.tsx`, `ThreadLogsPanel.tsx`.

Aceite: abrir menu não inicia shell/servidor; abrir terminal é deliberado e embutido; slash não usa ferramentas auxiliares; fechar painel tem política clara de processo continuar/parar; Code continua funcionando. Verificação: processos abertos/fechados sob E2E e isolamento de cwd/resources.

### R19 — implement · Sidebar e indicadores persistentes · médio · dependências: R09,R10,R15

Refinar sidebar compartilhada, recentes/More, status acessível, branch e ações contextuais. Mostrar quota/reset atual por conta, contexto observado e detalhes da execução no lugar apropriado; aproveitar ThreadFailureCard existente. Configurações efetivas e pendentes permanecem distintas.

Arquivos: `ThreadSidebar.tsx`, `ThreadConfigurationBar.tsx`, `ThreadFailureCard.tsx`, account/model stores, Navigation; novo `ThreadUsageBadge.tsx` e DTO de token/contexto quando disponível.

Aceite: largura/rodapé iguais ao Code; seleção não muda ordem a cada token; quota tem fonte/horário; ausência Claude não vira zero; tema e indicadores não dependem só de cor. Verificação: UI light/dark e cache de contas/contextos.

### R20 — implement · Grid de duas a quatro Threads · alto · dependências: R09,R10,R16,R18

Separar seleção global, foco por célula e snapshot por Thread. Oferecer dividir horizontal/vertical e drag de sessão, com alternativa de teclado, usando resizable-panels instalado. Fechar célula mantém execução e histórico; shortcut envia somente ao compositor focado.

Arquivos: `App.tsx`, `thread.store.ts`, `thread-workbench.store.ts`; novos `ThreadSessionGrid.tsx`, `ThreadSessionCell.tsx`, `thread-grid.store.ts`.

Aceite: duas/quatro sessões com drafts, painel, root, scroll e uso independentes; a mesma sessão em duas células é uma única execução; narrow/zoom não comprimem quatro compositores; reload restaura layout. Verificação: concurrency e E2E de foco/cancel/drag/restart.

### R21 — implement · Subsessões/equipes e tarefas background · alto · dependências: R15,R20

Expor sessões filhas/tarefas e delegação na Thread, reutilizando serviço de delegação existente quando compatível. Incluir origem, provider, root/worktree, estado, resultados e links de abrir. Equipe autoriza uso compartilhado/isolado explicitamente e não nasce de abrir painel.

Arquivos: `services/delegation.service.ts`/submódulos existentes, `shared/types/delegation.ts`, adapters e history; novos `ThreadTeamPanel.tsx`, `ThreadSubsessionEntry.tsx`.

Aceite: agente pai/filho conservam sessões nativas distintas; cancelamento alcança alvo certo; nenhuma incorporação/merge automático; conclusão não implica commit; outputs públicos e uso disponíveis têm origem. Verificação: lifecycle/falhas e piloto delimitado de delegação.

### R22 — implement · Rotinas e templates de prompts · alto · dependências: R03,R13,R16,R21

Criar modelos manuais e agendamento com timezone, janela/next-run e histórico. Cada execução gera sessão rastreável, com política de worktree, concorrência e falha/autenticação. Definir se roda só com app aberto; serviço headless é entrega distinta, não promessa implícita.

Arquivos: novos `thread-routines.ts`, `ThreadRoutinesPanel.tsx`, `ThreadRoutineDialog.tsx`, tipos/IPC/migração; reusar executor/scripts quando compatível.

Aceite: pausa/cancel/desativar confiáveis; sem execução duplicada ao retomar app; limites de concorrência; prompt/configuração versionados; nenhuma publicação/merge automática por rotina padrão. Verificação: fake clock, timezone/DST, restart e UI.

### R23 — implement · Agents/providers e integrações completos · alto · dependências: R01,R15,R17,R21

Ampliar adapters/capabilities para Gemini/OpenCode/Hermes e configurações por agente; providers/presets/custom endpoint seguem protocolo de cada runtime, sem prometer endpoint intercambiável. Completar gestão/autenticação de MCP/apps/plugins/skills/hook/memória com catálogo, formulário, aplicar/testar/cancelar e diagnóstico.

Arquivos: runtime, account/model/command services, `shared/types/thread.ts`, Settings Agents; novos adapters/manifestos e painéis de integração.

Aceite: transcript/modelos/credenciais separados; cadastro real persiste configuração autorizada e comprova conexão; catálogo não equivale a integração funcional; subscription continua disponível para Claude/Codex. Verificação: testes por capability/versão e piloto por runtime antes de chamar paridade.

### R24 — implement · Paridade de comandos e ciclo de sessão · alto · dependências: R01,R13–R19,R21–R23

Fechar manifesto do plano anterior com handlers/equivalentes, import de sessões externas e divergências de plataforma documentadas. Unificar ação de menu, botão e slash no mesmo executor. Remover bridge legado só quando recovery/import já estiverem cobertos; não remover terminais Code nem Terminal de projeto.

Arquivos: `shared/threadCommands.ts`, `shared/threadDesktopCommands.ts`, `thread-commands.ts`, manager, `native-session-history.ts`, IPC/preload, manifestos.

Aceite: cada comando suportado tem efeito observado, scope e teste; digitar slash não cria processos/toma foco; comandos desconhecidos nunca chegam como prompt literal; import preserva provider/ID/contexto. Verificação: matriz individual, tests de protocolos e E2E.

### R25 — test/verify · Piloto integrado e regressões · alto · dependências: R07–R24

Consolidar testes rastreados à matriz e capturas: Code e Thread, múltiplas raízes, schemas reais, dirty prévio, conflitos, filesystem e sessões. Meta de desempenho após baseline; medir startup e writes durante streaming, não só agrupamento visual. Provar edição real por provider em repositório temporário com acesso permitido, além de mocks.

Arquivos: `tests/`, `tests/integration/`, `e2e/thread-view.spec.ts` e novos E2Es workbench/grid; ferramentas de benchmark existentes; relatório VERIFY nesta pasta.

Aceite: typecheck, lint sem novos erros, build/budgets, testes de regressão e piloto por feature/provider; bugs bloqueadores do primeiro lote corrigidos antes de avançar onda. Verificação: comandos reais de §7, evidências por estado e execução.

### R26 — document · Auditoria final e status honesto · baixo · dependências: R25

Atualizar `docs/thread-view.md`, PARITY e IMPLEMENTATION com captura, versão, resultado e limites. Separar pronto/parcial/indisponível/proposto; não declarar toda paridade com W1/W2 concluídas.

Arquivos: `docs/thread-view.md`, `PARITY.md`, novos `IMPLEMENTATION.md`/`VERIFY.md` nesta pasta e manifestos de capacidade/comandos.

Aceite: cada feature aceita tem prova; pendências têm ação; fontes locais/upstream reconciliadas. Verificação: revisão documental e conferência de arquivos/links.

## 6. Critérios globais de aceite

- A01: usuário identifica quais arquivos foram alterados por ferramenta/turno e quais mudanças pertencem ao estado atual do projeto; autoria incerta é explícita.
- A02: todos os caminhos e +/− exibidos correspondem a evidências; patches históricos não mudam ao recarregar a Thread.
- A03: abrir arquivo na conversa seleciona o diff/arquivo correto sem substituir transcript/compositor; referências fora do contexto têm explicação.
- A04: plano, status, perguntas, aprovações, testes e falhas têm renderers específicos, dados reais e comportamento cancelável.
- A05: sidebar, modais, menus, painéis e controles compartilham design system com Code; light/dark, foco/hover/seleção e densidade consistentes.
- A06: painel direito, split e zoom obedecem UI-SPEC; sem scroll horizontal global, sobreposição de composer ou saltos de leitura.
- A07: sessão/worktree conta/provider/turno e destinatário de comentário/fila nunca se misturam, inclusive com respostas atrasadas e restart.
- A08: Git/Undo operam somente sobre escopo/revisão conferidos; preserved dirty inicial/índice; Undo de arquivos e rewind do chat são ações diferentes.
- A09: nenhum slash/menu/seleção abre Advanced CLI ou janela de shell; Terminal auxiliar só por ação explícita e embutida.
- A10: ausência de suporte/reset/contexto/diff não vira dado fictício ou controle que aparenta funcionar.
- A11: recursos da matriz e comandos têm comportamento testado; diferenças de runtime/plataforma ficam identificadas.
- A12: piloto integrado e auditoria visual aprovam cada entrega; mock, fonte presente e execução real são provas distintas.

## 7. Verificação prevista

Durante implementação: unit/renderer sob `npx vitest run <testes>`; SQLite/native sob `npm run test:electron -- <testes>`; schemas/CLIs com smoke opt-in sem inferência quando descoberta. Testes de edição real e Git usam somente diretórios temporários. E2E Electron após build.

Gate: `npm run typecheck`, ESLint dos arquivos afetados e lint de regressão, `npm run build`, `npx playwright test e2e/thread-view.spec.ts` + specs novas. Preservar budgets atuais; o entry main tem pouca folga (última validação 902/904 kB), então lazy-load workbench/adapters/painéis e medir. Não aumentar orçamento só para esconder regressão.

Capturas: 900×600, 1280×800, 1600×1000; light/dark; sidebar 240/248/360/collapse; painel aberto/fechado; zoom 125/150%; duas/quatro células; empty/streaming/erro/perguntas/conflito. Artefatos e relatório registram fixture versus execução real.

## 8. Riscos e mitigação

| Risco | Mitigação concreta |
|---|---|
| Somar edits repetidos ou atribuir dirty existente ao agente | Baseline/proveniência; saldo consolidado; fonte e incerteza visíveis |
| Patches fazem histórico atingir o limite/congelar | Artefatos sob demanda e armazenamento incremental antes da UI rica |
| Cache/updates misturam worktrees | Escopo canônico + geração, payloads filtrados, listeners multiplexados e testes concorrentes |
| Reverse patch perde trabalho do usuário | Hash/revisão/índice, prévia, block on conflict, journal e testes com dirty anterior |
| Split exige refatoração global de seleção e atalhos | Snapshot por Thread, estado por célula, foco explícito; preservar consumidores Code |
| Protocolo ou versão não entrega os dados desejados | Schema/capabilities versionados, equivalente testado ou lacuna declarada |
| Novos providers/configs expõem segredos em logs | Campos selecionados/sanitizados, armazenamento de credenciais já adotado pelo app; sem serializar configs brutas |
| UX vira excesso de barras, ícones e cartões | Uma toolbar de contexto; atividades compactas; detalhes expandíveis; rótulos consistentes |
| Processo auxiliar assume a sessão do agente | Terminal de shell separado, sem lease do adapter, lifecycle e cancelamento próprios |
| Teams/routines geram recursos sem controle | Criação deliberada, concorrência limitada, pausa/cancel/next-run explícitos |
| Copiar código adiciona acoplamento/licença/dependências | Reimplementar a experiência no stack existente; se houver cópia futura, registrar arquivo/origem/NOTICE da licença identificada |

Escopo desktop local: não inclui migração do app Electron para Tauri nem publicação de um servidor remoto/mobile. São projetos separados; não necessários para a paridade da experiência de Thread desktop pedida. Integrações que exigem GitHub/rede continuam deliberadas. Nenhum commit, push, PR, rotina ou subprocesso de referência foi iniciado por este planejamento.

## 9. Próximo início recomendado

Iniciar R01/R02 e a fundação R03, depois executar R04–R07 para trazer arquivos/patches reais à conversa. Entregar R08/R09 como primeiro workbench de Changes/Files. A primeira demonstração deve usar um turno com três arquivos (um já dirty antes), edição repetida, arquivo novo e falha/negação: a UI precisa explicar o que aconteceu sem exigir que o usuário leia JSON de ferramenta.

Planejamento salvo no repositório: o CLI `quadflow` previsto na skill não está disponível neste ambiente. Não foram criadas entradas em serviço externo.
