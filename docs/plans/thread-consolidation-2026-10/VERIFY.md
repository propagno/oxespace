# Estado de verificação

Data: 2026-10-04. **Implementação parcial; não apto a certificar consolidação completa.**

## Implementado e verificado

- V01: retorno de foco de Project settings após Escape corrigido no DesktopDialog. A mesma extensão Playwright que falhava passou. Modal conserva header/footer e permite rolar seu corpo.
- Nova thread elimina o select nativo de projeto, mostra caminho completo, permite pesquisar/trocar por opções e compartilha ícones de agentes com Code. Evita novo submit/fechamento enquanto cria.
- V02/V03: corrigidos Failed e textos selecionados em Changes; botões principais da Thread, expandir diff, comentar e update agora têm alvos de pelo menos 28 px. Ainda não equivale a todos os controles do produto.
- Leitor Codex reverso: até 8 MiB de leitura por página, aproximadamente 2 MiB de payload público, cursor vinculado ao arquivo/snapshot, detecção de truncamento/substituição e preservação do snapshot durante append. Fingerprints de início/fim não provam ausência de qualquer modificação arbitrária no meio de um arquivo maior.
- Migração 060 separa páginas anteriores da sequência de eventos ao vivo. Carregamentos concorrentes coalescidos; exportações incluem páginas importadas; recuperação/relink/rewind descartam páginas obsoletas; fork inicializa cursor do arquivo correspondente.
- Refresh da store preserva o cursor nativo negativo quando novos eventos chegam. Teste cobre prefixo carregado durante atualização do trecho recente.
- Diagnostics possui Check provider state. Codex consulta thread/read sem turns e thread/turns/list com itemsView notLoaded, compara ID reconhecido e distingue ativo/aguardando/terminal/desconhecido. Não reenvia e não inventa resultado local. Estado confirmado do provedor e journal local ainda podem divergir até implementar a importação da saída faltante.

## Evidências executadas

- Typecheck e build com limites de bundle aprovados.
- Lint: 0 erros, 33 avisos existentes nas áreas indicadas pela ferramenta.
- Suíte completa Electron: 1.120 aprovados, 25 ignorados, 1 falha na lista arquitetural de acesso ao filesystem. Lista atualizada para o leitor somente de leitura de arquivos do provedor; repetição direcionada passou (allowlist + preload, 8 testes). A suíte completa não foi repetida depois dessa atualização.
- 117 testes direcionados de adapter/histórico/migração/manager/IPC passaram; teste adicional de cursor da store e teste do novo IPC também passaram. Estes números se sobrepõem; não somar como testes distintos.
- Playwright: thread-view, thread-session-actions e thread-project-navigation aprovados. Última rodada: 3/3, 2,2 min, executada junto da suíte de testes. Rodada anterior isolada: 50 s. A duração concorrente não é benchmark de performance do produto.
- 40 checkpoints instrumentados, nenhum overflow da página. Teste de Diagnostics exercita estado desconhecido simulado e apresentação do resultado. Nenhuma inferência real nessa campanha visual.
- Inspeção visual direta de Project settings e Diagnostics confirma corpo/footer contidos e resultado da consulta legível no drawer.
- Arquivo nativo real da sessão longa: primeira página 53,8 ms; todas as páginas 5.302,3 ms; 91 páginas, 1.166 mensagens públicas elegíveis, nenhum ID duplicado; cinco páginas vazias; pico RSS amostrado 97,8 MiB. [Medição](native-history-benchmark.json). Sem inferência nem aplicativo instalado. Mensagens filtradas pelo importador (meta/tools/thinking/oversized) não integram esse total.

## Pendências que impedem declarar conclusão

- Claude agora pagina a linhagem em worker (detalhes abaixo), mas registros gigantes que contenham elos de ancestralidade e arquivos com pais fora da ordem exigem tratamento adicional. Importações Codex antigas sem cursor ainda exigem estratégia de migração segura. Falta estratégia para texto público acima do limite atual de mensagem.
- Consulta de estado é apenas uma parte da reconciliação: falta recuperar output/requests e fechar journal com evidência, reconectar de forma passiva após reinício e cobrir Claude. Não confundir observação terminal com recuperação completa.
- Manifesto efetivo por versão/autorização e invalidação ainda pendente.
- Sessão longa no aplicativo instalado, campanha completa real dos dois provedores e soak de duas horas não executados nesta etapa.
- Permanecem candidatos de contraste em horários, motivos de aprovação e rótulos de resposta; controles Code/resize/radios precisam avaliação separada de alvo efetivo. Densidade compacta e estados completos dos painéis ainda pendentes.
- Nenhuma certificação visual 100%, nenhuma nova versão instalada ou release é reivindicada.

