# Contrato comum de UI Desktop

Implementação autorizada pelo usuário após a auditoria de 2026-09-17. Este contrato substitui as decisões anteriores de geometria independente para Code/Thread e o footer horizontal Code. A auditoria original permanece como registro do estado anterior.

## Navegação

- Sidebar padrão 248 px; rail 56 px. Code e Thread compartilham largura, resize 240–360 em passos de 8 e estado de recolhimento. Settings usa a mesma preferência de largura e mantém navegação de categorias própria.
- Preferências antigas Code têm precedência; preferências Thread são fallback para instalações sem configuração Code. Valores válidos existentes são preservados e valores inválidos usam defaults seguros. Expansão dos grupos e seleção continuam específicas de cada modo.
- Marca com logo 18 px e faixa 48 px. Troca de modo fica no mesmo slot no rail. Criação ocupa a região contextual seguinte, com texto no expandido e ícone no recolhido.
- Footer comum vertical: Tools/Accounts, Settings, Collapse/Expand. Expandir/recolher preserva a ordem. Linhas 36 px, ícones 16, espaçamento 4 e padding 8×12; rail usa botões 36×36.
- Área de trabalho Code mantém panes/terminais; Thread mantém projetos/conversas. Não existe barra de modos extra acima dos terminais.

## Controles e superfícies

- NavigationBrand, NavigationFooter e SearchField são componentes compartilhados. Campos de filtro usam a mesma geometria, ícone fixo sem shrink, limpar e foco.
- `/` foca o filtro local, inclusive expandindo o rail. Não intercepta digitação em campos/terminais/editáveis ou eventos com modificadores e não compete com diálogos. Settings conserva Ctrl+F para filtrar categorias; Code conserva o acesso global a arquivos/comandos.
- Linhas de navegação 36, controles compactos 32, ações de footer 36. Densidade confortável usa linhas 40, controles 36 e a escala tipográfica maior do tema.
- Texto de navegação 13; metadados 11–12; títulos de chrome 14/600; títulos de página 21/600 com line-height 1.3; diálogos 18/600. Os tamanhos de navegação usam tokens de densidade.
- Controle radius 8 e superfície radius 12. Chrome plano e borda sutil; seleção com fundo neutro, foco accent de 2 px. Cor de atividade é independente de seleção.
- Diálogos usam uma superfície de tema, backdrop escuro sem blur, header/título/fechar e foco Radix. Tamanhos 460 (Thread/Accounts), 720 (New Workspace) e 860 (Tools) são variantes conforme o conteúdo. Altura máxima viewport menos 48; conteúdo longo rolável.
- Ações principais usam tx-primary sobre bg-app. AgentProviderIcon identifica provedores em Code, Thread e Accounts.
- Texto informativo tem meta de contraste 4,5:1. One Dark tx-muted foi ajustado; medir temas adicionais antes de declarar conformidade global.

## Limites e regressão

Janela nativa mínima 960×640. Tamanhos menores são cenários diagnósticos e de escala. Settings pode usar seletor de categorias abaixo de 900 sem mudar a largura comum; conteúdo ajusta a grade e possui rolagem própria. Não reduzir o limite nativo automaticamente.

Preservar drafts, histórico/posição de leitura, DOM dos terminais ao trocar de modo, ativação de panes sem relançar processos, guards de salvar e login nativo existente. Verificação visual não exige login, instalação ou atualização reais.

Evidência da implementação: [capturas e medidas](../audits/2026-09-17-visual-consistency/implemented/), com script [capture-implemented.mjs](../audits/2026-09-17-visual-consistency/capture-implemented.mjs). O escopo e os resultados finais são registrados em IMPLEMENTATION.md na pasta da auditoria.
