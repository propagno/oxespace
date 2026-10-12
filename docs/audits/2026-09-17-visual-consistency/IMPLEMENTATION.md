# Implementação do padrão visual comum

Implementado em 2026-09-17, após autorização do usuário sobre o levantamento de 34 achados. Mudanças locais ainda não publicadas. [Contrato vigente](../../plans/desktop-ui-contract.md), [comparador antes/depois](index.html), [medidas finais](implemented/measurements.json).

## Resultado medido

Perfil novo, tema One Dark e viewport 1280×720:

| Elemento | Antes Code / Thread | Depois Code / Thread |
| --- | --- | --- |
| Sidebar | 280 / 248 | 248 / 248 |
| Rail | 54 / 56 | 56 / 56 |
| Footer | Horizontal 49 / vertical 117 | Vertical 133 / vertical 133 |
| Botões expandidos | Larguras/distribuição distintas | 223×36, mesmas posições |
| Botões recolhidos | 28/36/28 de altura / 30 | Todos 36×36, mesmas posições |
| Logo | 28 / 18 no rail | 18 / 18 |
| Campo de filtro | 36 / 34 | 32 / 32 |
| Ícone de filtro | 13×13 / comprimido | 16×16 nos dois, também em Settings |
| Densidade confortável | Vários tamanhos fixos | Navegação 14 px, linhas 40 e campos 36 |

Settings acompanha a largura compartilhada, inclusive após resize. O contraste da descrição One Dark passou de **4,47 para 5,13:1**. As caixas dos três botões de rodapé Code/Thread são iguais na amostra expandida, recolhida e confortável.

## Cobertura dos achados

| Achados | Implementação |
| --- | --- |
| 01–02 | Uma largura persistida e um recolhimento global para Code/Thread. Settings acompanha a largura. Migração conserva valores válidos existentes; preferência Code tem precedência e Thread é fallback. Valores migrados são gravados antes de remover os campos antigos da persistência Thread. |
| 03–05 | NavigationFooter vertical compartilhado, ordem contextual → Settings → Collapse preservada no rail; troca de modo no mesmo slot. |
| 06–08 | Rail 56, botões de ícone 36, logo 18, resize 240–360 em passos de 8. Handle dentro dos bounds evita deslocamento horizontal ao receber foco. |
| 09 | New workspace textual no topo Code; criação também acessível no rail. Thread conserva New thread e Add project com funções distintas. |
| 10–13 | SearchField comum, ícone sem shrink, limpar, foco e dimensões iguais. Filtros locais nomeados; Settings informa Filter categories. Atalho local `/` compartilhado e Ctrl+F Settings preservado. |
| 14–18 | Captions, hierarquia de grupos, metadados, seleção neutra, títulos e insets usam o padrão comum e tokens de densidade. Conteúdo adicional dos terminais permanece contextual. |
| 19–20 | Sidebar/rail/footer planos, sem sombra ou gradiente; Tools usa o mesmo peso visual dos demais comandos no rail. |
| 21 | Thread/Accounts passam a usar DesktopDialog com foco Radix; Tools/New Workspace usam a mesma superfície e backdrop. Larguras 460/720/860 mantidas como variantes de conteúdo. |
| 22–23 | Ação primária clara em Thread, Application, Save workspace, New Workspace e Button global. Retirado o override verde com !important do wizard. Footer New Thread tem duas ações de 36, sem diferença causada pela borda. |
| 24–25 | AgentProviderIcon compartilhado em timeline/composer/contas; foco accent consistente no rodapé e rail. |
| 26–29 | Metadados principais passam à escala 11–12, navegação acompanha densidade, muted One Dark ajustado e superfícies/branch usam tokens de tema. Não é declaração de contraste validado em todos os temas/painéis. |
| 30–32 | Geometria comum nos viewports amostrados; Settings conserva seletor compacto abaixo de 900. Contrato corrige mínimo nativo para 960×640. Regras antigas de chrome de Code/Thread removidas dos arquivos específicos. Tailwind varre apenas src para não gerar classes a partir dos seletores da auditoria. |
| 33–34 | Títulos Application/Workspace usam line-height 1.3; destino de configuração nomeado Agents em navegação, título e links. |

## Validação

- **29 testes Vitest passaram**, incluindo migração, navegação Sidebar, Thread drafts/auth-preflight, Settings guards e falhas de salvar.
- **3 testes E2E Electron passaram**: sessões/sidebar/Settings, Updates e janela curta, Thread com histórico longo e terminais preservados.
- E2E verifica resize **240/360/248**, alternância Code/Thread com largura preservada e Settings com a mesma largura. Verifica também persistência após reload, proteção de drafts, navegação pelo rail e geometria idêntica de footer.
- Histórico longo apresentou timeline rolável de 18.778 px num viewport de 600 px de altura, com composer acessível. Draft e DOM dos terminais preservados ao alternar.
- Typecheck passou; lint sem erros, com 32 avisos já existentes no checkout. Build e budgets passaram; permanece o aviso de import estático/dinâmico do RTK.
- **25 capturas finais** em [implemented](implemented/), nos mesmos cenários da auditoria inicial, inspecionadas com estilos e medidas computadas. Script [capture-implemented.mjs](capture-implemented.mjs) usa perfil/banco isolados e fixtures.

Limites: login/instalação/atualização reais não foram executados; não foi repetida uma matriz de todos os temas, escala Windows ou leitor de tela. A mudança conserva a lógica de login nativo existente. A coerência das telas amostradas e os fluxos de navegação foram verificados; painéis fora do escopo continuam exigindo sua própria revisão.
