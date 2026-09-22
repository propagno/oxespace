# Paridade de Thread — referências e lacunas

Inspeção: 2026-09-18. OXESpace atual versus ZIP local cdesktop 0.2.3 e três imagens do usuário. **Código presente não significa recurso executado/validado.** Nesta sessão não iniciamos o cdesktop, não instalamos dependências e não fizemos inferência. Os itens do cdesktop abaixo indicam correspondentes de implementação, não uma garantia de que funcionam sem bugs.

Imagem 1: referência Codex Desktop para transcript de arquivos, resumo por turno, revisão/diff e ações Git. Imagem 2: catálogo e cabeçalho dos painéis do cdesktop. Imagem 3: conversas lado a lado e navegação de sessões. O alvo combina essas experiências com a identidade do OXESpace.

Legenda OXE: **base** = existe na Thread; **parcial** = existe parte da semântica; **Code** = existe fora da Thread e precisa integração; **lacuna** = sem correspondente identificado na Thread. Escopo implementado e validações atuais em [IMPLEMENTATION.md](IMPLEMENTATION.md). Recursos futuros permanecem pendentes no [plano](PLAN.md).

| ID | Recurso de referência | Evidência | OXESpace hoje | Entrega/critério |
|---|---|---|---|---|
| P01 | Sidebar de sessões/projetos, busca e pin | Imagem 3, C15 | Base: grupos, filtro, branch, pin, criação/exclusão/hide | W4/R19: recentes/More, estado acessível e hierarquia consistente |
| P02 | Troca imediata, rascunho/scroll por sessão | C06,C12,C15 | Parcial: guarda draft/scroll, mas uma única snapshot selecionada | W2/R10 e W5/R20: cache paginado e células sem vazamento |
| P03 | Transcript com renderers por ação | C01 | Parcial: renderers de arquivo, planos/todos públicos e tools agrupadas | W1/R04–R07: arquivo/comando/public progress/teste observado |
| P04 | Arquivo editado com +/− e status | Imagem 1, C02 | Base Codex: patches/status/+− preservados; Claude: entrada/resultado explícitos, sem contagem inventada | W1: status confirmado e contagem real por operação |
| P05 | Diff expansível dentro da conversa | C02, FileChangeRenderer | Base: expansão inline com artefatos carregados sob demanda | W1/R07: patch histórico inline sob demanda |
| P06 | Lista consolidada de arquivos ao concluir | Imagem 1, agregação C01,C02 | Parcial: arquivos únicos e saldo do evento agregado Codex; sem saldo falso para operações repetidas | W1/R06–R07: únicos/saldo sem dirty anterior; resumo do turno é extensão específica do alvo |
| P07 | Abrir arquivo da conversa no Changes/editor | C02,C04 | Parcial: entradas de tool/resumo abrem Changes; Markdown/editor pendentes | W2/R08–R09: arquivo/linha/root/revisão corretos |
| P08 | Comandos executados e output inspecionável | C01,C13 | Base: detalhe, output e exit code ao completar | W1/W4: streaming público quando disponível, duração e origem |
| P09 | Agrupar ferramentas/edits sem perder detalhes | C01,C02 | Parcial: tools agrupadas, arquivos acessíveis e resumo por turno | W1/R07: resumo compacto e arquivos individualmente acessíveis |
| P10 | Markdown, tabelas, listas e código | C01, imagem 1 | Base: GFM/scroll/cópia já corrigidos | Preservar; W1 só acrescenta referências de arquivos seguras |
| P11 | Plano/todos e progresso | C01,C16 | Base: plano público Codex e TodoWrite confirmado Claude; painel Plan integrado | W4/R15: tarefas/status por evento; painel Plan é proposta OXE |
| P12 | Perguntas do agente e respostas interativas | C01,C13, tipos ActionType | Lacuna: requests desconhecidos rejeitados | W4/R15: inputs vinculados ao request/turno correto |
| P13 | Aprovações de edição/comando e feedback | C01 | Base: aprovação/negação simples | W4/R15: escopo, preview e reconexão/timeout sem decisão automática |
| P14 | Erros detalhados e status da execução | C01,C13 | Base: diagnóstico sanitizado/código/HTTP/horário e uso Codex | W4/R19: refinamento persistente; não reimplementar nem regredir |
| P15 | Catálogo de painéis, resize/fechar/expandir | Imagem 2,C03 | Parcial: menu Changes/projeto/Plan/Activity, resize, drawer e fechar/foco; outros painéis pendentes | W2/R08: menu único, estado e foco estáveis |
| P16 | Changes: múltiplos arquivos, diff unificado/split | Imagem 1,C04 | Parcial: revisão de sessão versus Git tracked atual, diff unificado; split/untracked/watchers pendentes | W2/R09: reutilizar renderer, separar atual versus histórico |
| P17 | Comentar diff e mandar revisão ao agente | C04 | Parcial: comentário por linha entra no rascunho da mesma Thread, com revisão; persistência/revalidação pendentes | W3/R11: envio explícito à Thread e âncoras por revisão |
| P18 | Busca/Reviewed/copy/editor no review | C04 | Code: grande parte já existe | W3: contextualizar, manter review distinto de stage |
| P19 | Stage/unstage por arquivo; por hunk quando suportado | Imagem 1,C05 | Code/services: operações por arquivo; sem UI Thread | W3/R12: índice real, revisão e refresh; hunk exige implementação específica |
| P20 | Commit e descrição/mensagem | Imagem 1,C05 | Code/services: commit/generate message | W3/R12: somente staged, resultado observável e erro de hooks |
| P21 | Branch/push/PR/merge | C05, README | Code/services: branch/push/PR; sem equivalência Thread completa | W3/R13: GitHub auth separada, ações remotas explícitas; investigar merge antes de habilitar |
| P22 | Worktree isolada opcional por sessão | C05, README | Code/services: criação de worktrees; Thread herda contexto | W3/R13: escolha antes de executar e vínculo durável por sessão |
| P23 | Undo/reverter alterações selecionadas | Imagem 1 (Undo), UI de revisão C04 | Code: checkpoints incompletos para Undo de turno; sem Thread | W3/R14: baseline/hashes/índice; não alegar Undo completo do cdesktop só pela imagem 1 |
| P24 | Árvore de arquivos/editor contextual | FileTreeContainer, README roadmap | Code: FileBrowser/editor/filesystem | W2/R09: raiz inteira da Thread; referência tem limites de árvore declarados no roadmap |
| P25 | Preview embutido/devtools/inspeção | C03, PreviewBrowserContainer | Code: browser/preview existente | W4/R18: contexto/URL/ciclo de serviço da Thread |
| P26 | Terminal auxiliar e logs | Imagem 2,C03 | Parcial: Activity integrado; shell auxiliar e Preview ainda pendentes | W4/R18: shell explícito em painel; nenhum fallback de slash |
| P27 | Modelo, esforço e permissões por execução | C13, tipos ExecutorConfig | Base: catálogo/config revision/pending | W4/R17,R19: configuração efetiva, ampliar policies apenas com suporte real |
| P28 | Contexto/token usage e quota | C13,C14 | Parcial: usage Codex/reset existe; contexto/custo persistentes ausentes | W4/R19: fonte/instante, distinguir quota/contexto/custo |
| P29 | Anexos, upload/paste e referências | C09,C13 | Lacuna: attachments=false nos adapters | W4/R17: entrada estruturada/capability e limites por provider |
| P30 | Voz | README roadmap | Code: OXEVoice; não integrada no compositor Thread | W4/R17: incremento OXE; não contar como funcionalidade já comprovada no cdesktop |
| P31 | Fila de prompts durante execução | C07,C13 | Lacuna: send bloqueia quando busy | W4/R16: editar/cancelar, configuração vinculada, pausa em falha/restart |
| P32 | Editar mensagem/repetir e recuperação | C08 | Parcial: retry de auth, fork/rewind Codex | W4/R16: sem reset silencioso; proposta de retry/fork explicita efeito |
| P33 | Pesquisa/exportação/history rico | C12, estrutura de transcript | Parcial: export textual; histórico limitado | W2/W4: paginação, busca completa e save/export com artefatos |
| P34 | Até quatro sessões lado a lado e drag | Imagem 3,C06 | Lacuna: único selectedId/snapshot Thread | W5/R20: drafts/painéis/foco/cancelamento independentes |
| P35 | Subagents/equipe com agentes mistos | C01,C11, rotas teammates | Code/services: delegação existente, sem renderer/ciclo integrado Thread | W5/R21: sessões nativas separadas, resultados/link/cancel |
| P36 | Tarefas/processos em background | C01,C13 | Code/services: scripts/jobs; eventos Thread limitados | W4/W5: inventário observado, origem e controle por tarefa |
| P37 | Templates e rotinas recorrentes | C10 | Lacuna na Thread | W6/R22: agendamento/timezone/next run/histórico/pause |
| P38 | Cinco agentes e catálogo de providers | README, tipos executors, presets | Parcial: Thread Claude/Codex; Code mais profiles | W6/R23: Gemini/OpenCode/Hermes, capabilities/settings/credenciais por runtime |
| P39 | Configuração de MCP/apps/plugins/skills/hooks | C13, estruturas de settings | Parcial: discovery/skills e listas Codex, não gestão completa | W6/R23,R24: aplicar/testar/autenticar; preservar falta de API como lacuna |
| P40 | Slash e atalhos funcionais | C13, comandos de referência | Parcial: subset integrado; comandos restantes indisponíveis | W6/R24: manifesto por versão; sem Advanced CLI e sem literal prompt |
| P41 | Idioma, teclado e layout adaptável | README, uso de i18next nos componentes | Parcial: tokens/keyboard/responsivo, labels Thread em inglês | W0/W7: contrato de idioma consistente com app e acessibilidade; i18n amplo é tarefa específica |
| P42 | Browser/mobile/servidor remoto e instaladores Tauri | README | Electron desktop local existente | Projeto separado; não necessário à paridade de sessões desktop; não importar Rust/Tauri por conveniência |

