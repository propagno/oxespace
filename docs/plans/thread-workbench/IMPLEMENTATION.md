# Thread workbench — entrega de transparência e revisão

Data: 2026-09-18. Estado: primeira entrega implementada; o plano completo de paridade continua em andamento.

## Comportamento entregue

- Arquivos informados pelas ferramentas aparecem na conversa com operação, estado e contagens extraídas do patch, quando disponíveis. O nome abre a revisão; a seta expande a evidência dentro da conversa, carregando o conteúdo sob demanda.
- A conclusão mostra arquivos únicos. O evento público `turn/diff/updated` do Codex fornece o diff consolidado do turno, inclusive quando um arquivo sofreu várias edições. Sem esse evento, operações repetidas não são somadas como saldo final. Falhas, patches incompletos, binários e entradas de ferramenta não recebem totais fictícios.
- Claude Edit/Write/MultiEdit preservam a entrada e o resultado correspondente. A interface distingue essa evidência de um diff de disco confirmado; não calcula linhas a partir da intenção.
- Review abre ao lado do chat com Session changes, Project changes, Plan e Activity. Largura ajustável por ponteiro/teclado; preferência de largura persistida; seleção de revisão separada por Thread. A conversa e seu compositor permanecem montados.
- Abaixo de 1.000 px disponíveis no workbench, Review usa um drawer Radix com foco controlado, Escape, overlay e retorno ao compositor. O breakpoint considera o espaço após o sidebar.
- Comentários em linhas de diff entram no rascunho da mesma Thread, preservando o texto anterior e incluindo arquivo/lado/linha/revisão. Não há envio automático nem inserção em terminal. Os históricos usam hash do artefato; o snapshot atual de Git usa identificação datada e não é apresentado como evidência imutável do agente.
- `/diff` abre Project changes integrado. A consulta resolve o root a partir do ID da Thread no main; não recebe diretório do renderer e não usa GitHub/rede. Mostra mudanças **tracked** versus HEAD, incluindo trabalho anterior; untracked estão explicitamente excluídos. Branch sem HEAD usa a árvore vazia, evitando somar staged e unstaged do mesmo arquivo.
- Plan recebe o progresso público do Codex; Claude TodoWrite só aparece após resultado de ferramenta bem-sucedido. Não inventa passos a partir do texto da resposta.
- Novos pedidos registram turno local, início/fim, configuração disponível e ID nativo quando observado. A conclusão mostra duração/configuração; histórico legado não recebe horários inventados.

## Persistência e compatibilidade

A migração 054 adiciona eventos indexados por Thread/seq/turno, turnos e artefatos separados. O primeiro read importa o JSON legado em uma transação e marca `history_version=1`; leituras posteriores não duplicam eventos. O runner tolera reentrada em schema já criado, sem apagar dados.

Patches não entram no snapshot nem no `events_json`. Artefatos possuem SHA-256, tamanho, fonte e indicador de incompletude; são buscados por `threadId + artifactId`. O mesmo conteúdo é deduplicado dentro da sessão. Limites: 512 KiB por patch e 64 MiB de evidência por Thread; evidência excedente fica incompleta, sem contagem exata. Exclusão da Thread/workspace remove eventos, turnos e artefatos por cascade. Artefatos históricos deixam de ser acessíveis após rewind, mas permanecem no limite de retenção até excluir a Thread.

Saves comparam os eventos e atualizam somente linhas alteradas no SQLite. Deltas consecutivos são agrupados por até 80 ms, com flush antes de conclusão/aprovação/configuração, read e shutdown. Exclusão durante streaming libera o adapter imediatamente. Metadados e patches não compartilham o mesmo limite de JSON.

Contratos novos são aditivos: `files`, `turns`, `artifact` e `projectDiff` opcionais; eventos antigos continuam legíveis. Novos eventos de plano/diff não exigem mudanças nos consumidores Code/PTY. Preload, IPC e manager foram atualizados juntos; a migração e a versão máxima do banco foram atualizadas juntas.

## Validação

- 107 testes direcionados de Threads, providers, falhas, Markdown, navegação e migrações passaram; mais dois testes com repositórios Git reais passaram para isolamento de worktrees e branch sem HEAD.
- Testes novos verificam importação idempotente, ownership de artefatos, truncamento, persistência após novo reader, exclusão/cascade, gravação incremental, flush de streaming, patch consolidado e comentários sem envio automático. Fixtures de adapters cobrem rename, recusa e progresso público.
- E2E Electron com providers simulados cobre expansão inline, revisão lateral/drawer em 1440/900 px, modelos/permissões, comentário/réplica do rascunho, menus Changes/Plan/Activity, fechamento/foco e preservação dos terminais Code. Capturas estão em `test-results/thread-workbench-1440.png` e `thread-workbench-900.png`; cópias revisadas serão mantidas nesta pasta.
- Schema do Codex **0.154.0 instalado** foi gerado localmente para conferir FileUpdateChange, PatchChangeKind, TurnDiffUpdatedNotification e TurnPlanUpdatedNotification. Essa verificação e as fixtures não substituem pilotos de edição com inferência real de Codex/Claude nem validação empacotada em Linux.
- Typecheck e build passaram; entradas seguem dentro dos budgets. Lint dos arquivos desta entrega sem erros. O runner de banco contém quatro avisos antigos de diretivas eslint desnecessárias.
- O quality controller examinou o checkout completo com mais de 200 arquivos alterados de diversas entregas e marcou `CONTRACT_CONSUMERS_UNCHANGED`/`HIGH_BLAST_RADIUS`: 592 referências fora do diff. Seus sete critérios receberam evidência heurística; isso não é aprovação de runtime. A suíte completa final passou: 918 testes, zero falhas e 22 opt-in ignorados (940 no total). Três expectativas antigas de Tools/token bridge/allowlist nativa foram identificadas e alinhadas ao comportamento já existente, preservando as restrições de arquivos.

## Próximas etapas ainda obrigatórias

R03/R10: consulta paginada, timeline virtualizada, importação de turnos legados e benchmark. A API ainda lê o histórico completo e mantém os limites atuais de mensagens/eventos; o novo armazenamento não significa histórico ilimitado.

R05/R06: diff confirmado de Claude, baselines próprios para mudanças via shell/external e sinalização de autoria concorrente. O saldo do Codex nesta entrega vem do protocolo público, não de uma captura independente de todo disco.

R07/R09/R11: referências locais Markdown/editor, Files, watcher multiplexado para trabalho externo, untracked, Reviewed e comentários persistidos com revalidação de âncora. A consulta atual de Project changes tem atualização explícita.

R12–R14: stage/commit, branches/worktrees/PR e Undo com preservação de dirty/index e prévia de conflito. Nenhum desses botões foi apresentado como pronto nesta entrega.

R15–R24: perguntas estruturadas, fila/edição/retry, busca/exportação rica, anexos/menções/voz, Preview/Terminal, sidebar de uso, grid 2–4 sessões, subsessões/equipes, rotinas, agentes adicionais e catálogo completo de comandos. A Thread continua sem fallback automático para Advanced CLI.
