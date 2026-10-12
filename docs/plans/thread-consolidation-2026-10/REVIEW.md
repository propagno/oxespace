# Revisão do Thread com Playwright

Data do relatório: 2026-10-04. Execução: noite de 2026-10-03, America/Sao_Paulo.
Baseline: commit `53490e5`, versão `0.16.0-beta.4`, com correções locais de resume descritas em `docs/validation/resume-latency-2026-10-03.md`. Revisão do bundle de desenvolvimento Electron, não do instalador publicado.

## Método e limites

- Electron real controlado pelo Playwright, SQLite e userData temporários. Nenhuma conversa do usuário foi alterada.
- `thread-project-navigation`, `thread-session-actions` e `thread-view`: **3 testes aprovados, 46,5 s**. Cobrem navegação/restart, independência Code/Thread, archive/restore/delete, split, rascunho, comandos, modelos, erros, perguntas, aprovações, review e histórico extenso.
- Reexecução instrumentada: 38 checkpoints e cenário existente aprovado em 30,4 s. Extensão seguinte: **39 checkpoints; falhou na restauração de foco após Escape em Project settings**. Os 15 Tabs permaneceram dentro do modal; o fechamento funcionou; o retorno ao iniciador falhou.
- 39 checkpoints com geometria/contraste candidatos, 12 estados inspecionados visualmente: nova thread, contas, fonte a 150%, conversa estreita com review, falha de quota, workbench largo, Session changes, aprovação, pergunta respondida, menu de conversa, slash e Project settings.
- Viewports exercitados pelo roteiro: 900/1280/1440, alturas 600/720/900, zoom 125/150%, temas `midnight` e `one-dark`. Sem overflow horizontal da página nos 39 checkpoints. Isso não comprova legibilidade de todo conteúdo truncado nem acessibilidade completa.
- Histórico sintético: 10.002 rows, teto de 80 elementos testado; até 16 rows presentes nos checkpoints medidos. Em 900×600, composer de 96 px, totalmente dentro da janela (bottom 592 px).
- Inferência, autenticação e respostas de requests no roteiro visual são simuladas. O teste de projetos usa persistência/IPC real, mas não comprova inferência nativa. Não é certificação de Codex/Claude, Linux, instalador ou uso prolongado.
- Auditoria por contratos `thread-professional/UI-SPEC.md` e `thread-workbench/UI-SPEC.md`, considerando alterações posteriores documentadas em `thread-professional-v2/EVIDENCE.md` e pedidos do usuário. Valores antigos de largura (800/860 px) não prevalecem sobre o pedido posterior de canvas amplo; a largura atual não é classificada como defeito por essa diferença.
- O relatório de implementação é o equivalente disponível ao runtime de execução; não foi encontrado EXECUTION-RUNTIME específico deste ciclo. Nenhuma divergência sem contexto foi automaticamente classificada como não autorizada.

## Achados confirmados e propostas

| ID | Prioridade / tipo | Evidência atual | Ação / aceite | Contrato |
|---|---|---|---|---|
| V01 | P1 / HIGH, teclado | Settings for repo → 15 Tabs → Escape fecha o modal, mas o botão iniciador não recebe foco. Assertion Playwright falhou. `DesktopDialog` é controlado e não recebe referência explícita de retorno. A causa exata deve ser confirmada na correção. | Restaurar o iniciador ou fallback seguro se removido; testar abertura por clique/Enter, fechar por Escape/X/Done e nested dialog. | Professional §6; Workbench §7; A-V1 |
| V02 | P1 / MEDIUM, contraste | `Failed` selecionado no sidebar: 11 px, `rgb(248,113,113)` sobre `rgb(53,56,70)`, **4,20:1**. | Token de texto de estado com ≥4,5:1 nas superfícies normal/hover/selecionada, preservando semântica por ícone e texto. | Professional §6; A-V2 |
| V03 | P1 / MEDIUM, alvo de interação | Botões de projeto/cópia/edição/compositor medidos em 26×26; cabeçalho em 27×27; seletor Code/Thread com altura 24. CSS de `.thread-row-action` confirma 26. | Área acionável ≥28×28 desktop sem aumentar o ícone; 44 no modo touch. Testar não sobrepor alvos ao compactar sidebar. | Professional §6; A-V2 |
| V04 | P2 / MEDIUM, consistência | Nova thread ainda tem `<select>` nativo para projeto, com caminho extenso truncado; cards dos agentes já são melhores que o dropdown antigo. | Projeto fixo ao abrir pelo + daquele projeto; ação contextual para trocar, seletor compartilhado pesquisável onde necessário; nome e caminho distinguíveis. | Pedido explícito sem dropdown nativo; A-V3 |
| V05 | P2 / proposta de densidade | Cada thread mede 51 px e repete provider, estado e idade; quatro ações disputam a linha de projeto. O sidebar continua consumindo muita altura com 70 conversas. | Densidade compacta 36–40 px com nome e indicador; detalhes por seleção/foco e preferência confortável. Manter pesquisa, teclado, estado e distinção de projetos homônimos. | Pedido de sidebar compacto; A-V4 |
| V06 | P1 / proposta de diagnóstico | Quota repete mensagem, detalhe técnico, código e footer Failed; autenticação expõe recuperação no cartão e rodapé. Não é prova de conexão falsa: fixture de contas é independente do erro. | Um resumo acionável por falha, detalhe técnico recolhido; estado da conta separado do transporte e turno. Não ocultar erro histórico ao atualizar conexão. | Workbench §5–6; A-D1 |
| V07 | P1 / MEDIUM, informação | Aviso de histórico parcial aparece truncado em 900×600; não oferece carregar a parte nativa ausente. | Histórico com ação de carregar anteriores, progresso e erro localizados; texto essencial curto e detalhes acessíveis sem overflow. | Workbench §6; A-H1 |
| V08 | P2 / proposta de hierarquia | Arquivos aparecem nas atividades, no resumo do turno e no painel Session changes. Metadados como `Provider patch · completed`, Verified e recorded step competem com o diff. | Resumo único compacto no turno; detalhe por seleção; origem/verificação em detalhe secundário. Nunca juntar Project changes e Session changes como se fossem a mesma evidência. | Workbench §3–4; A-V5 |
| V09 | P2 / MEDIUM, modal estreito | Project settings em 900×600 tem scroll do modal inteiro; footer/Done fica fora da porção inicial. X está visível e Escape funciona. Checkboxes estão alinhados, não reproduzir a antiga alegação de caixas gigantes. | Header e footer persistentes, scroll no corpo, disclosure para configuração avançada; feedback de salvamento junto à seção alterada. | Workbench §6–7; A-V3 |