## Continuação verificada

- Densidade compacta opcional, persistida em `oxe.navigation`, mantém a opção confortável e ícones/estado do agente. Playwright confirma linha de no máximo 40 px e preferência salva. Inspeção visual direta aprovada no estado de 71 conversas.
- Última execução de thread-view: 30,6 s (32,3 s total), 41 checkpoints, sem overflow. [Medições finais](measurements-implemented.json). O coletor passou a entender `color(srgb ...)`; não confundir ausência de candidatos com certificação de todos os backgrounds/transparências. Restaram dois candidatos "Just now" do Code a 4,1:1; nenhum candidato de texto da Thread nesse recorte final.
- 47 testes de navegação/Thread UI/Code Sidebar passaram após adicionar a densidade. Build com limites de bundle e typecheck passaram.
- Codex real, sessão curta isolada: nova e resume concluíram. O primeiro probe encontrou journal persistido `interrupted` durante execução; consulta ajustada para priorizar estado ativo do runtime, e divergência vira desconhecido. Repetição real: novo turno `unknown` durante transição inicial e `completed` ao terminar; resume `running` e depois `completed`. [Probe inicial](native-observation-probe-initial.json), [repetição corrigida](native-observation-probe.json). 26 testes do adapter também passaram após a correção. Não comprova recuperação da saída perdida nem sessão longa instalada.
- Claude Code real 2.1.287: probe falhou em 1,76 s com erro `authentication`, antes de resposta. [Evidência](native-claude-probe.json). Usuário avisado da necessidade de conectar a conta para a campanha real; demais pendências continuam independentes dessa autenticação.
- Aviso de histórico foi ajustado para orientar carregar mensagens anteriores dentro da Thread quando existe cursor nativo. O fallback antigo continua identificado quando essa paginação não está disponível.

## Paginação Claude e isolamento da leitura

- Removido o importador Claude que mantinha um mapa limitado das últimas entradas. A paginação reversa acompanha uuid/parentUuid entre páginas e exclui ramos abandonados. Teste com 26.000 registros intermediários e recriação do leitor entre páginas preserva apenas a ancestralidade selecionada.
- Decisão técnica: para arquivos append-only com pais anteriores aos filhos, o cursor guarda o próximo ancestral e substitui a necessidade de construir um índice completo antes da abertura. Não foi implementado um índice para arquivos fora dessa ordem; ancestral ausente produz erro explícito, preservando o conteúdo importado.
- Codex e Claude usam um worker de produção para leitura/parsing, com limite de heap, fila limitada e encerramento determinístico. Queda rejeita chamadas pendentes; a próxima solicitação explícita inicia outro worker. Não ocorre reenvio de mensagens ao agente.
- Carregar anteriores atravessa até quatro páginas sem texto público por solicitação. Cursor é persistido a cada avanço. A interface apresenta erro/retry local ao histórico; uma resposta tardia não desloca a rolagem de outra conversa.
- Suíte Electron completa atual: **1.126 aprovados, 25 ignorados, zero falhas**, em 97,01 s. Um teste posterior adicional de recuperação após crash passou junto dos outros dois testes do worker (3/3). Os totais se sobrepõem.
- Playwright com handlers de produção e arquivo Claude sintético: 1.200 mensagens, reinício antes de carregar páginas antigas, continuação pelo cursor persistido, segundo reinício após carregar tudo e nenhum workspace Code criado. Execução de persistência: 5,8 s (7,1 s total). Não é inferência Claude nem validação no instalador distribuído.
- Validação final: typecheck, build e limites de bundle passaram; lint com zero erros e 33 avisos preexistentes; `git diff --check` sem erro. Playwright: histórico nativo (incluindo abertura visual no fim e ausência de overflow horizontal) e thread-view, 2/2 aprovados em 40,3 s. A conversa permaneceu utilizável nos estados cobertos, sem equivaler a todos os fluxos da matriz.
- Sessão Codex longa real, via worker de produção: primeira página 99,8 ms; leitura das páginas públicas elegíveis 5.102,9 ms; 92 páginas, 1.181 mensagens, zero IDs duplicados, cinco páginas vazias. Maior intervalo do timer de 10 ms no processo chamador: 23,6 ms; RSS amostrado do processo incluindo worker: 117,9 MiB. [Relatório](native-history-worker-benchmark.json), [probe reproduzível](probe-history-worker.mjs). O arquivo cresceu desde o benchmark anterior; estes totais não são uma comparação fixa de corpus. Sem inferência e sem teste do aplicativo instalado.

