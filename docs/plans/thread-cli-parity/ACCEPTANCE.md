# Aceite e certificação de paridade CLI/Thread

Data: 2026-09-18. **Critérios planejados; não são resultados de testes.**

## 1. Regras de qualificação

Certificar por provider + versão + plataforma + autenticação + perfil/modelo/esforço + política. Estados separados: contrato/mocks, runtime real sem inferência e tarefa real com inferência. O selo P1 cobre Claude/Codex e as configurações declaradas; P2 cobre cada provider adicional explicitamente testado. P3 cobre equivalência das ferramentas próprias do aplicativo.

Para cada item do manifesto: nome/aliases, argumentos e efeitos do CLI, equivalente Thread, requisitos e API, handler, validação de negação/erro/recovery, evidências e estado. TUI-only visual ganha equivalente desktop com justificativa; função sem handler continua lacuna. Experimental fica destacado, sem ser contado como certificado estável.

## 2. Cenários obrigatórios

| ID | Cenário | Aceite observável | Evidência principal |
|---|---|---|---|
| A01 | Baseline/versionamento | CLI/provider/versão/hash; método habilitado/ausente distinguido de autorização | Schemas e handshake nativo |
| A02 | Perfil/modelo/esforço/auth efetivos | Configuração aplicada coincide com a solicitada ou diferença nativa é informada; sem troca silenciosa subscription/API | Config read/response e turno real |
| A03 | Read-only | Leitura/perguntas permitidas; edição/shell-write negados ou submetidos à concessão explícita suportada, sem fingir sucesso | Requests nativos e hashes antes/depois |
| A04 | Escrita/rede/raízes | Ação permitida só nos roots/política escolhidos; network/request adicional tem concessão/negação específica | Processo real, decisão e resultado |
| A05 | Pergunta simples/múltipla/livre | Codex requestUserInput e Claude AskUserQuestion recebem answers corretas; draft é preservado | Request/resposta redigidos e continuação nativa |
| A06 | Aprovação avançada | Accept/decline/cancel e decisões por turno/sessão/policy amendment somente quando suportadas; scope mostrado | Request/resolved e ação real |
| A07 | MCP elicitation/tool requests | Form/URL/OAuth/tool call correto; erro/cancelamento não vira aprovação vazia | Servidor MCP real de fixture |
| A08 | Fila Codex | Add/edit/delete/reorder/start refletidos na fila nativa; nenhuma fila duplicada | thread/queue list e ordem dos turnos |
| A09 | Fila Claude | Entrega serializada, config snapshot e status corretos; desconhecido não é reenviado automaticamente | IDs, ACKs e resultados reais |
| A10 | Steering/interrupt | Nova instrução chega ao turno certo quando suportado; sem equivalente usa fila explicitamente; interrupção finaliza o turno correto | expectedTurnId, eventos e continuação |
| A11 | Imagens/inputs | Imagem é conteúdo estruturado; referências/skills/apps têm o formato nativo; remover/upload/retry funcionam | Input nativo e resposta à fixture visual |
| A12 | Pending requests | Troca de Thread, reconnect, resolved/expiry e saída não deixam controles ativos indevidos | E2E + registry de gerações |
| A13 | Manifesto de comandos | Todo comando obrigatório do baseline possui handler e equivalência; unavailable/unknown não conta como suporte | Matriz versionada + testes por comando |
| A14 | Efeito/escopo de sessão | Local remove não é native delete; nome/archive/delete/stop executam o efeito escolhido com confirmação | Estado SQLite + consulta nativa |
| A15 | CLI ↔ Thread resume | Sessão de CLI retoma na Thread e vice-versa com contexto preservado; dois escritores não tomam posse indevida | Native ID/histórico/locks |
| A16 | História extensa | >=10.000 eventos e >2MiB permitem novos turnos; memória/DOM limitados; p95 de input medido | Fixtures de estresse + piloto longo |
| A17 | Paginação | Prepend/update mantém âncora; write de janela não apaga eventos anteriores; rewind troca epoch corretamente | SQL/cursor/asserts e E2E |
| A18 | Payload/backpressure | Imagem/saída grande respeita limite negociado; output truncado é identificado; nada entra em log/JSON indevido | Transporte e stress fixtures |
| A19 | Export/import offline | Mensagens/requests/turnos/tools/artefatos redigidos reabrem; import não executa ações | Roundtrip/hash/checklist |
| A20 | Rewind/revert | Remoção de contexto é distinta de desfazer disco; dirty anterior preservado e conflito posterior bloqueado | Hashes de arquivo/índice e native state |
| A21 | Automação MCP | Script/worktree/delegação elegíveis são executados após autorização correta; negação não executa | RPC main e efeitos reais |
| A22 | Isolamento MCP | Outra Thread/root/workspace/geração não reutiliza lease/consent; memória desligada não desliga execução | Dois contexts reais + revoke |
| A23 | Voz Thread | Hotkey usa compositor focado; dismiss/AbortError funciona; texto não vai ao Code oculto nem auto-send | E2E/hook test e inspeção de draft |
| A24 | Hooks/skills/apps/plugins | Configurar/habilitar/usar tem efeito real; managed denies permanecem; catálogo/reload atualizado | Hook/tool traces redigidos e native catalog |
| A25 | Observabilidade/usage | Outputs/MCP error/exitCode/progresso público/status corretos; quota/contexto/custo separados e com fonte | Eventos públicos + UI |
| A26 | Evidência de arquivos | Codex/Claude/shell preservam evidência; autoria não comprovada é identificada; totais não somam dirty anterior | Artefatos/baselines/conflitos |
| A27 | Git/Files/Preview/Terminal | Operações e destinatário corretos dentro da Thread; roots/worktrees sem cache trocado; terminal só explicitamente | Fixtures Git/Preview e E2E |
| A28 | Child agents/delegação | IDs/status/inputs/cancel/resultado ligados à execução correta; native child diferente de delegação OXE | Duas sessões reais e native events |
| A29 | Sessões simultâneas/sidebar | Duas/quatro células independentes; hotkey/foco/resize/draft/painéis/branch/actions corretos | E2E 900/1440 + teclado |
| A30 | Recuperação/falhas | Crash antes/depois ACK, quota/auth, malformed stream, exit e shutdown têm estados recuperáveis; sem replay de writes | Fault injection + real reconnect |
| A31 | Regressão Code/design system | Terminais, settings, login, memória, Git, voz e tokens Code preservados; budgets passam | Suite completa/build/E2E/screenshot |
| A32 | Pilotos comparativos | Todas as capacidades críticas passam por teste real; discrepâncias são registradas por modo/provider | Relatório CLI/Thread verificável |

