# Conversation actions e MCP na Thread

Implementação: 2026-09-18.

## Ações da conversa

O modal de lista foi substituído por um dropdown Radix ancorado no botão de três pontos. Usa os mesmos tokens de superfície, tipografia, bordas e cores do modo Code. Ícones e separadores agrupam informações/navegação, exportação/fork e arquivamento/exclusão. Excluir recebe destaque destrutivo e mantém a confirmação existente. Fork aparece para Codex. Escape fecha o menu, devolve foco ao botão e preserva o rascunho.

Evidência visual: `conversation-actions-implemented.png`.

## Causa da indisponibilidade do MCP

`thread-runtime` iniciava Codex app-server sem os argumentos MCP usados nos terminais Code. `subscriptionEnvironment` também removia todas as variáveis OXESPACE do processo; isso evitava herdar o contexto de outro terminal, mas não havia reposição de contexto próprio. Claude utilizava strict-mcp-config com uma configuração vazia.

Agora o main prepara um contexto para a Thread, com workspace explícito e memory run associado ao root da conversa quando a memória do projeto está habilitada. O transporte aceita apenas as quatro variáveis MCP autorizadas fornecidas pelo main; credenciais API e credenciais de execução do terminal pai continuam excluídas. O lease de memória termina ao descartar o adapter, inclusive após falha de inicialização/cleanup. IDs e tokens não entram em argumentos CLI, no renderer nem no painel de status.

Os dois providers recebem a configuração explícita do bridge. Na Thread, o bridge disponibiliza uma lista de ferramentas de consulta/contexto e memória, incluindo remember e aceite de handoff. Scripts, mutações de worktrees e delegação não são expostos por essa conexão até existir aprovação adequada para essas operações na Thread. A filtragem ocorre na descoberta e na chamada. A configuração MCP e o comportamento dos terminais Code permanecem compatíveis.

O bridge oferece **tools**, não resources nem templates. `/mcp` no Codex mostra as contagens desses três tipos; recursos/templates vazios não são apresentados como falha. A leitura de status permite até 60 segundos para inicialização nativa. Outros métodos mantêm seus limites anteriores. Memória requer a preferência do projeto habilitada; registrar o MCP não habilita memória silenciosamente.

Reiniciar a versão atualizada do aplicativo reinstala o script do bridge e recria os processos das conversas. Não é necessário apagar a Thread ou autenticar novamente apenas por essa mudança.

## Validação

- Typecheck e lint dos arquivos alterados.
- 69 testes direcionados: adapters, transporte, manager, memória, bridge e UI.
- Codex instalado: descoberta real do catálogo MCP contra RPC localhost de teste, sem inferência, com workspace próprio e exclusão de automação.
- Electron E2E: conversa/revisão, dropdown compacto, Escape/foco, rascunho preservado e quantidade de terminais estável.
- Build e limites de bundle.

O teste nativo valida a conexão com RPC de teste; não é uma execução de ferramenta pelo modelo contra o aplicativo em produção. Claude possui validação de configuração e transporte nesta entrega; não foi realizada inferência nativa de Claude.
