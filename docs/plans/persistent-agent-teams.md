# Equipes persistentes, conhecimento e AI Workflow no OXESpace

Plano reconstruído em 2026-10-05. Base: v0.16.0-beta.5, commit `9f36370`.
Status: aprovado pelo usuário; implementação em andamento. Evidências e limites em `persistent-agent-teams-verify.md`.

## Resultado esperado

Permitir que o usuário mantenha um coordenador/integrador, um gerente de projetos e um product manager, enquanto sessões de desenvolvimento executam o AI Workflow em branches/worktrees isoladas. Os membros conservam identidade, contexto referenciado, mensagens e tarefas após reinício. Code e Thread dão acesso à mesma equipe, preservando a independência de seus projetos, workspaces e superfícies.

Cobrir os dois fluxos centrais:

1. De uma sessão experiente, solicitar via MCP uma nova sessão com objetivo, handoff, AI Memory e diretórios/documentos relevantes; conferir o que o destinatário recebeu.
2. Manter um coordenador que distribui trabalho, recebe perguntas e evidências, consolida decisões e conduz integração, sem depender de manter um terminal visível.

## Base existente verificada

- `shared/types/delegation.ts`: tarefas persistentes, branch intent, destino Thread/terminal, sessão nativa, knowledge bundle, ações de recuperação.
- `services/coordination/coordinator.ts` e migrações 050–052: participantes por tarefa, concessões, recibos, resultados versionados e cursores independentes.
- `mcp-internal/delegation-tools.ts`: delegação, contexto, mensagens, inbox, checkpoint, status e controle. Mensagens não são digitadas automaticamente no terminal.
- `services/delegation/delegation-session-context.ts`: captura até 12 mensagens públicas e 3 KiB por conversa. A seleção permite até cinco Threads; isso não transfere todo o conhecimento de uma sessão.
- `services/delegation/knowledge-transfer.service.ts`: contexto limitado a 24 KiB, com fontes e hashes. Preservar limites e buscar material adicional sob demanda.
- AI Memory já possui adaptador e serviços; reutilizar a integração.
- Não foi localizada integração Azure DevOps em `electron`, `src` e `shared` na revisão deste plano.

O coordenador atual organiza participantes de uma tarefa. A proposta adiciona membros permanentes e coordenação entre várias tarefas, aproveitando essas fundações.

## Princípios de arquitetura

- Identidade lógica de membro é independente de pane, PTY, processo, execução e sessão nativa do provedor.
- Uma sessão nativa tem apenas um escritor ativo. Abrir outra visualização não lança outro agente; transferir controle exige liberação e confirmação do vínculo anterior.
- Compartilhar equipe e tarefas não cria automaticamente workspaces Code ao navegar no Thread, nem conversas Thread ao abrir terminais.
- Persistir em SQLite o estado operacional, eventos e mensagens; artefatos versionados no repositório registram especificações, decisões e evidências.
- Memória é conhecimento recuperável com procedência, não fonte exclusiva do estado das tarefas nem substituto do histórico original.
- Estado desconhecido é explícito. Silêncio, saída do processo e turno encerrado não comprovam conclusão de tarefa.
- Autonomia configurável por equipe/projeto/ação, com herança das autorizações já concedidas e revogação. Escrita em serviços externos, push e merge respeitam esse escopo.
- Nunca prometer entrega exatamente uma vez de inferência externa. Usar IDs, outbox transacional e deduplicação; resultado incerto exige reconciliação antes de repetir efeitos.

## Papéis

| Papel | Responsabilidade | Entrega verificável |
|---|---|---|
| Coordenador/integrador | Distribuir tarefas, controlar dependências, arbitrar divergências e consolidar integração | Plano de execução, registro de decisões, resultados aceitos e relatório de integração |
| Gerente de projetos | Ler Azure DevOps, acompanhar capacidade, bloqueios, riscos e progresso | Situação dos work items com fontes, revisão e data da sincronização |
| Product manager | Refinar necessidades, consolidar dúvidas, propor prioridades e critérios de aceite | Brief, especificação e decisões humanas rastreáveis |
| Desenvolvedor | Executar o workflow em tarefa e worktree delimitadas | Código, artefatos, testes e PR vinculados ao item |
| Revisor, opcional | Avaliar critérios e evidências de forma independente | Parecer com achados e aceite/rejeição fundamentados |

