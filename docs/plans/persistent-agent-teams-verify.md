# Equipes persistentes — implementação e verificação

2026-10-05, base beta.5 `9f36370`. Alterações locais, ainda sem commit/release.

## Incremento implementado

- Migração 061: equipes por identidade canônica do projeto, membros independentes de workspace/pane/Thread, coordenador único, revisão otimista, vínculos, mensagens, índices e referências.
- `TeamRepository`: troca atômica de coordenador, arquivamento preservando mensagens, metadados de vínculo nativo com unicidade e gerações, inbox paginada, recibos explícitos e deduplicação por remetente/chave/conteúdo.
- `TeamAccess`: conexão da execução ativa pela interface confiável; credenciais não persistidas. Vínculo de navegação persiste, mas reinício exige reconectar. Identidade e execução revalidadas após leitura assíncrona. Arquivamento/desconexão revogam acesso.
- IPC resolve o projeto Code ou Thread no backend e revalida diretório após await; não aceita identidade de projeto autodeclarada. Apenas frame principal do aplicativo.
- Interface Team compartilhada: cadastrar papéis, trocar coordenador, arquivar, conectar/desconectar sessão atual, consultar mensagens e enviar mensagens humanas para inbox. Estado salvo não é confundido com agente executando.
- MCP: `oxespace_team_status`, `oxespace_team_message`, `oxespace_team_inbox`, `oxespace_team_acknowledge`. Remetente derivado da execução autenticada, leitura sem consumo, sem digitação em PTY ou despertar automático.
- API de mensagens humanas deriva remetente humano no backend. UI não confirma recebimento em nome da LLM. Atividade paginada de 50 registros, janela visual limitada a 500.
- Delegação MCP agora declara `sourceThreadIds` e `includeMemory`, já aceitos pelo backend. Manifesto inclui bytes disponíveis antes do orçamento e flag de truncamento por fonte; isso descreve o snapshot selecionado, não o tamanho de todo o histórico nativo.

## Verificado

- Suite Electron: 1.192 testes passaram; 25 ignorados. Inclui 12 novos testes de repositório, autorização e IPC.
- Typecheck e build passaram; lint sem erros, 33 avisos existentes.
- Playwright `e2e/team.spec.ts`: cadastro real por IPC, mesmo projeto em Code/Thread, mensagem humana, nenhum recibo inventado, reinício preservando equipe/mensagens e nenhuma criação adicional de workspace.
- Inspeção visual em janela curta; modal e rodapé dentro da viewport, conteúdo com rolagem, sem overflow horizontal no cenário testado. Não constitui auditoria visual completa do plano.

## Limites / próximos incrementos

- Onda 1 parcial: a conexão atual é autorização MCP para uma execução existente. Metadados de vínculo nativo ainda não integram uma transferência exclusiva de escritor entre Code/Thread. Não criar UI de controle que alegue essa garantia antes da integração com o runtime.
- Onda 3 parcial: comunicação durável local disponível; piloto com dois agentes autenticados, entrega conforme capacidades do provedor, notificações, tarefas e painel redimensionável ainda pendentes.
- Sem criação automática de sessões por equipe; delegação existente permanece separada e inalterada. Sem migração automática dos antigos grupos de integração nem de delegações para membros.
- Ampliar transferência de conhecimento e fontes Code, AI Memory e vinculação de resultados/tarefas continua pendente.
- Workflow de oito etapas, central de decisões humanas, Azure DevOps e integração Git ainda não implementados. Perguntados ao usuário os diretórios dos templates e o projeto Azure de teste; aguardando resposta.
- Gate da onda 0 permanece: sessão longa no instalado, campanha nativa Codex/Claude e validação prolongada ainda não concluídas. A integração opt-in adicionada em 2026-10-06 está descrita abaixo.
- Sem publicação externa ou nova release nesta etapa.

## Complemento de 2026-10-06 — entrega opt-in

- Migração 062 registra tentativa, envio submetido e resultado desconhecido por mensagem; submissão não significa acknowledgement do destinatário.
- Thread conectada pode receber inbox quando ociosa, sem tarefa nativa ativa. Consentimento é por execução e não sobrevive a reinício ou reconexão. Falha, interrupção ou perda de autorização suspendem entrega; aceitação incerta não gera replay.
- Code permanece com leitura explícita pelo MCP. Mensagens humanas continuam identificadas como humanas. Não há digitação automática em PTY.
- Contratos de autorização, persistência e deduplicação passaram em testes. Piloto de dois agentes reais e consolidação ainda pendente; esta integração não completa as demais ondas.
- Validação atual e limites: [beta.6 — candidato](../validation/release-0.16.0-beta.6.md).
