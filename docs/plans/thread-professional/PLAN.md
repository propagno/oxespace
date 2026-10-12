# Threads: experiência Desktop integrada

Data: 2026-09-17. Status: implementação em andamento. Controles, atividades e comandos integrados básicos implementados; paridade integral ainda pendente. Evidências e limites em [IMPLEMENTATION.md](IMPLEMENTATION.md).

Governança: a paridade operacional completa entre Code CLI e Thread passa a ser conduzida pelo [plano de paridade CLI/Thread](../thread-cli-parity/PLAN.md). Este documento continua como histórico e contrato da experiência profissional já iniciada.

Pedido: conversa profissional inspirada no Codex Desktop, modelo e esforço sempre acessíveis no compositor, comandos executados dentro da Thread sem Advanced CLI tools.
Este contrato substitui a decisão anterior de usar um terminal auxiliar para paridade de comandos. Complementa o redesign já implementado; preservar sidebar compartilhado, drafts, autenticação, scroll e isolamento das sessões.

## 1. Diagnóstico verificado

| Evidência | Problema | Decisão |
|---|---|---|
| `ThreadView.tsx` renderiza cada `tool` como `details`; `ThreadView.css` adiciona borda e margem por ferramenta | Sequência de commandExecution ocupa a conversa e dilui a resposta | Atividades consecutivas agrupadas, detalhes sob demanda |
| `codex-conversation.ts` usa `item.type` como nome visível e conserva poucos campos | Nome técnico repetido; detalhes não explicam o trabalho | Eventos estruturados e apresentação semântica |
| `ThreadModelPicker.tsx` depende de evento disparado por `/model` | Configuração só é descoberta após comando; polui histórico | Seletores persistentes no compositor e API de configuração |
| `shared/threadCommands.ts` mantém lista ampla `execution: cli` | Comandos listados não equivalem a funcionalidades integradas | Registro com handler, capacidades e prova de comportamento por comando |
| `ThreadCommandService.prepare` retorna `nativeCli` para desconhecidos | Comando sem suporte encaminhado ao terminal | Rejeição local clara e preservação do draft; nunca encaminhar automaticamente |
| `cliActive` bloqueia compositor; diálogo pode fechar mantendo processo | Usuário fica sem conseguir conversar | Remover esse mecanismo da experiência Thread com migração de sessões |
| Codex fixa sandbox read-only; Claude anuncia approvals:false | Permissões ainda não são configuração efetiva integrada | Controle respaldado pelo backend, com aprovação dentro da conversa |

Os arquivos `.oxe/codebase/STACK.md` e `STRUCTURE.md` não estavam disponíveis nesta leitura. O contrato foi baseado nos arquivos atuais React/TypeScript/Zustand, Electron, SQLite, Radix e tokens existentes; não usar mapas históricos como prova de implementação.

## 2. Resultado visual

Contrato detalhado: [UI-SPEC.md](UI-SPEC.md). Referência de composição: Codex Desktop; dimensões abaixo são decisões do OXESpace, não medidas alegadamente copiadas do aplicativo oficial.

```text
sidebar compartilhado  │  Título da conversa   projeto / branch            ⋯
                      │
                      │                   Mensagem do usuário
                      │  ▸ Explorou o projeto · 12 ações · 8 s
                      │  Resposta formatada, com hierarquia e código legíveis
                      │  Copiar resposta   Tentar novamente
                      │
                      │  ┌──────────────────────────────────────────────┐
                      │  │ Pergunte ou descreva uma tarefa…             │
                      │  │ /   [Modelo ▾] [High ▾] [Permissões ▾]     ↑ │
                      │  └──────────────────────────────────────────────┘
```

`Low`, `Medium`, `High` e demais valores são níveis de esforço, não uma lista fixa universal de capacidades. Exibir somente opções válidas para o modelo, versão e conta atuais. Outras capacidades (imagens, ferramentas, modos) precisam de disponibilidade própria e não devem ser inferidas pelo nome do modelo.

