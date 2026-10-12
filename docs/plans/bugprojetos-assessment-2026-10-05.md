# Avaliação das evidências — 2026-10-05

Escopo: dez fotografias em `C:\Users\dudu-\Downloads\bugprojetos`, comparadas com o checkout atual. Avaliação estática; não houve reprodução na máquina Linux fotografada. A versão desse aplicativo e a versão do Claude nessas fotos não foram confirmadas. Alterações existentes da implementação Team foram preservadas.

## Evidências e diagnóstico

| Evidência | Situação | Conclusão e prioridade |
| --- | --- | --- |
| 1000376149.jpg | Menu de acesso alto, confirmação dentro do menu, texto de sandbox | P0 semântica de acesso; P2 apresentação. Claude recebe `default` tanto em read-only quanto em workspace-write. A diferença local desabilita hooks/execução de shell por skills, mas não estabelece por si só isolamento de escrita. A UI promete limites que esse mapeamento não comprova. |
| 1000376176.jpg | AskUserQuestion falhou; opções substituídas por texto; Completed com falha | P0 interação. Ausência do cartão confirmada visualmente. Existe um defeito adicional comprovado no mapeamento das respostas, descrito abaixo; não prova onde o pedido das fotos se perdeu. |
| 1000376178.jpg | Write em settings.local.json recusado; agente sugere editar permissões manualmente | P0 diagnóstico/aprovação. Não é prova de MCP desconectado. A negativa é explícita, mas não há caminho claro para o usuário resolver no aplicativo. Não usar edição automática das próprias permissões como correção. |
| 1000376179.jpg | Chamada Azure DevOps falha; agente atribui a permissões | P0 investigação do transporte. A chamada está exposta ao modelo, mas isso não comprova autenticação nem acesso efetivo ao servidor. A explicação do modelo não substitui logs do controle de aprovação. |
| 1000376180.jpg | Write em diretório externo negado, acesso Read only | A negativa pode ser legítima. P0 distinguir recusa da política, recusa humana e falha de integração; permitir mudança explícita de escopo quando cabível. |
| 1000376181.jpg | Writing response, atividades Bash/Edit com apenas `{` | P1 confirmado no código: mensagem anterior do assistente mantém Writing response; primeira linha do JSON é usada como resumo. A foto não demonstra travamento. |
| 1000376209.jpg | Terminal vazio apesar de execução de ferramentas | P1 confirmado: painel busca apenas um pane existente; não oferece criar terminal. Bash do agente não é automaticamente um PTY interativo. |
| 1000376212.jpg | Perguntas textuais e sugestão única `1a, 2a, 3a` | P1 experiência: sugestão de resposta não equivale a uma pergunta nativa pendente com escolhas independentes. Não contabilizar como validação de AskUserQuestion. |
| 1000376213.jpg | Caminho interno `.claude/projects/...` em arquivo reportado | P1 organização. O agrupador não diferencia projeto, arquivo externo e metadados do agente. Não há evidência suficiente para afirmar que um Read foi classificado como escrita: o adaptador atual só infere arquivos de Edit/Write/MultiEdit. Necessário recuperar o evento original. |
| 1000376214.jpg | Agente afirma ter iniciado trabalho paralelo, turno Completed, Background com zero jobs | P1 observabilidade. Adaptador Claude não trata o ciclo de tarefas nativas; Background lista jobs do aplicativo e delegações. A fala do agente não comprova tarefas ainda ativas. |

## Causas confirmadas no checkout

### Perguntas e permissões — P0

`electron/main/services/conversation/claude-conversation.ts:94` cria UUID para pergunta sem ID. Em `:218`, esses IDs retornam diretamente em `updatedInput.answers`. O contrato documentado exige o texto original da pergunta como chave. É necessário manter um mapa entre identidade visual e identidade nativa, sem truncar o texto usado no protocolo.