## Fontes locais inspecionadas

Raiz cdesktop: `C:/Users/dudu-/Downloads/cdesktop-main/cdesktop-main/`. Prefixos abaixo são relativos a essa raiz; servem para rastrear o achado no ZIP fornecido.

| Código | Arquivo(s) |
|---|---|
| C01 | `packages/web-core/src/features/workspace-chat/ui/DisplayConversationEntry.tsx`; `shared/types.ts` (`NormalizedEntryType`, `ActionType`, `FileChange`) |
| C02 | `packages/ui/src/components/ChatFileEntry.tsx`, `ChatAggregatedDiffEntries.tsx`; `packages/web-core/src/shared/components/NormalizedConversation/FileChangeRenderer.tsx`, `EditDiffRenderer.tsx` |
| C03 | `packages/web-core/src/pages/workspaces/panels/panelCatalog.ts`, `PanelMenu.tsx`, `PanelHost.tsx` |
| C04 | `packages/web-core/src/pages/workspaces/ChangesPanelContainer.tsx`; funções/callbacks de review, seleção, diff modes e workers |
| C05 | `packages/web-core/src/pages/workspaces/GitPanelContainer.tsx`; status, branches, push, ações Git/PR |
| C06 | `packages/web-core/src/pages/workspaces/cells/SessionGrid.tsx`; `packages/web-core/src/shared/stores/useSessionGridStore.ts` |
| C07 | `packages/web-core/src/features/workspace-chat/model/hooks/useSessionQueueInteraction.ts` |
| C08 | `packages/web-core/src/features/workspace-chat/model/hooks/useMessageEditRetry.ts` (restauração tem diálogo; comportamento não será copiado cegamente) |
| C09 | `packages/web-core/src/features/workspace-chat/model/hooks/useSessionAttachments.ts` |
| C10 | `packages/web-core/src/shared/components/routines/RoutineForm.tsx`, `RoutineFormModal.tsx`, `RoutinesListContent.tsx`; `crates/server/src/routes/routines.rs`, `routines_scheduler.rs` — localização por busca, sem auditoria completa do scheduler |
| C11 | `packages/web-core/src/features/workspace-chat/ui/TeamPillRowContainer.tsx`, `SpawnTeammateModal.tsx`; `crates/server/src/routes/teammates.rs` — localização por busca, sem piloto de equipe |
| C12 | `packages/web-core/src/features/workspace-chat/model/useConversationVirtualizer.ts`, `sessionSnapshotCache.ts` |
| C13 | `packages/ui/src/components/SessionChatBox.tsx`; `packages/web-core/src/features/workspace-chat/ui/SessionChatBoxContainer.tsx` |
| C14 | `packages/ui/src/components/ContextUsageGauge.tsx` — localizado, uso/config/contexto em C13 e shared/types |
| C15 | `packages/web-core/src/pages/workspaces/WorkspacesSidebarContainer.tsx`, `WorkspacesLayout.tsx` — localizados; imagem 3 complementa composição |
| C16 | `packages/web-core/src/features/workspace-chat/model/hooks/useTodos.ts` |

