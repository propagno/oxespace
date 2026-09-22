# Implementação e validação — 2026-09-17

O plano está parcialmente implementado. A06 (paridade de todos os comandos) NÃO está concluído.

## Implementado

- Rodapé com catálogo nativo de modelos e esforços, permissões e modo de planejamento; nenhuma opção de esforço inventada. Descoberta independente de digitar `/`, com cache por provider/executável/diretório e single flight.
- Configuração por conversa, revisão para impedir gravações concorrentes e fila para o próximo turno. Draft preservado. Codex confirma `thread/settings/update`; Claude aplica argumentos ao próximo processo, retomando a mesma sessão.
- Atividades consecutivas agrupadas em um resumo de 36 px. Comandos, saídas, status e código de saída inspecionáveis. Aprovações e mensagens interrompem o agrupamento.
- Painéis locais para configuração, status, renomeação, sessões, cópia/exportação textual, diff e confirmação de arquivamento/exclusão. Conversas arquivadas saem do sidebar e podem ser reabertas por `/resume`.
- Operações Codex de limites, MCP, apps, plugins, fork e rewind via App Server. Listas de integrações são consulta, não administração completa.
- Slash não abre Advanced CLI. O endpoint IPC de abertura também rejeita novos acessos. Recuperação de sessões legadas preserva o leitor de histórico nativo e libera a conversa.
- Nomes desconhecidos são rejeitados antes da inferência. Comandos sem handler aparecem indisponíveis, sem fallback para terminal.

## Provas executadas

- TypeScript: passou.
- ESLint: zero erros, 32 avisos existentes.
- 45 testes de UI/store/adapters/catálogos/preload, mais um teste de cache de modelos e 16 testes de gerenciamento SQLite/Electron: passaram.
- Electron E2E: passou; modelos/esforço/permissões integrados, draft, scroll longo, sidebar, autenticação, voz descartável, tamanhos reduzidos e zoom 125/150%.
- Build e limites de bundle passaram (main 901/904 kB).
- Piloto nativo Codex sem inferência: catálogo, criação efêmera e atualização de modelo/esforço reconhecidos. A primeira tentativa falhou por falta de `capabilities.experimentalApi`; após habilitar, passou. O teste não prova um turno completo de inferência.
- Screenshots em `test-results/thread-900.png`, `thread-integrated-controls-900.png`, `thread-model-picker-900.png`, `thread-scale-1.25.png` e `thread-scale-1.5.png`. São fixtures Electron, não respostas de produção.

## Pendências para concluir o plano

- Manifesto de paridade e handlers/testes para o restante do catálogo nativo. Os comandos indisponíveis NÃO contam como implementados. Incluem configurações nativas avançadas, hooks, memória, background/subagents, goal, voz nativa, sandbox/setup e comandos específicos de terminal/desktop.
- Integrações Claude de fork/rewind/usage/MCP/plugins e entrada estruturada solicitada pelo agente; gestão completa de integrações Codex; paginação das listas nativas.
- `/resume` lista conversas conhecidas pelo OXESpace, não todas as sessões externas. Rename/archive/delete são locais e a confirmação informa que a sessão do provider é mantida. Export é texto copiável, ainda sem download de arquivo.
- Provar produção de turnos reais com alteração de modelo/esforço e permissões para ambos os providers. Catálogo e mocks não provam inferência nem edição real.
- Catálogo do modelo padrão pode diferir de overrides externos; sincronização/invalidação após mudanças externas de conta/configuração e janela de histórico longo ainda precisam ser completadas.

Não declarar o plano completo enquanto essas pendências existirem. A referência visual e os seletores já estão implementados, mas isso não equivale à paridade total pedida.
