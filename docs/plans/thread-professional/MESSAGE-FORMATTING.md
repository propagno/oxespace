# Formatação das mensagens e detalhes de sessão — 2026-09-18

O problema mostrado pelo usuário era a falta de `remark-gfm` no renderer da Thread: tabelas válidas apareciam como parágrafos com barras e separadores. O projeto já possuía a dependência. `ThreadMarkdown` agora usa GFM tanto no histórico quanto nas atualizações da conversa, sem alterar o conteúdo persistido.

Tabelas têm cabeçalhos, divisórias e rolagem horizontal própria; código tem fonte monoespaçada, espaços preservados, rolagem própria e cópia. Há estilos para títulos, listas aninhadas, tarefas, citações, separadores, ênfase e referências. Links HTTP(S) abrem externamente sem navegar o renderer; HTML é tratado como texto. Todos os estilos usam os tokens existentes do OXESpace. Markdown incompleto durante streaming é reprocessado quando o conteúdo chega; não se tenta reconstruir tabelas inválidas por heurísticas.

O pedido anterior de detalhes da sessão também foi concluído: o terminal registra um UUID por sessão PTY e expõe diretório de início, executável, PID e horário pelo status. O diálogo identifica separadamente sessão PTY, painel e workspace. Esse UUID NÃO é o ID da conversa Claude/Codex. O diretório de início é a pasta passada ao spawn, não um suposto cwd atualizado após `cd`. O status da Thread inclui seus IDs locais e mantém o ID nativo já disponível.

Verificações: TypeScript e lint focado passaram; 25 testes de Markdown/UI/grid e 31 testes Electron de gerenciamento de terminal/thread passaram. Casos de regressão cobrem tabelas reais, código copiável com indentação, tarefas/listas, links externos, HTML, atualização de tabela durante streaming e ID/caminho real da sessão no diálogo. Build e limites passaram (main 902/904 kB; renderer 493/500 kB).

O Electron E2E passou em 900/1280/1440 px, incluindo verificação de tabela sem overflow global e zoom 125/150%. A captura `test-results/thread-900.png` foi inspecionada visualmente; cópia em [thread-formatting-900.png](thread-formatting-900.png). Foram corrigidos dois seletores antigos de histórico que confundiam a conversa com seu novo botão de exclusão. A imagem é um fixture de renderização no aplicativo, não inferência de produção.