## 3. Campanha comparativa real

Montar dois checkouts temporários equivalentes por execução (base commit, dirty controlado, dependências e fixtures iguais), com conta/profile/modelo/esforço/configuração equivalentes. Não usar o checkout de trabalho do usuário como área de prova. Não exigir respostas textuais idênticas: comparar efeito, conclusão correta, permissões e recuperação.

CLI: operador usa a interface nativa com roteiro registrado e checkpoint de estado; automação de TUI não entra no runtime do produto. Thread: UI/runtime reais, sem respostas mockadas do modelo. Smokes de protocolo/fixture e pilotos de inferência são relatórios separados.

| Piloto | Tarefa | Prova de resultado |
|---|---|---|
| T01 | Ler projeto e responder pergunta com arquivo/linha | Referências conferidas; nenhum write |
| T02 | Corrigir bug pequeno e executar teste existente | Patch e teste real passam; arquivos fora do escopo intactos |
| T03 | Mudança em múltiplos arquivos com rename/delete | Estado Git/artefatos corretos e resumo sem soma falsa |
| T04 | Pedir uma decisão estruturada antes de editar | Request/resposta e implementação da opção escolhida |
| T05 | Solicitar acesso adicional/rede e testar allow/deny | Efeito limitado ao escopo autorizado; negação respeitada |
| T06 | Rodar tarefa, enviar steering/fila e interromper/retomar | Ordem, IDs/config/contexto e recovery corretos |
| T07 | Interpretar imagem de fixture e ajustar UI | Imagem transferida ao runtime; alteração/teste visual correspondente |
| T08 | Usar skill/plugin/hook e ferramenta MCP de leitura/mutação | Uso real observado, managed constraints e consent |
| T09 | Retomar sessão entre CLI e Thread e fazer fork | Native IDs/contexto/títulos e isolamento conferidos |
| T10 | Trabalhar em conversa longa com compactação e paginação | Próximo turno funciona; histórico preservado |
| T11 | Usar subagente/delegação e duas execuções em worktrees | Resultados/cancelamento/arquivos sem cruzamento |
| T12 | Revisar, comentar, stage/commit e revert com conflito | Índice e dirty anterior preservados; conflito tratado |

Ao menos3 repetições de cada piloto aplicável por provider/modo para encontrar diferenças; essa amostra não prova igualdade estatística de qualidade ou latência. Caso nativo sem capacidade documentada é registrado como não aplicável àquele baseline, com justificativa. Recurso existente no CLI mas ausente na Thread é falha/bloqueio, não não-aplicável.

Registrar sucesso por cenário, defeito de integração, falha do motor, falha de ambiente/conta, tempo até primeiro evento, tempo até conclusão, interrupção/resume, processos criados e integridade do repo. Não esconder cenário crítico que falhou em média global. Rate-limit/quota pausa a campanha e não certifica o cenário.

## 4. Registro de evidência e gates

EVIDENCE.md durante execução: identificador do caso, provider/version/plataforma/auth/profile, modelo/esforço/política efetiva, commit/base dirty, fluxo CLI e Thread, resultados, comandos de teste, hashes e captura. Metadados públicos de sessão quando necessários; nunca tokens, chaves, payload de configuração sensível ou transcript bruto de terminal.

- Por passo: testes específicos, typecheck/lint direcionados e aceite observado.
- Por onda: casos da onda, integração Electron e smokes da capacidade alterada.
- Antes dos pilotos: suite completa Electron, build/budgets e E2E.
- Certificação:0 lacunas funcionais críticas no escopo declarado; discrepâncias conhecidas por provider explicitadas. P2 exige também passos32/33 e a campanha de cada novo adapter.
- Liberação: migração/recovery documentados, rollback sem exclusão de dados e manifesto compatível com runtime; o planejamento não autoriza release/publicação automática.

As métricas propostas de UI/performance do PLAN precisam hardware/dataset de referência definidos em W0 e medição suficiente para p95. Não chamar tempo de startup MCP de latência do modelo. Não usar quantidade de testes como porcentagem de paridade.
