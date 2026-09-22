# Capacidades reais: CLI no modo Code versus Thread

Data: 2026-09-18. Checkout local em desenvolvimento, incluindo a correção MCP mais recente. Versões instaladas consultadas: Codex CLI 0.154.0 e Claude Code 2.1.274.

## Resultado

Não existe paridade operacional completa. A Thread usa os executáveis nativos dos providers, com Codex via app-server e Claude via print/stream-json. Não é uma implementação de chatbot com API key separada. Ela pode selecionar o mesmo modelo/esforço, mas impõe configurações e traduz somente parte das interações nativas.

Mesmo modelo não garante a mesma resposta ou sucesso: histórico, instruções, ferramentas disponíveis, permissões, configuração e integração de perguntas precisam ser equivalentes. Não há benchmark comparando os dois modos com tarefas reais controladas que comprove equivalência de qualidade, velocidade ou taxa de sucesso.

Aqui CLI significa a interface nativa executada nos terminais do modo Code. Recursos desse CLI dependem de versão, conta, configuração, sistema operacional e flags. Recursos próprios de Code, como editor e painéis Git, não devem ser confundidos com capacidades do modelo.

## Matriz

| Capacidade | CLI no Code | Thread Codex | Thread Claude |
|---|---|---|---|
| Motor nativo | Executável interativo do provider | Mesmo executável, protocolo app-server | Mesmo executável, protocolo print/stream-json |
| Modelo/esforço | Seleção nativa conforme catálogo/conta | Catálogo/configuração integrada | Catálogo/configuração integrada |
| Autenticação | Nativa; ambiente/configuração do terminal | Preflight exige assinatura; ambiente API sanitizado | Preflight exige assinatura; ambiente API sanitizado |
| Ler/analisar projeto | Ferramentas e acesso conforme política nativa | Ferramentas nativas sob sandbox escolhido | Em read-only: Read, Glob, Grep, Skill e MCP controlado |
| Editar e executar testes/comandos | Conforme política e aprovações nativas | Implementado sob workspace-write/aprovações suportadas | Workspace-write ativa tools default e aprovação host |
| Permissões | Opções do CLI instalado | Apenas read-only/workspace-write; on-request; configuração workspace-write fixa networkAccess=false | Read-only restringe ferramentas; workspace-write usa manual/host ou plan/host; não reproduz todas as políticas do CLI |
| Aprovações | Diálogos nativos | Accept/decline para commandExecution e fileChange | Allow/deny para can_use_tool |
| Perguntas estruturadas | Respostas e seletores nativos | Host requests fora das duas aprovações são rejeitados | Control requests fora de can_use_tool recebem Unsupported host request |
| Mensagem enquanto executa | Interação/fila nativa quando disponível | Sem steer/fila integrada; send recusa busy | Sem fila integrada; send recusa busy |
| Anexos/imagens | Conforme runtime/entrada nativa | attachments=false; turn input integrado só text/skill | attachments=false; conteúdo do usuário enviado como texto |
| Slash commands | Comandos da interface nativa | Subconjunto integrado; demais classificados unavailable ou unknown | Subconjunto desktop + comandos descobertos encaminhados ao SDK; sem garantia de equivalência de todos os TUI commands |
| Skills | Runtime/configuração nativos | skills/list + item skill explícito; OXE prompts resolvidos por contexto | Comandos SDK/skills + OXE prompts; skill shell execution bloqueado no read-only |
| MCP OXESpace | Bridge sem filtro Thread; execução autenticada para automação | Bridge próprio com 14 ferramentas permitidas de contexto/consulta/memória | Mesmo filtro, strict-mcp-config e permissão para esse servidor |
| Outros MCP/apps/plugins | Recursos e gestão nativos | Herança de configuração Codex possível; interfaces de listagem, sem gestão/autenticação completas; elicitation sem handler | strict-mcp-config limita este processo ao bridge explicitamente fornecido |
| Hooks/customizações | Configuração nativa conforme trust/policies | Sem equivalência/gestor integrado completo; não há base para afirmar que todos os hooks Codex estão desativados | disableAllHooks=true em ambos os modos de acesso |
| Retomar sessões | Histórico/seletores nativos | Resume por nativeSessionId das Threads registradas; não é browser completo do histórico CLI | Resume por nativeSessionId das Threads registradas; não é browser completo do histórico CLI |
| Rename/archive/delete | Operações da interface nativa | Operações locais OXESpace; delete mantém sessão do provider | Mesma semântica local |
| Fork/rewind | Operações nativas quando disponíveis | Integração nativa fork/rollback; rewind não desfaz arquivos | Sem equivalente integrado desses comandos Codex |
| Contexto/histórico | Gestão nativa do provider | Contexto nativo, mas novos sends barrados por limite local de eventos/JSON | Mesmo limite local adicional |
| Várias sessões | Vários terminais/panes Code visíveis | Várias Threads podem executar por ID, mas uma conversa selecionada visível; sem grade Thread | Mesma limitação de visualização |
| Subagentes/delegação | Runtime nativo e delegação OXESpace quando configurados | Sem gestão/ciclo/renderer completos; bridge Thread não expõe delegação | Sem gestão integrada equivalente; bridge Thread não expõe delegação |
| Git/editor/Preview | Ferramentas nativas + painéis Code existentes | Agente pode usar Git se permitido; UI Thread tem revisão, não painel completo stage/commit/PR/editor/Preview | Mesma limitação de UI e permissões próprias de Claude |
| Transparência de arquivos | Saída nativa + ferramentas Code | Patch nativo, resumo/diff por turno, artefatos e comentário para rascunho | Entrada/resultado Edit/Write/MultiEdit; ainda não é baseline de disco independente |
| Activity/output | Saída TUI preservada pelo terminal | Renderers de subconjunto de eventos; sem handler de command output delta; saída agregada limitada | Subconjunto assistant/tool_result; sem renderer completo para todos os eventos do SDK |
| Usage/reset | Informações disponibilizadas pelo CLI/conta | account/rateLimits/read + diagnóstico; não equivale a painel completo de contexto/custo | Diagnóstico de falha; sem consulta equivalente de janelas/reset integrada |
| Voz | OXEVoice em terminal/editor Code e capacidades nativas quando disponíveis | Compositor sem integração OXEVoice | Compositor sem integração OXEVoice |
| Providers | Perfis de terminal configurados no Code | Apenas Codex ou Claude no contrato Thread | Apenas Codex ou Claude no contrato Thread |