## Consulta passiva após reinício

- Diagnostics pode consultar um turno Codex salvo mesmo sem adapter conectado. Processo independente apenas inicializa o protocolo e usa `thread/read` sem turns e `thread/turns/list` sem itens. Valida sessão/diretório, procura o turno reconhecido em até três páginas, limita concorrência e tempo. Não usa resume/start/interrupt/submit.
- Estados persistidos `interrupted`/`inProgress`, desconhecidos ou em conflito com sessão ativa não viram conclusão confirmada. Claude permanece sem consulta passiva verificada; não inicia processo para fingir suporte.
- Shutdown cancela consultas passivas e fecha o adapter antes de esperar consultas conectadas. Resultados atrasados após encerramento ou mudança de identidade/geração/turno não são persistidos. Nova execução remove a observação anterior.
- Encerramento/reinício mantém o turno local interrompido, mas registra resultado nativo desconhecido. Ferramentas e arquivos sem retorno passam para `unknown` em vez de `failed`. Pedidos locais são invalidados, fila ambígua não é reenviada.
- 55 testes direcionados aprovados (9 do leitor passivo, 46 do manager), incluindo persistência após reinício, ausência de replay e consulta pendente no fechamento. Typecheck aprovado.
- Protocolo Codex real, sessão longa existente: turno anterior confirmado `completed` em 793,7 ms; turno em outro runtime ficou `unknown` em 744,2 ms. Apenas initialize/initialized/read/turns-list executados, sem inferência/resume. [Turno concluído](native-passive-completed-probe.json), [turno não confirmado](native-passive-state-probe.json), [probe](probe-passive-state.mjs).
- **Limite:** consulta de resultado não importa output/requests ausentes nem encerra operações locais. A reconciliação completa e a campanha no instalador continuam pendentes.
- Regressão completa desta etapa: 1.136 testes passaram, 25 ignorados e duas expectativas antigas do corpus de falhas ainda exigiam `failed` após restart/shutdown. Atualizadas para exigir `unknown`, ambas passaram na repetição direcionada; a suíte inteira não foi repetida após essa atualização.

## Transparência durante silêncio

- Conversa visível Codex com turno reconhecido consulta o estado após 60 s sem sinal, com esperas seguintes de 120 e 240 s e limite de três consultas por sinal/turno. Pergunta pendente, ausência de ACK e Claude não iniciam essa consulta. Não há retry de prompt nem conclusão local automática.
- Cartão expõe consulta em andamento, execução confirmada, espera por input, término com saída local ainda não reconciliada ou resultado desconhecido. Após silêncio, o título não afirma que está escrevendo apenas porque existe texto anterior.
- Quatro testes do hook cobrem temporização/limite, término confirmado, troca de conversa com resposta tardia e exclusão de perguntas/turnos sem ACK. Com os 39 testes da Thread UI, 43 aprovados. Repetição conjunta leitor passivo/corpus/hook: 15 aprovados (totais sobrepostos).
- Playwright histórico nativo e Thread: 2/2 em 43,7 s. Novo cenário força silêncio de 70 s, confirma o aviso de resultado desconhecido, preservação do rascunho e Stop. Inspeção visual direta em 900 px confirmou contenção e legibilidade; motivou o ajuste adicional de título descrito acima.
- Após o ajuste final de título: build/bundle aprovados; Playwright Thread repetido com asserção explícita do título de incerteza, aprovado em 28,8 s (30,4 s total). Testes de atividade/hook: 6/6. Typecheck e lint direcionado sem erros.

## Recuperação da resposta pública de turno fechado