V05/V06/V08 são propostas sustentadas pela inspeção, não falhas de teste. Nenhum defeito visual CRITICAL foi demonstrado neste recorte; V01 impede considerar a navegação de teclado consolidada.

## Conformidades a preservar

- Timeline e composer cabem em janela de 600 px; tabelas/comandos longos têm contenção; drawer aparece em largura estreita.
- Perguntas permitem responder/recusar com estado final distinto. Não concluir daí que o provider recebeu a resposta real.
- Alterações de fonte e zoom não romperam o roteiro; menus de conversa fecham com Escape e retornam foco no cenário existente.
- Review preserva draft/foco ao fechar; comentário vai ao rascunho, não é enviado automaticamente.
- Copiar/editar estão disponíveis na mensagem; ações destrutivas identificadas; fonte e tema salvos devem continuar respeitados.
- Alternância Code/Thread conserva terminais; projetos e conversas sobreviveram ao restart no teste dedicado.

## Candidatos descartados / limites do coletor

O coletor simples não calcula a árvore completa de nomes acessíveis nem todas as camadas de alpha. Inputs de radio com 1 px têm labels acionáveis e passaram por seleção por nome; não são registrados como botões sem nome. Separadores de resize com 4 px e inputs internos a um campo maior não são automaticamente falhas de target size. Inconsistências artificiais entre provider do sidebar e eventos da fixture não são atribuídas ao produto. Zero candidatos de contraste numa tela não equivale a aprovação WCAG.

## Cobertura ainda necessária

| Área | Executado | Pendente para fechamento |
|---|---|---|
| Conversa/composer | Curta, extensa, Markdown, zoom, draft e ações | Texto 12–22 px, conteúdo misto com imagens/tabelas carregando, todos temas aprovados |
| Sidebar | Hierarquia, busca/lista extensa, archive/restore/delete, split | Navegação completa só por teclado, nomes/caminhos homônimos, todos estados simultâneos |
| Modais | Nova thread, contas, Markdown e Project settings | Matriz loading/empty/error/success e retorno de foco de cada modal |
| Review | Session changes, Project changes, Files/editor, Git, Agents, drawer | Conflitos reais, patch ausente/truncado, autorização negada e resize por teclado |
| Connections/delegação | Empty de delegated work; configuração do projeto | Fluxo completo Connections: conectar, verificar, OAuth, erro, cancelar; delegar/revogar/retomar em duas worktrees |
| Histórico/execução | UI de histórico parcial, fixture de 10.002 rows, requests simulados | Paginação nativa completa, reconciliação, sessão longa real e campanha de ambos provedores |
| Plataforma/desempenho | Windows Electron de desenvolvimento | Instalador Windows, Linux empacotado, 2 h de uso e múltiplas threads |

## Reprodução

Build atual e módulos nativos compatíveis com Electron são pré-requisitos. `npm run fix:native` foi usado para a ABI Electron; testes Node com SQLite podem exigir restaurar a ABI Node depois.

```powershell
npx playwright test e2e/thread-view.spec.ts e2e/thread-session-actions.spec.ts e2e/thread-project-navigation.spec.ts
$env:OXESPACE_VISUAL_AUDIT_OUTPUT = 'test-results/thread-visual-audit-final.jsonl'
npx playwright test e2e/thread-view.spec.ts
```

A segunda execução inclui o teste que demonstra V01 e deve falhar até a correção. Use um caminho de saída novo por campanha: o coletor faz append. Métricas selecionadas desta execução estão em `measurements.json`. Capturas locais em `test-results/` são auxiliares; a entrega é este mapa de achados e o plano, não uma coleção de prints.