## Limitações que afetam tarefas reais

1. **Perguntas/aprovações adicionais:** Codex hostRequest aceita somente requestApproval de comando/arquivo. requestUserInput, permission requests e elicitation MCP podem ser rejeitados. Uma tarefa que depende desse diálogo pode falhar, mesmo usando o mesmo modelo. Claude também não implementa todos os control requests.
2. **Ambiente/permissões diferentes:** workspace-write não significa full access. Rede no sandbox Codex configurado fica desabilitada. Claude read-only também reduz built-in tools e bloqueia shell execution de skills; hooks ficam desativados mesmo no write.
3. **Comandos com nomes iguais, efeitos diferentes:** /resume navega entre Threads locais compatíveis; /rename altera título local; /archive e /delete alteram registros OXESpace, mantendo sessão do provider; /stop interrompe o turno local ativo, não é inventário de background jobs; /export inclui mensagens, sem pacote completo de tools/artefatos; /permissions só aceita os dois níveis integrados; /plan aceita on/off, não um prompt inline arbitrário. /apps e /plugins listam campos públicos, não implementam toda a gestão nativa.
4. **Limites de histórico adicionais:** antes de send, 2.000 eventos ou JSON acima de 2 MiB exigem nova Thread. Save possui limite de 2.200 eventos/4 MiB. A migração de eventos/artefatos melhorou persistência, mas paginação e eliminação desses bloqueios ainda faltam. Compactação nativa não representa automaticamente uma limpeza desse histórico local. Patches possuem limite de 512 KiB e artefatos 64 MiB por Thread; esses limites de evidência não são o tamanho da janela de contexto do modelo.
5. **Automação interna incompleta:** o bridge Thread permite consultas, contexto e memória (inclusive remember e aceite de handoff), mas exclui scripts/mutações de worktree/delegação. Isso não remove a execução shell nativa do agente quando permitida; restringe especificamente ações MCP do aplicativo.
6. **Progresso/evidência incompletos:** eventos nativos sem renderer não significam necessariamente que a ação do motor não ocorreu. Não se deve confundir ausência de UI de subagentes com impossibilidade de o runtime chamar um subagente. Claude file evidence também não prova um diff de disco independente.