- Schema gerado localmente pelo Codex instalado confirma `thread/items/list`, filtro `turnId` e retorno `{turnId,item}`. Consulta passiva agora pode percorrer todas as páginas do turno terminal, extraindo somente `agentMessage.text`; não importa raciocínio privado.
- Limites: 40 páginas de 25 itens, deadline compartilhado de 15 s, frame RPC finito, 256 KiB por mensagem pública e 2 MiB retidos. Página inválida, cursor repetido, turno incorreto, pergunta estruturada embutida ou excesso de limite não produzem commit parcial. O resultado terminal fica visível com explicação de recuperação incompleta.
- Após restart/conexão fechada e sem execução local, Check provider state recupera textos ausentes, substitui respostas parciais pelo ID nativo e preserva ordem pública. Não usa hash de texto, não drena a fila, não inicia inferência nem disputa sessão. Resultado de ferramentas sem evidência individual permanece `unknown`.
- Persistência de eventos/turno e reconciliação explícita da operação local ocorrem na mesma transação. Identidade nativa, diretório, geração e turno são revalidados antes do commit. Snapshot é clonado; consultas repetidas não duplicam a resposta. Estado sobrevive a novo restart.
- Protocolo real na sessão longa: recuperação de 8 mensagens públicas, 2.762 bytes, cinco páginas, 955,4 ms. Sem inferência, resume ou escrita na sessão nativa; o probe apenas leu e descartou os textos, registrando contagens. [Evidência](native-output-recovery-probe.json).
- 75 testes direcionados aprovados (reader, merge, manager, histórico), incluindo texto parcial, ordenação, repetição, persistência, fila intacta e mudança de sessão durante consulta. Typecheck/build/bundle aprovados; lint direcionado sem erros.
- **Ainda parcial:** recuperação de resultados individuais de ferramentas, perguntas/aprovações, caso conectado com evento terminal perdido, Claude e cobertura acima dos limites permanecem abertos. Recuperação pública após conexão fechada não equivale a reconciliação universal.
- Regressão Playwright desta etapa: Thread e histórico nativo, 2/2 aprovados em 39,1 s. Guarda posterior recusa merge quando uma resposta local não existe nas páginas recebidas; 50 testes de merge/manager passaram após essa guarda. O Playwright não representa recuperação com inferência no aplicativo instalado.

## Recuperação de resultados individuais — 2026-10-05

- A leitura do turno terminal agora recupera commandExecution, fileChange, mcpToolCall e dynamicToolCall junto das mensagens, pela ordem dos IDs nativos. Cada ferramenta exige sua própria evidência de conclusão; término do turno não transforma ferramentas desconhecidas em sucesso. Exit code não zero e recusa são falha; estado não confirmado permanece desconhecido.
- Saída textual tem limite com marcador explícito de truncamento. Argumentos, raciocínio privado, imagens e metadados internos não são importados. Patches seguem o armazenamento de artefatos existente, com autoria do provedor; não são expostos crus no resultado da consulta. Limites de páginas, bytes e identidade continuam atômicos: recuperação inválida não grava parte do resultado.
- Merge preserva metadados locais e resultado individual já confirmado quando a nova evidência é desconhecida. Permite completar ferramentas desconhecidas de um turno cuja resposta pública já foi recuperada, sem duplicar itens nem reenviar a fila.
- Protocolo real da sessão longa: oito mensagens públicas e 60 registros de ferramentas em cinco páginas, 1.299,8 ms. Apenas leitura; sem inferência, resume ou validação do instalador. [Contagens do probe](native-tool-recovery-probe.json).
- Suíte Electron completa: **1.158 aprovados, 25 ignorados, zero falhas**, 122,29 s. Typecheck, lint direcionado, build/limites de bundle e diff check aprovados. Playwright Thread e histórico nativo: 2/2 aprovados.
- **Pendências:** perguntas/aprovações ausentes, evento terminal perdido com conexão ainda ativa, Claude, respostas acima dos limites e campanha real no aplicativo instalado. Este avanço substitui a pendência de ferramentas dos registros anteriores somente para os quatro tipos e o fluxo de turno fechado descritos aqui.

## Consulta conectada e preservação da leitura — 2026-10-05