Os papéis são modelos configuráveis. Coordenador pode ser trocado sem recriar equipe ou perder mensagens; a transferência revoga o controle anterior de forma atômica.

## Contratos propostos

| Entidade | Dados essenciais |
|---|---|
| Team / Member | Projetos autorizados, papel, responsabilidades, perfil do agente, políticas e estado de disponibilidade |
| SessionBinding | Membro, provedor, ID nativo, diretório canônico, geração, superfície atual e concessão exclusiva de escrita |
| Mission / Task | Objetivo, dono, dependências, critérios, work item, branch/worktree, fase, revisão e evidências |
| TeamMessage | ID, remetente/destinatário autenticados, tipo, correlação, tarefa, sequência e recibos |
| ContextBundle | Objetivo, decisões, pendências, fontes permitidas, hashes/revisões, limites e manifesto do material recebido |
| WorkflowRun / StageRun | Template e versão, comando, entradas, saídas, execução e revisão de aprovação |
| Decision / HumanQuestion | Pergunta, opções, impacto, responsável, prazo, resposta e tarefas afetadas |
| ExternalWorkItem | Provedor, organização, projeto, ID, URL, revisão e estado da sincronização |

Separar: disponibilidade do membro; execução do agente; entrega da mensagem; andamento da tarefa. Uma única bolinha não representa todos esses estados.

## Comunicação e recuperação

Mensagens tipadas: solicitação, aceite, progresso, bloqueio, pergunta, resposta, entrega, revisão e decisão. Mostrar estados distintos: persistida, disponibilizada ao destinatário, recebida pelo agente e respondida. Entrega ao transporte não equivale a leitura pela LLM.

Reutilizar inbox/cursores existentes, evoluindo para destinatários lógicos e múltiplos participantes. Entrega depende de capacidade real do provedor: consulta MCP em checkpoints ou envio por protocolo suportado. Quando não houver mecanismo de despertar seguro, manter pendência visível; não simular comunicação digitando texto em uma PTY ocupada.

Reinício restaura tarefas, contexto e mensagens, reconcilia sessões e apresenta retomadas necessárias. Não reenviar prompts nem executar ações de Git por causa do reinício. Limitar concorrência, profundidade de delegação, orçamento e frequência de consulta para evitar loops entre agentes.

## Transferência de conhecimento

Fluxo: escolher origem → definir objetivo → selecionar fontes → prévia de contexto → provisionar destino → entregar bundle → registrar recebimento e lacunas.

O bundle contém resumo operacional, decisões e justificativas públicas, restrições, dúvidas, critérios, branch/base SHA e referências para documentos, checkpoints, memória e histórico. Não inclui raciocínio privado nem replica indiscriminadamente conversas inteiras.

Referências precisam ser acessíveis no destino: caminho canônico permitido, revisão/hash e alternativa de snapshot quando o arquivo não existir na worktree. Detectar fonte ausente/desatualizada; diferenciar “entregue” de “consultado”. AI Memory indisponível deve produzir aviso e permitir continuar com fontes explícitas, sem afirmar que houve sincronização.

Sessões Code devem poder fornecer contexto por leitor do provedor/MCP quando disponível, e handoff explícito quando não houver suporte. Não depender de raspagem da tela do terminal. Nova sessão recebe novo ID nativo; retomar mantém o ID anterior.

## AI Workflow

Importar os comandos que o usuário já utiliza, preservando nomes e conteúdo. O local e formato desses templates ainda precisam ser identificados; não inventar equivalências executáveis.

| Etapa | Entradas | Saídas / condição para avançar |
|---|---|---|
| product refine | Demanda e contexto do produto | Problema, escopo, dúvidas e resultado esperado |
| product spec | Refinamento e decisões | Requisitos e critérios de aceite identificados |
| product architecture | Spec e restrições | Decisões técnicas, interfaces, riscos e plano de migração |
| engineer: Discovery | Spec, arquitetura e checkout | Mapa de impacto, evidências e plano técnico |
| kickoff | Plano e dependências | Responsáveis, worktrees, permissões e contexto recebido |
| work | Tarefas prontas | Implementação, checkpoints e verificações |
| pre-pr | Alterações e critérios | Revisão, testes, documentação e pendências resolvidas |
| pr | Evidência do pre-pr | PR vinculada ao item, resumo e revisão de integração |