Referência: [Claude — respostas a perguntas](https://code.claude.com/docs/en/agent-sdk/user-input#response-format). A documentação também separa permissões e perguntas na mesma integração de entrada humana.

`tests/claude-conversation.test.ts:147` usa um ID artificial e valida esse mesmo formato incorreto. Falta cobertura representativa de pergunta sem ID, seleção múltipla, texto livre e várias perguntas.

O adaptador já passa `--permission-prompts host`. O `claude --help` instalado confirma esse argumento; portanto não há fundamento para atribuir a falha simplesmente à ausência dele. É preciso confrontar a versão Linux e observar control_request → registro → cartão → resposta → resultado, inclusive recusas antes do callback.

`docs/plans/thread-consolidation-2026-10/native-claude-questions-probe.json` registra zero perguntas, erro de autenticação e `passed: false`. O teste real existente não comprovou esse fluxo.

Em `claude-conversation.ts:54`, read-only e workspace-write usam o mesmo permission mode. Em `ThreadConfigurationBar.tsx:53`, a interface afirma que alterações externas exigem aprovação; em `:55`, fala em remover sandbox. Precisamos definir e comprovar a política por provedor, inclusive permissões herdadas. Não presumir que o rótulo da UI garante isolamento de sistema operacional.

### Estado e atividade — P1

`ThreadLiveActivity.tsx:56` usa qualquer mensagem anterior do assistente para indicar Writing response, antes de avaliar reasoning. `:94` mostra a primeira linha de detail, que no Claude é JSON formatado e frequentemente contém apenas `{`.

`claude-conversation.ts:162` encerra o turno conforme o result do provedor. `ThreadView.tsx:594` apresenta Completed mesmo havendo failedActions. Conclusão do turno é diferente de êxito de todas as ações; preservar o estado nativo e apresentar ressalvas de forma explícita, sem transformar toda falha recuperável em falha total.

O adaptador ignora eventos de ciclo de tarefas nativas e descarta dados recebidos depois do result daquele turno por meio do guard `completed` em `onData`. Observação de tarefas precisa pertencer à conexão/sessão, além do turno. Não reenviar mensagens nem inventar tarefas a partir da prosa.

### Painéis — P1/P2

`ThreadChangesPanel.tsx:96` busca terminal existente; `:108` oferece somente mensagem vazia. Criar um terminal de projeto explícito, com propriedade e ciclo de vida independentes do workspace Code, ou informar a indisponibilidade com ação útil.

`BackgroundJobsPanel.tsx` não é um inventário de todas as tarefas do provedor. Mostrar fontes distinguíveis: processos do aplicativo, tarefas nativas e delegações. Só oferecer cancelamento onde houver suporte confirmado.

`threadChanges.ts` agrega caminhos sem classificação por escopo. Diferenciar arquivos do projeto, arquivos externos e estado interno do agente; preservar a operação original e seu resultado. Não apresentar ferramenta proposta como diff confirmado. Há ainda normalização incondicional para minúsculas: no Linux pode juntar arquivos distintos por caixa.

## Ordem recomendada de implementação e critérios de aceite

1. **P0 — contrato de interação Claude:** corrigir IDs/respostas; observar etapas do pedido com logs sem conteúdos sensíveis; tratar recusa por política, cancelamento, erro e expiração separadamente. Aceite: pergunta nativa com várias opções, resposta livre e múltipla, aprovar/recusar Write e MCP em sessão nova e retomada, no aplicativo instalado.
2. **P0 — acesso efetivo:** alinhar rótulos e política real de cada provedor. Aceite: matriz read-only/workspace/full, caminhos internos/externos, configuração herdada, solicitação/recusa, sem promoção silenciosa de privilégio.
3. **P1 — estados fiéis:** atividade baseada no evento mais recente, resumo sem JSON cru, turno concluído com avisos, resultado desconhecido sem sucesso presumido. Aceite: reasoning após texto, falha recuperada, silêncio e desconexão sem reenvio automático.
4. **P1 — tarefas nativas:** ciclo de vida por sessão, identificadores, origem, resultado e reconciliação. Aceite: duas tarefas em paralelo permanecem observáveis após a resposta do turno; conclusão/erro chegam à interface, sem duplicar jobs locais.
5. **P1/P2 — painéis e acabamento:** terminal com ação de abertura, changes por escopo e estados, menu de acesso compacto e acessível. Aceite: Linux com nomes sensíveis a caixa, caminhos longos, janela pequena, teclado e foco.
6. **Gate de entrega:** campanha nativa Claude autenticada e Codex, nova/retomada, antes de afirmar paridade. Playwright valida interação e layout; testes simulados sozinhos não comprovam permissão ou funcionamento nativo. Registrar versões de app/provedor e limitações remanescentes.

## Limites da conclusão

Confirmadas as lacunas acima por inspeção de código e fotos. Ainda não confirmados: causa exata da ausência de control_request na sessão Linux, motivo técnico da recusa Azure, processo realmente ativo nas fotos de Writing response, conteúdo final do arquivo interno reportado. Não foram executadas alterações de produto nem novos testes de inferência nesta avaliação.