## 3. Arquitetura e decisões

### 3.1 Um executor e uma sessão

- Criar registro de comandos tipado no main: nome, aliases, argumentos, provider, requisitos de versão/capacidade, escopo (thread/projeto/conta/aplicação), handler, apresentação e política de confirmação.
- Resultado discriminado: `applied`, `open-surface`, `started-turn`, `needs-confirmation`, `unsupported`, `failed`. Nenhum resultado `open-terminal`.
- Slash, botões e menus chamam os mesmos handlers; `/model` apenas abre o seletor do compositor. Configuração não é prompt, não consome turno e não gera cartões no histórico.
- `thread.models`, `thread.capabilities`, `thread.configure` e `thread.command` propostos no IPC tipado; validar no main identidade, argumentos, limites e capacidades. Renderer nunca fornece executáveis, caminhos de skills ou RPC arbitrário.
- Configuração guarda valores solicitados e efetivos, revisão e origem. Alteração confirmada pelo adapter persiste na Thread; falha mantém último valor efetivo. Controles mudam visualmente para pending, sem alegar sucesso antecipado.
- Turno captura a revisão da configuração ao iniciar. Troca durante execução aplica ao próximo turno, identificado no rodapé; não reiniciar/interromper trabalho silenciosamente. Serializar alterações e envio para impedir corrida.
- Codex: App Server persistente com métodos negociados/validados contra a versão instalada. Claude: SDK/controle estruturado; quando exigir reinicialização headless, retomar sessão apenas após finalizar turno, sem perder contexto.
- Preservar cache e single-flight de descoberta já corrigidos. Modelos/capacidades carregam na seleção da Thread, com atualização explícita e invalidação por login/versão/configuração. Nenhuma descoberta por tecla ou abertura de popover.
- Não automatizar TUI por teclas, não usar terminal invisível como executor genérico, não raspar ANSI, não usar resposta do modelo como prova de configuração.

### 3.2 Eventos e atividade

Ampliar eventos com `turnId`, `itemId`, sequência, categoria, rótulo, estado, timestamps, alvo e dados seguros: comando, exitCode, output limitado, alterações de arquivo, ferramenta/servidor MCP e resumo de compactação. Identidade estável permite atualizar started/completed sem duplicar itens. Payload bruto e raciocínio privado não entram na UI.

Projetor puro produz blocos de mensagem, atividade, aprovação e erro. Agrupar apenas ferramentas consecutivas do mesmo turno; mensagens e aprovações preservam a ordem. Nomes desconhecidos usam rótulo neutro com detalhes técnicos expansíveis. Não inventar contagem de arquivos a partir de um comando sem evidência.

Histórico antigo continua legível com campos opcionais. Consultas/paginação e renderização progressiva devem superar o limite atual de eventos sem congelar a interface; agrupamento visual sozinho não resolve limite de armazenamento.

### 3.3 Comandos completos: definição verificável

O objetivo continua sendo cobertura completa das versões suportadas. Não equivale a prometer suporte a comandos futuros ou exclusivos de uma plataforma ainda não investigada. Congelar inventário por versão de ambos os CLIs, reconciliar os nomes atuais de `shared/threadCommands.ts` e os descobertos, e manter manifesto com uma linha por comando/alias: comportamento nativo, equivalente Thread, método/API, escopo, teste, resultado e lacuna.

