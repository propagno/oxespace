# Settings Desktop e navegação Code

Implementado em 2026-09-17. Direção visual consistente com o redesign Thread, inspirada na organização do Codex Desktop.

Atualização após auditoria: [contrato comum Desktop](desktop-ui-contract.md) substitui a largura independente Thread e o footer horizontal Code. Code/Thread compartilham width/collapse e footer vertical; Settings acompanha a largura comum. Evidência anterior abaixo preservada como histórico da primeira entrega.

- Settings: sidebar de 248 px com categorias de uma linha, ícones, busca Ctrl+F, seletor de escopo e retorno ao trabalho. Cabeçalho fixo de 48 px, conteúdo com largura de leitura de até 840 px e rolagem independente. Em janelas estreitas, categorias usam um seletor compacto.
- Estilo: títulos, descrições, controles, bordas e superfícies usam os temas existentes. Overrides ficam em SettingsCenter.css, sem substituir os tokens globais.
- Updates: aplicação e RTK aparecem como linhas de um grupo; recursos incluídos ficam em uma lista separada. Ações, erros e progresso preservados. RTK não pode ser instalado ou atualizado durante a consulta e o estado Checking não indica sucesso.
- Workspace: uma área de rolagem e rodapé de salvar fixo. Guard de alterações não salvas preservado, incluindo falhas de salvamento.
- Code: troca Code/Thread dentro do sidebar, inclusive na versão recolhida. Removida a barra de 42 px acima dos terminais. Settings permanece no rodapé nos dois estados do sidebar, ao lado de Tools quando expandido.
- A largura da grade Code acompanha a preferência real do sidebar (240–360 px), evitando que a área dos terminais cubra controles durante o redimensionamento. As preferências do sidebar Thread continuam independentes.

## Evidência

17 testes de componentes cobrem navegação, ações, drafts, falhas de salvamento e bloqueio do RTK durante consulta. Typecheck, lint sem erros e build com budgets passaram.

4 testes E2E no Electron passaram. Sidebar Code foi medido em 240, 280 e 360 px: seletor de modo e Settings inteiros, alinhamento com a área dos terminais e navegação após recolher/expandir. Páginas Application em 1440×900, 1280×720, 900×600 e 600×600; escopo Workspace em 1360×900 e 600×900; atualização simulada em download/pronta; busca, fechamento, scroll e ausência de overflow horizontal. Conversa Thread preserva rascunho, leitura e DOM dos terminais ao trocar de modo. Login e instalação reais não são acionados pelos testes visuais.

Capturas do app: [Settings / One Dark](settings-desktop-implemented.png), [Code / sidebar](code-sidebar-implemented.png).
