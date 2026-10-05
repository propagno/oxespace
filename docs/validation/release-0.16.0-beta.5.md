# OXESpace 0.16.0-beta.5

## Melhorias

- Histórico nativo Codex e Claude carregado em páginas, com leitura em worker e cursor persistido entre reinícios. Carregamento de mensagens anteriores sob demanda.
- Consulta do estado real do Codex durante silêncio e após reinício, sem reenviar automaticamente mensagens.
- Recuperação de respostas e resultados individuais de ferramentas de turnos confirmados, incluindo evento final perdido. Persistência atômica antes de liberar o turno; fila preservada.
- Perguntas históricas recuperadas como registros somente de leitura com resposta não confirmada; conteúdo preservado ao copiar e exportar.
- Correção de disputa no envio de respostas: pedidos invalidados não reaparecem após falha tardia. Detalhes de aprovações encerradas podem ser consultados sem conceder permissão novamente.
- Melhorias de foco, contraste, modais, densidade da navegação e preservação da janela de leitura ao alternar Code/Thread.

## Escopo de validação e limites

Os registros detalhados estão em `docs/plans/thread-consolidation-2026-10/VERIFY.md`.
Probes Codex reais cobriram sessões curtas, perguntas com opções, recusa de aprovação e recuperação com evento final descartado. A leitura do histórico de uma sessão longa também foi medida, sem inferência nessa sessão.

Esta versão permanece beta. A campanha completa da sessão longa no aplicativo instalado, Claude autenticado, MCP/anexos/fila/cancelamento reais e soak de duas horas ainda não estão concluídos. Recuperação de pedidos nunca recebidos e registros nativos acima dos limites suportados permanecem pendentes. A recuperação Codex não significa reconciliação universal para todos os provedores.

Recursos de equipes persistentes, coordenador/integrador, workflow de produto e Azure DevOps não fazem parte desta release.