O `panelCatalog.ts` enumera cinco painéis: preview, changes, terminal, git e logs. Não há Plan ou Files nesse catálogo específico; os painéis dedicados no alvo OXESpace são uma adaptação consciente. Árvores, tarefas e planos têm outras representações na referência.

Hashes SHA-256 conferidos para fixar a inspeção mesmo sem `.git`:

```text
panelCatalog.ts             A76CE1F7022B88627A092B304BE2CB2922BA68247F875287A6DF6B54EC665947
DisplayConversationEntry  D26A4BB0D8ABDCC0EFE70ED94233021CB2D55164B8A690CCF697903EA5E48E8E
useSessionGridStore.ts     60C4B254F2954FE18D7C4C5707A9E4C63E5CB04932D6632C4FE2DAB4D4230ED7
```

Licenças identificadas no ZIP: `LICENSE` Apache-2.0 e `NOTICE` com origem vibe-kanban e conteúdo cc-switch. O plano propõe reimplementação no stack do OXESpace; qualquer reutilização literal futura deve identificar arquivo e preservar os avisos aplicáveis. Nenhum código do cdesktop foi copiado para o app nesta sessão.

## Forma de comprovar paridade

Acrescentar ao manifesto por recurso: provider/runtime, versão, método/API/equivalente, plataformas, caminho de implementação, teste, captura e resultado de piloto. Status: planejado, em execução, parcial, implementado, verificado. Um menu visível/lista descoberta/mock aprovado não recebe status verificado de integração nativa.

Primeiro lote obrigatório: P03–P09 + P15/P16/P24. Segundo: P17–P23. A paridade completa das sessões desktop requer também as demais linhas funcionais aplicáveis; W1/W2 não encerram o objetivo geral.