| Família / nomes atuais | Experiência dentro da Thread | Verificação necessária |
|---|---|---|
| model, effort, fast, personality, output-style | Popovers de configuração, apenas opções disponíveis | Valor efetivo no próximo turno e retomada; não apenas label |
| permissions, approvals, allowed-tools, approve, add-dir, sandbox-add-read-dir, setup-default-sandbox | Painel de acesso e cartões de aprovação | Isolamento por raiz, negar/aprovar/cancelar; opção não pode burlar política do provider |
| plan, goal, recap, compact, context | Plano, objetivo, contexto e compactação integrados | Preservar semântica do provider, confirmar conclusão real |
| new, clear, reset, resume, fork, rewind, checkpoint | Nova conversa, seletor de sessões, ramificação e recuperação | IDs nativos corretos; limpar tela não significa apagar sessão; rewind não reverte arquivos sem operação específica |
| rename, name, archive, delete | Menu da conversa e confirmação para exclusão | Consistência SQLite/provider/sidebar; deixar explícito o que é excluído |
| status, usage, cost, stats, debug-config, doctor | Painel compacto de sessão/conta/diagnóstico | Dados reais, timestamp e ausência de dados explicitada; não estimar quota |
| skills, comandos de skills, commands OXE | Busca e execução na conversa | Resolução no main, precedência nativa, escopo e argumentos preservados |
| apps, app, plugins, plugin, mcp, hooks, agents | Painéis de integrações e configuração | Catálogo/listagem não basta: configuração e autenticação efetivas |
| agent, subagents, side, btw, tasks, todos, ps, stop | Lista de tarefas/subsessões e execução relacionada | Isolar sessão, cancelar recurso correto; não interromper conversa errada |
| diff, review, copy, export, mention | Diff/seleção de revisão, copiar/exportar e contexto de arquivos | Diff real, alvo explícito, seleção segura e resultado verificável |
| init, import, memory, memories, worktree, cd, pwd, cwd | Formulários de projeto/contexto e arquivos de instrução | Mudança de diretório exige contexto validado; não falsificar raiz apenas visualmente |
| login, logout, accounts | Accounts integrado | Login nativo/subscription, reconexão, cancelamento; logout informa alcance da conta compartilhada |
| config, settings, theme, keymap, keybindings, vim, raw, title, statusline, terminal-setup, tui | Preferências visuais e de entrada equivalentes no OXESpace | Mapear semântica aplicável à UI; preferências exclusivas de terminal exigem decisão explícita |
| voice, help, feedback, bug, privacy-settings | Voz, ajuda, feedback e preferências integradas | Voz cancelável, ajuda do catálogo real, feedback só enviado por ação explícita |
| experimental, pet, pets, daemon, remote-control, rc, desktop, teleport, ide | Integrações específicas a investigar antes de habilitar | API, plataforma e autenticação verificadas; sem prometer equivalência ainda não demonstrada |
| quit, exit | Encerrar sessão de execução e manter acesso ao histórico | Não fechar aplicativo ou descartar draft como efeito implícito |

`app`/`desktop`/`teleport` podem ter como finalidade abrir outro produto: uma ação externa deliberadamente solicitada por esse comando difere de encaminhar comandos arbitrários ao Advanced CLI. Descrever o destino antes de executar.

Comando desconhecido nunca vira prompt (especialmente importante para comportamento atual do Claude SDK). Retornar erro local com busca/ajuda e preservar texto. Durante desenvolvimento, pendências aparecem como indisponíveis com motivo; não contar isso como cobertura concluída. Comando sem API exige equivalente funcional próprio ou permanece uma lacuna bloqueadora da alegação de paridade. A matriz completa é um entregável, não a tabela agrupada acima.

### 3.4 Migração do CLI auxiliar

1. Remover Tools/Advanced CLI do fluxo Thread e o fallback de `prepare`, após handlers correspondentes estarem disponíveis.
2. Na atualização, identificar sessões antigas `cliActive` e leases reais. Não matar processos de Code nem interromper silenciosamente uma tarefa ativa.
3. Oferecer recuperação dentro da Thread: aguardar tarefa ou interromper explicitamente; fechar transporte legado e importar a sessão nativa validada. Conservar IDs, modelo, draft, posição e histórico.
4. Falha de importação oferece tentar novamente e acesso ao histórico preservado; nunca limpar `cliActive` na UI sem liberar o lease no backend.
5. Converter eventos legados `cli-command` em registro histórico neutro; não reexecutá-los. Remover IPC/componente CLI da Thread quando não houver consumidores, mantendo terminais do modo Code.