- Adapter Codex pode observar completed/failed quando o evento terminal foi perdido: exige sessão idle antes e depois da consulta ao turno exato, nenhum pedido pendente e nenhum novo sinal nativo durante a consulta. Interrupted provisório continua desconhecido. Essa observação não encerra o turno local nem reenfileira input.
- Turno local já encerrado com ferramentas desconhecidas pode recuperar sua evidência sem fechar a conexão. O resultado passivo exige confirmação posterior pelo adapter conectado; mudança de estado/identidade preserva o conteúdo local. Fila não é drenada e o adapter não é descartado.
- 80 testes direcionados de adapter/manager aprovados, incluindo volta a active entre leituras, sinal novo durante confirmação e conflito entre recuperação passiva e estado conectado. Typecheck e lint direcionado aprovados.
- O primeiro Playwright passou histórico nativo, mas encontrou deslocamento de 25 px ao voltar Code → Thread; repetição isolada passou em 29,9 s. O código ainda recalculava a janela virtual com o container oculto e altura zero. Adicionada guarda para conservar a janela visível anterior; teste de ocultar/reexibir preservando as mesmas linhas passou. Não foi ampliada a tolerância do E2E. Essa guarda elimina o caminho de altura zero; não demonstra sozinha a origem de toda oscilação intermitente.
- **Limite explícito:** caso ainda ocupado passa a ter observação terminal confirmada, mas liberação do turno local com evento perdido continua pendente de integração atômica com pedidos, checkpoints, alterações e fila. Nenhuma campanha real no instalador foi realizada nesta etapa.
- Após a guarda de visibilidade: build/bundle aprovados; três execuções consecutivas do Playwright Thread aprovadas (30,2 s, 28,5 s e 29,7 s; 1,5 min total), preservando tolerância de 4 px. Não equivale ao soak de duas horas nem à certificação visual de todos os estados.

## Liberação do turno com evento final perdido — 2026-10-05

- Turno Codex local ainda ocupado pode recuperar a saída pública e liberar o adapter após confirmação conectada e leitura passiva. O adapter guarda evidência por ID/estado/revisão de sinais e executa a transação síncrona antes de liberar sua ocupação. Falha de gravação mantém o turno ocupado e permite nova consulta; novo sinal invalida a evidência.
- Persistência de eventos, turno e operação ocorre na mesma transação. Perguntas/aprovações pendentes impedem esse caminho: não são inventadas respostas nem invalidados pedidos para forçar conclusão. Saída incompleta não libera o turno. Ferramentas sem resultado individual ficam desconhecidas.
- Checkpoint e comparação do working tree são finalizados sem drenar a fila; anexos concluídos seguem a liberação existente. Eventos atrasados com o ID do turno recuperado são ignorados pelo adapter (retenção limitada aos últimos 32 IDs). Próximo envio depende de ação explícita.
- Testes cobrem commit recusado, rollback por falha SQL, recuperação incompleta, sinal novo, evento final atrasado, pedido pendente, fila intacta e checkpoint/working tree em repositório Git temporário. Rodada inicial: 103 testes aprovados; depois 56 testes do manager aprovados com o caso Git adicional (totais sobrepostos). Typecheck, lint direcionado, build/bundle e diff check passaram.
- Playwright: histórico nativo com reinício e Thread completos, 2/2 aprovados em 44,6 s.
- **Protocolo nativo real:** sessão Codex curta isolada, primeira inferência concluída com seu evento final deliberadamente descartado; observação completed, uma mensagem recuperada, commit e liberação confirmados, zero conclusão local prematura, somente um envio antes da próxima ação explícita. Segunda inferência explícita também concluiu. [Relatório](native-live-recovery-probe.json), [probe](probe-live-recovery.mjs). O callback de persistência do probe é instrumentado; a transação real é coberta nos testes do manager. Não é a sessão longa nem o aplicativo instalado.
- Permanecem pendentes Claude, recuperação de perguntas/aprovações ausentes, casos acima dos limites e campanha completa no instalador. A recuperação ligada a esta evidência substitui a pendência de liberação conectada descrita na etapa anterior, sem declarar reconciliação universal.
- Regressão completa final: **1.172 testes aprovados, 25 ignorados, zero falhas**, 108,77 s (181 arquivos aprovados, seis ignorados).

## Perguntas históricas embutidas — 2026-10-05