Cada etapa permite executar, interromper, retomar e solicitar revisão. Avançar exige artefatos e condições verificáveis, não apenas o agente dizer “concluído”. Mudança de spec invalida aprovações dependentes ou exige revisão documentada. PR aberta não significa merge nem entrega aceita.

## Interface compartilhada

Adicionar acesso **Equipe** no topo de Code e Thread, junto das ações de trabalho. Sidebar continua compacta; equipe detalhada abre em painel redimensionável, com opção de área ampla para planejamento.

```text
Projeto / branch                       Equipe [2 pendências]
┌──────────────────────┬──────────────────────────────────┐
│ Equipe               │ Coordenador · disponível         │
│ ● Coordenador        │ Conversa / atividade selecionada │
│ ○ Gerente de projetos│                                  │
│ ? Product manager    │ Tarefa: autenticação             │
│ ● Dev · autenticação │ Fase: work · branch: feat/auth   │
│ ○ Dev · relatórios   │ Dependências · contexto · entrega│
├──────────────────────┼──────────────────────────────────┤
│ Decisões pendentes 2 │ Responder / abrir sessão / revisar│
└──────────────────────┴──────────────────────────────────┘
```

- No Code: selecionar membro focaliza seu terminal, quando houver; o painel mostra tarefas, mensagens e contexto sem duplicar execução.
- No Thread: selecionar membro abre sua conversa quando suportada. Sessão de provedor somente CLI mostra ação para abrir no Code, com limitação explícita.
- Abrir em outro modo preserva o vínculo; leitura e transferência de controle são ações diferentes.
- Cartão de tarefa mostra objetivo, responsável, fase, branch no contexto adequado, bloqueio e próxima ação. Detalhes técnicos ficam recolhidos.
- Central de decisões reúne perguntas do PM, gestor e desenvolvedores, agrupadas por tarefa, com opções, evidências e efeito da resposta.
- Estados com texto e ícone: azul disponível/parado, verde executando, âmbar aguardando ação, vermelho falhou, cinza desconectado/desconhecido. Resultado da tarefa aparece separadamente.
- Foco, teclado, redimensionamento, estados vazios e recuperação devem funcionar em janelas pequenas, com Code/Thread alternando sem remontar sessões desnecessariamente.

## MCP e integrações

Evoluir ferramentas existentes com compatibilidade; nomes abaixo são propostas, não ferramentas já disponíveis:

- `oxespace_team_status`, `oxespace_team_members`: visão limitada ao escopo autorizado.
- `oxespace_session_spawn`, `oxespace_session_resume`: diferenciar nova sessão com contexto de retomada exata; idempotência e prévia de efeitos.
- `oxespace_context_preview`, `oxespace_context_read`: manifesto e leitura paginada de fontes permitidas.
- `oxespace_team_message`, `oxespace_team_inbox`, `oxespace_team_acknowledge`: comunicação por identidade durável.
- `oxespace_workflow_status`, `oxespace_workflow_advance`: etapas vinculadas a evidências e revisões.
- `oxespace_decision_request`, `oxespace_decision_resolve`: perguntas humanas persistidas; quem pode resolver depende da política.

O servidor deriva identidade da execução autenticada; não confia em `memberId` autodeclarado no prompt. Negocia capacidades por versão/provedor e informa claramente o que está indisponível.

Azure DevOps entra primeiro com leitura paginada de work items, relações e PRs. Depois, escrita controlada com revisão otimista, prévia de diferenças, idempotência e tratamento de conflito. Credenciais ficam no armazenamento seguro existente. Conteúdo remoto é dado, não autorização para executar instruções. Git local permanece desacoplado do serviço de hospedagem; prever adaptador GitHub sem exigir sua implementação completa na primeira entrega.

## Sequência de implementação