## 4. Ondas de implementação

Esforço é relativo; não estimar prazo de paridade antes da descoberta das capacidades.

| ID / tipo | Trabalho e arquivos principais | Dependências | Esforço | Aceite / verificação |
|---|---|---|---|---|
| T01 research | Inventário versionado, manifesto por comando; adapters, shared/threadCommands.ts; novo command-coverage.json | — | Alto | Todos os nomes/aliases reconciliados, método documentado e lacunas explícitas; probes sem inferência para descoberta |
| T02 design | Aprovar contrato por fixtures e protótipo local: UI-SPEC, composição 900/1280/1600, light/dark | T01 | Médio | Estados e geometria auditáveis; visual da imagem reproduzido antes/depois |
| T03 implement | Registro/executor/capabilities; novos thread-command-registry.ts e thread-configuration.ts; shared/types/thread.ts, IPC/preload, thread-manager | T01 | Alto | Slash e UI usam mesmo handler; unknown não inicia turno/PTY; idempotência/cancelamento |
| T04 implement | Catálogo e configuração por provider; adapters, runtime, persistência e account store | T03 | Alto | Modelos/esforços reais antes do primeiro envio, próximos turnos e resume corretos; teste por provider |
| T05 implement | Novo ThreadComposer.tsx, ThreadModelMenu.tsx, ThreadEffortMenu.tsx, ThreadPermissionsMenu.tsx; ThreadView/CSS | T02,T04 | Médio | Modelo/esforço no rodapé; draft/foco intactos, acessível, sem evento de chat para configurar |
| T06 implement | Eventos estruturados/projetor; novos thread-presentation.ts, ThreadActivityGroup.tsx, ThreadToolDetails.tsx; adapters e manager | T03 | Alto | 12 tools consecutivas viram um grupo; ordem e detalhes preservados; histórico antigo funciona |
| T07 implement | Comandos sessão/projeto: new/resume/fork/rename/archive/rewind/export/diff/review etc; stores, adapters e serviços existentes | T03,T04 | Alto | Checklist individual com efeito observado e erros/cancelamento; atomicidade de identidade |
| T08 implement | Permissões/aprovações, uso, contexto, integrações, tarefas/subagentes; handlers/painéis específicos | T03,T07 | Alto | Sem terminal auxiliar, capacidades verificadas, ações efetivas e isolamento |
| T09 implement | Fechar comandos restantes do manifesto, incluindo UI/TUI específicos e dependentes de plataforma | T01,T08 | Alto | Nenhuma lacuna não declarada; não marcar suporte completo se esta onda estiver incompleta |
| T10 implement | Recuperação legado e retirada do bridge CLI; thread-manager, native-session-history, ThreadCliPanel, IPC/preload, App | T07,T08,T09 | Alto | Sessão legada recuperada sem perda e sem afetar terminais Code; zero fluxo Advanced CLI |
| T11 test | Unit/adapters/SQLite + E2E por comando; fixtures longas, concorrência, permissões e regressões | T05,T06,T10 | Alto | Cobertura rastreável a cada linha do manifesto e critérios A01–A12 |
| T12 verify/document | Auditoria visual, build/budgets, piloto autenticado de ambos providers, atualizar docs/thread-view.md | T11 | Médio | Evidência visual + efeitos reais, limitações publicadas, nenhum sucesso baseado só em mock |

T05 e T06 são os primeiros resultados visíveis. Eles não encerram o pedido enquanto a cobertura de comandos não estiver concluída.

## 5. Critérios de entrega