- Schema local AsyncUserInputQuestion contém somente title/options. Perguntas embutidas em agentMessage de turno terminal passam a ser recuperadas como historicalQuestions, sem criar pedido RPC, inferir resposta ou oferecer controles de resposta. O caso antes abortava toda a recuperação. Pedidos interativos pendentes continuam impedindo liberação do turno.
- Parser valida formato e limites (20 perguntas, 50 opções por pergunta, 8.192 caracteres por título/opção e orçamento total da recuperação). Entrada inválida ou conteúdo divergente entre páginas continua rejeitando recuperação parcial.
- Bloco visual exibe todas as perguntas/opções e “Answer not confirmed”, inclusive em mensagem sem texto. Copiar, exportação Markdown e pacote portátil preservam conteúdo e incerteza.
- 63 testes direcionados aprovados; após ajuste de copiar e cobertura de exportação, 43 testes de UI/portabilidade passaram (totais sobrepostos). Typecheck, lint direcionado e diff check passaram. Build/bundle e Playwright Thread passaram antes do ajuste posterior de copiar; E2E: 35,5 s total, cobrindo bloco visível sem controles e sem overflow. Inspeção visual direta em 900×600 confirmou contenção e legibilidade.
- Cobertura de perguntas é fixture/schema, não campanha de perguntas reais. Aprovações perdidas e pedidos RPC ausentes não são reconstruídos por esse metadado; Claude e campanha instalada continuam pendentes.

## Pedidos em trânsito e histórico de aprovação — 2026-10-05

- Corrigida disputa no ThreadRequestRegistry: pedido permanece registrado enquanto responde, bloqueando segundo envio simultâneo. Expiração, encerramento do turno e shutdown podem invalidá-lo durante o await. Falha tardia não restaura pedidos invalidados nem substitui uma nova coleção de pedidos; retry explícito permanece possível enquanto o mesmo pedido estiver pendente.
- Reinício/shutdown de pedido pendente registra connection-lost e o horário informado pela recuperação, em vez de afirmar que o provedor foi interrompido antes de responder. A interface informa “Connection closed; response not confirmed” e não oferece nova aprovação. Turno concluído sem resposta local deixa de afirmar que o agente não utilizou o pedido.
- Cartões encerrados são expansíveis, preservando comando, diretório, motivo, perguntas/opções e permissões para leitura. Comandos longos têm altura limitada e quebra de linha; não há controles de resposta no histórico.
- Validações: 72 testes de registro/manager/changes; 43 de UI/detalhes; 44 de adapters/corpus de falhas aprovados (grupos podem sobrepor outras campanhas). Typecheck, lint direcionado, diff check e build/bundle passaram. Playwright Thread final: 33,4 s, com aprovação perdida expansível e comando longo sem overflow. Inspeção direta confirmou comando contido com rolagem interna; cabeçalho ficou acima da janela pela rolagem da conversa, e suas mensagens foram verificadas pelas asserções.
- Esses testes usam fixtures. Não foi comprovada reconstrução de RPC ausente no provedor nem resposta real após perda de conexão. Campanha nativa completa e instalador permanecem abertos.

## Campanha nativa de perguntas e recusa — 2026-10-05

- Codex, sessão nova isolada, acesso read-only e modo plan: uma pergunta estruturada com duas opções foi recebida; a primeira opção foi enviada pelo adapter; request-resolved confirmou answered e o turno concluiu. [Relatório](native-codex-questions-probe.json).
- Codex, outra sessão isolada, read-only/on-request: pedido de aprovação para comando inofensivo chegou ao adapter, foi recusado, request-resolved confirmou declined e o turno concluiu. Nenhuma aprovação foi concedida. [Relatório](native-codex-approval-probe.json).
- Claude foi novamente testado em sessão isolada: falhou com authentication antes de pergunta ou resposta. Zero perguntas recebidas e zero respostas enviadas. [Relatório](native-claude-questions-probe.json). A falha não comprova defeito no fluxo de perguntas nem autorização da conta.
- [Probe reproduzível](probe-native-questions.mjs) usa os adapters de produção com processos nativos e guarda apenas contagens/estados, sem texto da conversa ou credenciais. Sessões existentes não foram retomadas. Estas execuções não passam pela interface do instalador e não certificam sessão longa, perguntas após queda, MCP, anexos, fila, cancelamento ou Claude autenticado.