## Estado de maturidade e critério de paridade

Codex Thread: núcleo de desenvolvimento integrado, com paridade operacional parcial. Claude Thread: núcleo integrado, com diferenças adicionais em políticas, hooks e evidência de arquivos. Os avanços visuais não encerram essas lacunas.

Não atribuir uma porcentagem geral sem inventário versionado, pesos e pilotos. A certificação exige: (a) mesmo provider/modelo/esforço/root/histórico e políticas comparáveis; (b) manifesto de comandos com semântica e casos de erro; (c) perguntas/aprovações/steering/anexos/MCP operacionais; (d) retomada e históricos longos; (e) tarefas reais repetidas de edição/testes/Git/skills/MCP, com resultados comparados.

Prioridades: primeiro perguntas/aprovações avançadas e configuração efetiva de permissões; depois steering/fila e anexos; em seguida manifesto de comandos/sessões e automação MCP aprovada; completar histórico paginado, observabilidade e workbench; executar pilotos reais por provider.

## Evidências atuais

Fontes do checkout:

- `electron/main/services/terminal.service.ts`: lançamento PTY e ambiente do modo Code.
- `electron/main/services/conversation/thread-runtime.ts`: executável/perfil e adapters.
- `electron/main/services/conversation/codex-conversation.ts`: inputs, policies, handlers, comandos e eventos traduzidos.
- `electron/main/services/conversation/claude-conversation.ts` e `claude-command-catalog.ts`: built-in tools, hooks e control requests.
- `thread-commands.ts`, `shared/threadDesktopCommands.ts`: roteamento/indisponibilidade e nomes integrados.
- `thread-manager.ts`: ownership, comandos locais, retomada e bloqueios de histórico.
- `thread-mcp.ts` e `resources/mcp-bridge/oxespace-mcp.cjs`: lista permitida e filtragem de chamadas.
- `shared/types/thread.ts`: capabilities e contrato de entrada.
- `src/components/Threads/ThreadView.tsx`, `ThreadChangesPanel.tsx`: compositor e workbench.
- `docs/plans/thread-workbench/IMPLEMENTATION.md` e `conversation-actions-mcp.md`: validação já realizada e limites.

A entrega anterior passou 69 testes direcionados, native Codex MCP discovery contra RPC localhost sem inferência, Electron E2E, typecheck/lint/build. A entrega anterior do workbench registrou 918 testes aprovados. Esses resultados não constituem benchmark CLI/Thread ou prova de todos os comandos. Esta auditoria fez leitura do checkout, consulta de documentação e versões; não executou inferência nem modificou a implementação.

Documentação oficial consultada para confirmar recursos possíveis do protocolo/CLI:

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): inputs estruturados, perguntas/aprovações e steering são recursos do protocolo; faltam handlers no cliente atual.
- [Codex CLI](https://learn.chatgpt.com/docs/codex/cli): fluxo nativo de desenvolvimento e integrações.
- [Developer commands — CLI](https://learn.chatgpt.com/docs/developer-commands?surface=cli): referência de semântica dos comandos; disponibilidade deve ser confrontada com a versão instalada.