| Onda | Escopo | Critério de saída |
|---|---|---|
| 0 — Confiabilidade | Fechar validação real de retomada longa, reconciliação, perguntas, aprovações e cancelamento nos caminhos necessários | Matriz Codex/Claude com versão e evidência; falhas bloqueadoras resolvidas; limitações explícitas |
| 1 — Identidade e persistência | Team/Member/SessionBinding; exclusão de escritor; migração das delegações sem apagar dados | Reinício e troca de modo não duplicam processos, sessões ou workspaces; coordenador pode ser substituído |
| 2 — Continuidade de conhecimento | Bundle versionado, fontes Code/Thread, AI Memory e prévia de destino/worktree | Nova sessão consulta fontes verificáveis, acusa lacunas e não modifica o checkout da origem |
| 3 — Comunicação e painel Equipe | Inbox por membro, recibos, perguntas, tarefas e integração nas duas superfícies | Coordenador + dois desenvolvedores trocam mensagens sem perdas/duplicatas, inclusive após queda e reinício |
| 4 — Workflow | Importação de templates, oito etapas, artefatos, dependências e revisões | Feature atravessa o ciclo completo; bloqueios e revisões impedem avanço indevido |
| 5 — Gestão de produto e projetos | Modelos PM/gestor, central de decisões, Azure leitura e depois escrita | Work item rastreável até tarefa/branch/PR; conflitos de sincronização não sobrescrevem decisões |
| 6 — Integração e aceite | Revisor, evidência por commit, integração ordenada e políticas de merge | Duas branches integradas com testes; conflito ou evidência obsoleta bloqueia conclusão |
| 7 — Consolidação | Performance, acessibilidade, diagnóstico, pacote instalado e campanha real | Critérios abaixo comprovados em Windows/Linux; pendências publicadas por capacidade |

A primeira entrega utilizável termina na onda 3: coordenador persistente + sessões isoladas + handoff rastreável + comunicação e painel em Code/Thread. A demanda completa exige também workflow, gestão e validação das ondas seguintes.

## Aceite e medição

1. Criar sessão via MCP a partir de uma sessão experiente, com worktree e fontes verificadas; repetir mesma solicitação não duplica recursos.
2. Coordenador com dois desenvolvedores, gestor e PM: distribuir tarefas, receber dúvida, responder e consolidar entrega em ambos os modos.
3. Fechar/reabrir OXESpace e retomar exatamente os vínculos; nenhuma mensagem ou ação externa é reenviada silenciosamente.
4. Simular queda, entrega sem confirmação, revogação, troca de coordenador, worktree removida e sessão ocupada por outro escritor.
5. Rodar oito fases com artefatos, revisão de spec e invalidação de evidência; conclusão ancorada no commit efetivamente testado.
6. Integrar Azure com conta de teste: paginação, expiração de credenciais, conflito de revisão e falha de rede sem perda de alterações.
7. Playwright cobre navegação, foco, painéis redimensionáveis, sobreposição, rolagem, contraste e estados; campanha nativa autenticada comprova o que fixtures não comprovam.
8. Executar soak de duas horas com cinco membros, múltiplas worktrees e sessão longa. Medir RAM/CPU, latência local, envio→aceite do provedor e troca de conversa separadamente.
9. Metas iniciais a calibrar no hardware de referência: painel Equipe interativo p95 ≤ 300 ms; consulta local de status p95 ≤ 200 ms; feedback de envio ≤ 100 ms. Tempo de resposta do modelo não integra essas metas locais. Definir orçamento de memória após baseline e reprovar crescimento contínuo não explicado.

Registrar resultados, versões e limites; “100% da demanda” significa todos os cenários acordados cobertos, não garantia irrestrita sobre provedores externos.

## Próxima execução

Antes do código de produto: localizar templates do AI Workflow, definir organização/projeto Azure de teste e políticas de autonomia; fechar contratos/migrações e wireframes de Equipe, Handoff e Decisões. Esses detalhes não impedem desenvolver a fundação local da onda 1. A onda 0 é gate para habilitar coordenação automática sobre sessões ainda não comprovadas.

Manter artefatos de plano, contrato de UI, matriz de cenários e relatório de verificação; cada onda só é marcada concluída com evidência. Não publicar outra release automaticamente por concluir este planejamento.
