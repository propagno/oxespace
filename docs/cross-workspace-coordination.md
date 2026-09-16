# Delegação entre projetos

## Preparar

1. Ative **Workspace settings → Agent delegation** na origem e no destino.
2. Na origem, abra **Manage authorized destinations**, informe o caminho absoluto de um repositório Git local e confirme o compartilhamento do handoff com o agente de destino. Se ele ainda não é um workspace, será cadastrado sem iniciar um terminal nem clonar código.
3. Opcionalmente autorize evidências: arquivos de texto já commitados, selecionados pelo agente, limitados a oito arquivos e 64 KB no total. Alterações locais não commitadas não são transferidas.
4. A autorização dura 30 dias. Revogue pela mesma tela. Permissões nativas do Claude/Codex continuam aplicáveis.

## Pedir ao agente

> Consulte `oxespace_delegation_targets`. Delegue a análise dos workflows ao workspace de configuração autorizado, em modo `analysis`. Inclua os documentos commitados relevantes usando `evidenceFiles`. Não faça push ou merge. Acompanhe o resultado pela inbox.

`oxespace_delegate_task` mantém os campos anteriores (`key`, `agentProfileId`, `objective`, `handoff`, `acceptance`) e adiciona:

- `targetWorkspaceId`: destino autorizado; omitir mantém o workspace atual.
- `mode`: `analysis` ou `isolated-change`.
- `evidenceFiles`: caminhos relativos ao checkout da origem, como `docs/workflow.md`.

Antes de delegar, `oxespace_delegation_preflight` verifica o destino autorizado, commit base, ativação e efeitos previstos sem criar recursos. É um diagnóstico instantâneo, não uma reserva: a criação revalida as condições.

Ambos os modos iniciam uma sessão independente em worktree isolada do **destino**. `analysis` instrui o agente a não modificar arquivos, mas NÃO é sandbox de segurança: um agente com shell conserva as permissões concedidas pela sua CLI.

Reutilize a mesma `key` para repetir uma solicitação. Alterar o conteúdo com a mesma chave produz conflito. A chave é persistida por painel de origem, não pelo ID temporário da execução. A aplicação não faz push, merge ou clone por esse fluxo.

## Receber resultados

- O destinatário consulta `oxespace_delegation_context`, confirma `accepted` e entrega relatório/testes com `oxespace_delegation_update`, estado `review`.
- A origem consulta `oxespace_delegation_inbox` e `oxespace_delegation_result`. Este último inclui tarefa, resultados versionados e recibos de provisionamento.
- `oxespace_delegation_acknowledge` salva o cursor de leitura daquele participante. Omitir `after` na inbox usa os cursores salvos; `after: 0` permite replay. Ler não apaga mensagens.
- A UI mostra a tarefa na origem e no destino. Apenas a origem oferece retry, cancelamento e aprovação. Aprovar não faz merge.
- Notificações são da aplicação. Não há promessa de despertar um agente parado, nem digitação automática em terminal ocupado. O agente consulta eventos nos seus checkpoints ou na próxima interação.

## Reiniciar e recuperar

Tarefas em execução ficam `interrupted` após reiniciar a aplicação; não são relançadas cegamente. Código e worktree permanecem no disco. Na origem:

1. Abra um terminal de agente.
2. Na tarefa, selecione **Reconnect origin terminal** e autorize que ele acompanhe/controle a tarefa.
3. Use **Retry** apenas após verificar o estado preservado do código.

A reconexão também funciona em outro painel: a chave original passa a identificar a mesma tarefa nesse painel. Se ele já usa essa chave para outra tarefa, a reconexão é rejeitada; escolha outro terminal. Repetir a solicitação após reconectar não cria uma segunda worktree.

O novo token não reutiliza a identidade da execução encerrada. Conhecer o taskId ou pertencer ao mesmo workspace não dá acesso automaticamente. Revogar um destino bloqueia novas entregas via MCP e retries; não recolhe conteúdo já entregue e não encerra automaticamente um shell em execução. Para encerrar a tarefa use Cancel, que preserva o código.

## Dados e segurança

Tarefas, snapshots selecionados, grants, eventos, cursores e resultados ficam no SQLite local do OXESpace. Não dependem do AI Memory. Memória e CodeGraph enriquecem o contexto de forma opcional, no checkout de destino; não há fusão das memórias dos projetos.

Evidências incluem SHA do commit e hash SHA-256 do texto. Links simbólicos, traversal, binários, arquivos sensíveis comuns e alguns padrões de credenciais são rejeitados. A detecção é uma defesa adicional, não uma garantia: revise o material antes de autorizar seu envio a agentes em nuvem.

O MCP interno herda tokens do ambiente do terminal gerenciado; a sincronização não grava esses tokens em `.mcp.json`. Arquivos já commitados com tokens não são removidos do histórico por esta alteração: precisam de revisão e rotação separadas. CLIs iniciadas fora do OXESpace não recebem automaticamente esse ambiente.

Não há limpeza automática de tarefas/evidências nesta versão. Backups do banco podem conter esse conteúdo. Cancelamento preserva dados e não equivale a exclusão.

## Limites desta entrega

- Cadastro/autorização de destino usa a UI confiável; o MCP descobre os destinos já autorizados e não concede permissão a si próprio.
- Só evidências commitadas; snapshots de dirty files e consentimento por conjunto individual de arquivos ainda não estão disponíveis.
- Não há clonagem, delegação recursiva, sandbox de processo, wake-up universal ou mesclagem automática.
- Grupos de integração existentes continuam independentes; participar de um grupo não concede permissão de delegação.
- Limites: quatro tarefas ativas por projeto, doze globais; Claude/Codex usam os adapters existentes.

## Validação

`node scripts/test-electron.mjs tests/integration/coordination.workflow.test.ts` usa Git/SQLite reais e agentes simulados para validar roteamento, concorrência, evidências, revogação e recuperação. O teste nativo `agent-launch.native.test.ts` com `OXESPACE_TEST_AGENT_LAUNCH=1` valida argumentos das CLIs via PTY usando `--help`, sem chamadas a modelos. O E2E `cross-workspace-coordination.spec.ts` valida UI/consentimento com backend simulado; não substitui um piloto com agentes reais autenticados.