- A01: nenhuma ação slash abre Advanced CLI, xterm, PTY interativo ou substitui a conversa.
- A02: modelo e esforço efetivos aparecem no rodapé antes de enviar; sem `/model`; catálogo indisponível nunca vira escolha fictícia.
- A03: trocar modelo/esforço preserva draft/histórico, aplica ao turno correto, persiste e restaura; esforço incompatível exige escolha válida.
- A04: exemplo com 12 commandExecution consecutivos ocupa um grupo fechado de até 40 px, não 12 cartões; falhas/aprovações continuam perceptíveis.
- A05: usuário consegue inspecionar comando/output/erro/arquivo relevantes; rótulos legíveis e sem dados inventados.
- A06: todo comando/alias do manifesto possui comportamento e teste; suporte indisponível não conta como paridade. Diferenças inevitáveis de semântica ficam explícitas.
- A07: slash/popover não inicia descoberta repetida nem toma foco; menu é filtrado em memória. Meta p95 <100 ms no fixture acordado.
- A08: leitura preservada durante streaming; novas mensagens não puxam scroll quando usuário lê acima; Latest messages funciona sem cobrir conteúdo essencial.
- A09: composer integralmente visível em 900×600, 1280×800, 1600×1000 e zoom 125/150%; sidebar comum 240/248/360 e colapsado; sem scroll horizontal global.
- A10: teclados, IME, foco, contraste e leitores de tela atendem UI-SPEC; voz e erros fecham sem reaparecer por callbacks atrasados.
- A11: migração preserva sessão/histórico/draft; testes de start/resume/fork/cancel e perfil de acesso sem vazamento entre threads/worktrees.
- A12: typecheck, lint sem novos erros, build/budgets, unit/integração/Electron E2E e piloto real passam; relatório enumera provas reais vs fixtures.

Verificações previstas: `npm run typecheck`, `npm run lint`, `npm run build`, Vitest focado nos novos módulos/adapters, `npm run test:electron -- tests/integration/thread-manager.test.ts`, `npx playwright test e2e/thread-view.spec.ts` e nova suíte command-parity. Acrescentar chamadas reais controladas para provar efeito de configuração/comandos; testes somente de catálogo não provam execução.

## 6. Riscos e mitigação

- Divergência entre documentação atual e CLI instalado: registrar versão e schemas/probes; gate de capacidade antes de habilitar handler.
- Paridade não exposta pelo provider: construir equivalentes próprios quando semanticamente válidos; não mascarar lacuna com botão ou retorno ao terminal.
- Configuração concorrente e compartilhada: revisão por thread, serialização e escopo explícito; não escrever defaults globais para alterar apenas uma conversa.
- Sessões/rewind/fork: provar mapeamento de IDs e atomicidade; snapshot de recuperação antes de migração, sem reexecutar comandos históricos.
- Longa atividade/streaming: payload limitado, atualizações agrupadas, memoização por item; janela/paginação preserva âncora e seleção.
- Permissões: retirar readonly hardcoded só quando modo/approvals forem reais; rótulo deve corresponder à política efetiva.

## 7. Referências primárias consultadas

- [Codex App Server](https://developers.openai.com/codex/app-server/): catálogo de modelos com esforços e operações estruturadas de sessão. Confirmar disponibilidade na versão instalada antes de usar métodos novos.
- [Recursos do Codex Desktop](https://developers.openai.com/codex/app/features/): referência do produto; contrato geométrico é específico deste plano.
- [Claude SDK: commands e skills](https://code.claude.com/docs/en/agent-sdk/slash-commands): descoberta e diferenças de dispatch; entradas desconhecidas podem consumir turno nas versões atuais, justificando validação prévia.
- [Claude: configuração de modelo](https://code.claude.com/docs/en/model-config): esforço depende de modelo/configuração e modo de execução. Validar valor efetivo; não inferir suporte a partir de um label.

Este documento não declara os handlers novos implementados nem a paridade validada.
