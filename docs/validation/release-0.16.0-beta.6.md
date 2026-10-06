# OXESpace 0.16.0-beta.6 — candidato em validação

Atualizado em 2026-10-06. Base: beta.5 `9f36370`. **Ainda não publicado.**

Publicação autorizada pelo usuário em 2026-10-06 como pré-release, após apresentação das pendências. Os testes autenticados/sessão longa/soak permanecem limitações explícitas; não se declara correção do incidente Linux. A publicação será condicionada ao pipeline Windows/Linux e aos pacotes do commit final. As notas versionadas serão incluídas na release.

Atualização posterior ao pacote abaixo: diagnóstico compacto implementado e validado em [registro próprio](compact-runtime-diagnostics-2026-10-06.md). O instalador e o hash registrados neste documento são anteriores a essa instrumentação; precisam ser regenerados para incluí-la.

Checagem final de prontidão em 2026-10-06: suíte completa com diagnósticos executada via `node scripts/test-electron.mjs --maxWorkers=2 --minWorkers=1`: 1.212 testes passaram, 26 ignorados e uma falha na declaração do novo serviço em `fs-allowlist.test.ts`. A exceção restrita a userData/diagnostics e resolução de executáveis foi documentada; o teste corrigido e seu lint passaram isoladamente. Total coberto após correção: 1.213 testes, sem nova execução integral. Cinco cenários Electron (Thread, Team, terminal, histórico e diagnósticos) passaram no build atual em 1,3 minuto. Log: `dist/beta6-final-tests.log`. Notas preparadas em `docs/releases/0.16.0-beta.6.md`; nada publicado. Continuam pendentes os critérios nativos/Linux/instalados abaixo.

## Alterações implementadas

- Claude: handshake de inicialização aguardado e permissões por stdio; respostas de AskUserQuestion usam o texto original das perguntas. Perguntas múltiplas têm escolhas, navegação, revisão e preservação de rascunho, sem enviar automaticamente.
- Observação contínua da sessão Claude após o resultado principal: tarefas nativas, eventos tardios e continuação nativa. Eventos de filhos não concluem o turno do pai. Tarefas sem confirmação após encerramento ficam desconhecidas.
- Atividade distingue texto recente, ferramentas e tarefas em background. Resumos utilizam comando, descrição ou arquivo em vez de JSON cru. Falhas de ferramentas permanecem inspecionáveis e podem gerar aviso no resultado.
- Acesso ampliado usa diálogo separado com política e diretório explícitos. Claude com permissões nativas não é apresentado como sandbox de projeto. Modo somente leitura continua restringindo MCP.
- Terminal Thread usa PTY real no diretório do projeto, com iniciar, interromper, parar e alternar shells, sem criar workspace Code. Fechar o painel mantém o processo vivo; reiniciar o aplicativo não promete preservar o PTY.
- Changes separa arquivos de projeto, externos e estado do agente; identidade de arquivos Linux preserva caixa.
- Equipes persistentes por projeto, papéis, inbox, recibos explícitos e MCP autenticado. Entrega automática é opt-in para Thread conectada e ociosa, revogada por falha/interrupção/reinício. Envio incerto não é repetido automaticamente. Code consulta inbox por MCP.
- Corrigida condição de corrida entre a primeira chamada MCP do agente delegado e a conclusão do vínculo de autorização.
- Web Preview não aceita endereço antes da criação da primeira aba; diagnósticos adicionais no teste do pacote registram a interface e os guests em caso de falha.

## Evidências locais

| Verificação | Resultado / limite |
| --- | --- |
| Build / análise estática | `npm run build` e limites dos bundles passaram; typecheck passou; lint sem erros, com 33 avisos. |
| Suíte Electron geral | `npm run test:electron`, sem build concorrente: 1.207 passaram, 26 ignorados, 188 arquivos aprovados (112 s). Solicitados limites de workers via npm, mas o comando emitido pelo runner não mostrou os argumentos; não considerar o paralelismo limitado como comprovado. Primeira execução concorrente com build teve dois EBUSY na limpeza de checkpoints e um timeout de histórico. O teste de checkpoints agora encerra o manager em finally e aguarda operações Git com limite explícito; o histórico passou sem alteração. |
| Delegação com Git real | 16 testes passaram isoladamente. Regressão determinística da primeira chamada MCP também passou. |
| Terminal real Thread | Playwright passou com criação de PTY, saída, resize, retorno ao mesmo PID e encerramento, sem workspace Code adicional. |
| Interface Thread / Team / histórico | Playwright final: quatro cenários passaram (55 s), cobrindo Thread, Team, PTY real e histórico nativo via worker após reinício. Perguntas e agentes no cenário de interface usam fixtures; o histórico usa arquivo local sintético. |
| Codex nativo 0.155.1 | Piloto de retomada com turnos curtos e reinícios passou. Não comprova o fluxo completo da sessão longa no instalado. |
| Transporte nativo sem inferência | Três testes passaram: handshake Claude, abertura/encerramento das TUIs Claude e Codex em PTYs isolados e descoberta MCP pelo Codex com filtro de ferramentas e escopo de projeto. MCP usa servidor de teste local, sem comprovar execução real das ferramentas por um modelo. |
| Claude nativo 2.1.287 | Handshake stdio passou. `claude auth status`: loggedIn=false; perguntas, aprovação e background reais não validados. |
| Linux local | Docker CLI disponível, mas o pipe dockerDesktopLinuxEngine não existe; campanha Linux não executada. |
| Pacote Windows atualizado | Smoke do win-unpacked regenerado passou: abertura 8.382 ms, terminal nativo ativo, quatro guests Web Preview, zero após fechar. Delta de memória observado: +403 MB com quatro abas; +25 MB após fechar (working set total: 1.589 → 1.992 → 1.614 MB). Inclui a correção da inicialização. Este ensaio não é soak test nem comprova ausência de vazamento. |

Os testes de contrato não são apresentados como validação nativa. Capturas e asserções geométricas cobrem cenários específicos, não todas as combinações de interface.

Instalador local regenerado com `electron-builder --win --config.npmRebuild=false --publish never`: `dist/OXESpace-0.16.0-beta.6-x64.exe` (460.406.939 bytes), com blockmap. Empacotamento concluído sem assinatura configurada. Nenhum commit, push ou publicação nesta retomada. Log da suíte em `dist/beta6-tests-2026-10-06.log`. O registro na memória do projeto ficou indisponível; este documento preserva o resultado da retomada.

SHA-256 do instalador: `E296E97C6B4F149ABF29C9BFE672B1F94E7E29675990A83C6275DC98CAA9B2A8`.

## Condições ainda necessárias à publicação como correção completa

1. Validações locais de build, typecheck, lint, suíte, Playwright e pacote concluídas em 2026-10-06. Revalidar se houver novas alterações; instalador produzido localmente não equivale a teste de instalação/atualização.
2. Claude autenticado: grilling, multi-select, recusa/aprovação, MCP e dois agentes, incluindo resultado posterior ao turno principal.
3. Sessão longa no aplicativo instalado: retomar, enviar/receber, interromper e reabrir, sem segundo escritor nem perda de contexto.
4. Campanha equivalente Codex para MCP, anexos, fila e cancelamento. Validar retorno da equipe com agentes reais; recibo de envio não prova leitura nem consolidação.
5. Teste prolongado de 60 minutos com memória, latência, rolagem, troca de conversas e painéis; validação Linux/CI do commit final.

O restante do roadmap Team (workflow de oito etapas, decisões de produto, Azure DevOps e transferência exclusiva entre superfícies) continua separado desta entrega.
