# Auditoria de coerência visual — Code, Thread e Settings

Data: 2026-09-17. Checkout atual, incluindo as implementações locais ainda não commitadas.

**Resultado: coerência parcial.** As telas compartilham fontes e cores de base, mas não compartilham uma estrutura de navegação suficientemente consistente. Foram registrados **34 achados: 5 HIGH, 26 MEDIUM e 3 LOW**. Nenhum bloqueio funcional CRITICAL foi demonstrado nesta auditoria.

O problema principal é estrutural: trocar de modo altera largura, posição de comandos e distribuição das ações. O conteúdo especializado de cada modo faz sentido; a geometria e os controles comuns precisam de uma regra única.

## Evidência e limites

- Comparação das duas imagens fornecidas pelo usuário com a implementação atual.
- 25 capturas no Electron, com medidas de DOM, estilos computados, geometria e amostras de foco por teclado. [Comparador visual](index.html), [medidas completas](measurements.json), [script reproduzível](capture.mjs).
- Tema One Dark e densidade compacta como referência. Amostra adicional de CSS com densidade confortável, sem alterar preferências reais do usuário.
- Viewports: 1280×720, 960×640, 900×600 e 600×600. A janela nativa impõe **960×640**; 900×600 é a referência menor documentada, e 600×600 é um teste diagnóstico abaixo dos limites atuais. O viewport foi forçado pela automação.
- Perfil Electron, banco e projetos temporários isolados. Conversas, estados de conta e status do RTK usam fixtures. Não foram executados login, instalação ou atualização reais.
- Escopo: navegação Code/Thread, rail recolhido, cabeçalhos, Settings Application/Workspace, Updates/Terminal, Tools, New Workspace, New Thread e Accounts. Não equivale a auditar todos os painéis, todas as categorias ou todos os temas do produto.
- Contraste `contrastFlat`: cálculo de luminância sobre cores computadas e composição de fundos planos. Não representa gradientes, sombras, transparência do backdrop ou opacidade de elementos desabilitados. Apenas pares planos adequados sustentam conclusões de contraste.

Não houve alteração funcional no frontend. Os arquivos desta pasta são os resultados e a instrumentação da auditoria.

## Contratos considerados

1. [Thread Desktop UI Contract](../../plans/thread-desktop-ui-contract.md): geometria, aparência, navegação, contas, rolagem e estados.
2. [Settings Desktop redesign](../../plans/settings-desktop-redesign.md): nova superfície integrada, largura 248, chrome 48, leitor 840, rodapé de salvar e navegação Code.
3. [Workspace Settings UI-SPEC](../../workspace-settings/UI-SPEC.md): contrato anterior do modal independente; adaptações da superfície integrada são documentadas no redesign e não são tratadas como regressões automaticamente.
4. [Tokens globais](../../../src/styles/tokens.css): fontes, tamanhos, densidade, raios, superfícies e dimensões.

**Não existe nesses documentos um contrato completo de coerência entre os três contextos.** O footer horizontal de Code, a largura própria de Thread e a independência das preferências estão documentados nas entregas anteriores. Portanto, parte relevante dos achados é uma **lacuna do padrão global ou uma decisão documentada a revisar**, diante da preferência agora expressa pelo usuário. Não se deve classificar toda diferença como improviso.

Os achados com desvio específico do contrato Thread estão identificados. Não foram identificados critérios A* numerados correspondentes a esta auditoria transversal; as prioridades abaixo expressam impacto na navegação e na legibilidade. Não há alteração em VERIFY.md nem declaração de fechamento de uma verificação funcional.

## Medidas principais

Valores no viewport 1280×720, salvo indicação. Largura do sidebar inclui a borda; alguns elementos internos têm 1 px a menos.

| Elemento | Code | Thread | Settings |
| --- | --- | --- | --- |
| Sidebar expandido | 280 px | 248 px | 248 px |
| Sidebar recolhido | 54 px | 56 px | Não há rail equivalente |
| Faixa de resize | 240–360 px | 224–320 px | Fixa por breakpoint |
| Resize por seta | 10 px | 8 px | Não aplicável |
| Cabeçalho do sidebar | 48 px | 48 px | 48 px |
| Rodapé expandido | Horizontal, 49 px | Vertical, 117 px | Retorno + nota de escopo, 70 px |
| Rodapé recolhido | 121 px | 111 px | Não aplicável |
| Botões do rodapé recolhido | 36×28 / 36×36 / 36×28 | Todos 36×30 | Não aplicável |
| Logo no rail | 28 px | 18 px | Ícone Settings |
| Busca local | 36 px de altura; radius 11; texto 12,5/500 | 34 px; radius 7; texto 12/400 | 34 px; radius 7; texto 12/400 |
| Ícone da busca, medido | 13×13 | 12,56×14 | 10,56×15 |
| Título da barra principal | 13 px / 620 | 14 px / 600 | Breadcrumb 11 px |
| Inset da barra principal | 16 px | 24 px, 16 abaixo de 1000 | 24 px |
| Coluna de leitura | Área de trabalho de terminais | Até 820 px | Até 840 px |
| Texto do footer Settings | 12 px / 400; cor `tx-secondary` | 12 px / 400; cor `tx-secondary` | Retorno 12 px / 400 |

Em 960×640, Code continua em 280 px e Thread/Settings em 248 px. A área central Code tem 680 px; Thread tem 712 px. A troca desloca a divisória em 32 px mesmo sem qualquer resize manual.

Na referência 1280×720, o botão Settings de Code começa em **x=125,5 / y=680**; em Thread, **x=12 / y=646**. A troca de modo exige procurar novamente um comando comum.

## Achados HIGH — previsibilidade da navegação

| ID | Evidência atual e classificação | Impacto e correção recomendada |
| --- | --- | --- |
| UI-F-01 | **Largura expandida diferente:** Code 280, Thread/Settings 248. Decisões locais documentadas; lacuna do contrato transversal. [Code](code-expanded.png), [Thread](thread-expanded.png), [Settings](settings-updates.png). Fontes S1, S2, S4. | A área de trabalho se desloca 32 px ao alternar modo e ao abrir Settings a partir de Code. Adotar uma largura padrão e uma política comum de resize. |
| UI-F-02 | **Preferências de largura e recolhimento independentes:** `oxe.navigation` para Code, `oxe.thread-navigation` para Thread; recolhimento Code no UI store. Decisão documentada. Fontes S1, S2, S12. | Mesmo alinhando os defaults, ajustes posteriores voltam a criar saltos. Compartilhar as preferências de geometria e recolhimento; manter expansão dos grupos e seleção específicas de cada modo. Migrar valores existentes sem apagar preferências do usuário. |
| UI-F-03 | **Footer horizontal em Code e vertical em Thread:** 49 contra 117 px; Settings muda de coordenadas e de largura. Distribuição documentada, agora incompatível com a preferência do usuário. Fontes S3, S4. | Mesmos comandos ficam em lugares diferentes e a lista ganha/perde 68 px sem uma regra aparente. Usar estrutura vertical comum, com Settings e Collapse em posições fixas. |
| UI-F-04 | **A ordem de Code muda ao recolher:** expandido Tools → Settings → Collapse; recolhido Settings → Tools → Expand. [Rail Code](code-collapsed.png). Fonte S3. | Quebra memória espacial dentro do próprio modo. Preservar ordem e agrupamento nos dois estados. |
| UI-F-05 | **Troca de modo em posições diferentes no rail:** Code coloca Thread imediatamente após a marca; Thread coloca New thread antes de Code. [Code](code-collapsed.png), [Thread](thread-collapsed.png). Fontes S2, S3. | O comando global de modo muda de posição e se mistura com criação. Reservar o mesmo slot para troca de modo nos dois rails, com criação em uma região contextual separada. |

## Achados MEDIUM — geometria, busca e criação

| ID | Evidência atual e classificação | Correção recomendada |
| --- | --- | --- |
| UI-F-06 | **Rail com larguras e alvos diferentes:** 54/56 px; footer Code mistura alturas 28/36/28, Thread usa 30. Medido, fontes S3, S4, S12. | Unificar largura e tamanho dos botões de ícone. Uma mesma ação deve conservar alinhamento e área clicável. |
| UI-F-07 | **Marca muda de escala ao recolher:** logo Code 28 px, Thread 18 px; expandido ambos usam 18. Fontes S2, S3. | Usar o mesmo tratamento da marca em cada estado do sidebar. |
| UI-F-08 | **Resize tem limites e passos diferentes:** Code 240–360 e 10 px; Thread 224–320 e 8 px. Fontes S1, S2. | Usar uma política de limites, passos e feedback compartilhada. |
| UI-F-09 | **Criação recebe pesos e posições diferentes:** New thread é ação textual de destaque no topo; New workspace é o pequeno + do cabeçalho da seção; Add project aparece ao final da lista Thread e abre o fluxo New Workspace. Fontes S2, S3, S8. | Definir uma região de ações de cada modo, com rótulos explícitos. Diferenciar criar conversa de adicionar projeto sem fazer o CTA principal depender de um + isolado. |
| UI-F-10 | **Campos de busca de famílias diferentes:** Code 36 px/radius 11/fundo preto translúcido/texto 12,5 semibold; Thread e Settings 34 px/radius 7/texto 12 normal, com fundos diferentes. Fontes S2, S4, S11. | Compartilhar SearchField com variante de contexto, mantendo geometria, ícone, tipografia, limpar e foco consistentes. |
| UI-F-11 | **Buscar e filtrar não têm rótulos claros:** Code possui Search global e Filter projects; Thread chama um filtro local de Search threads; Settings chama filtro de categorias/hints de Search settings. Fontes S2, S3, S4. | Tornar o alcance explícito. Se Settings continuar filtrando só categorias, refletir esse alcance na copy; oferecer busca de controles exige implementação própria. A distinção global/local pode permanecer. |
| UI-F-12 | **Atalhos apresentados de formas diferentes:** Code Search mostra Ctrl J e filtro mostra `/`; Settings Ctrl F; Thread não oferece atalho equivalente nem indicação. Fontes S2, S3, S4. | Padronizar a apresentação de atalhos e disponibilizar foco de busca local previsível. Não reutilizar atalhos globais de forma conflitante. |
| UI-F-13 | **Ícones de busca sofrem compressão horizontal:** Thread solicita 14 mas mede 12,56×14; Settings solicita 15 mas mede 10,56×15. Code mede 13×13. Fixtures atuais, fontes S2, S4. | Fixar tamanho e `flex-shrink: 0` no ícone e garantir que o input ocupe somente o espaço restante. |

## Achados MEDIUM — hierarquia e alinhamento

| ID | Evidência atual e classificação | Correção recomendada |
| --- | --- | --- |
| UI-F-14 | **Títulos de seção incompatíveis:** Code WORKSPACES 10 px/700/uppercase/tracking; Thread Projects 11 px/400; Settings caption 10 px/500. Fontes S2, S4, S11. | Estabelecer um único estilo para captions do mesmo nível. Os nomes podem ser diferentes porque representam entidades diferentes. |
| UI-F-15 | **Peso dos grupos muda radicalmente:** workspace selecionado Code 13 px/800; projeto Thread 12 px/400. Fontes S2, S11. | Definir níveis tipográficos para grupo, item e metadado. Grupos de modos distintos não precisam ter o mesmo conteúdo, mas devem ter hierarquia reconhecível. |
| UI-F-16 | **Seleção tem múltiplas linguagens:** Code combina barra lateral, borda, peso alto e seleção interna de pane; Thread usa fundo neutro 7%; Settings fundo neutro + peso 500. Fontes S2, S4, S11. | Separar seleção de item, foco e atividade em variantes semânticas comuns. Manter a seleção independente de estado running/failed. |
| UI-F-17 | **Cabeçalhos de trabalho mudam inset e estilo:** Code título 13/620, inset 16; Thread 14/600, inset 24; Settings breadcrumb inset 24. Thread 24 também supera o intervalo 12–20 do contrato Geometria. Fontes S4, S11. | Alinhar a grade horizontal do chrome. Settings pode ter breadcrumb por representar outro nível, mas a posição inicial e os controles devem seguir o mesmo grid. |
| UI-F-18 | **Espaçamentos e raios locais sem escala comum:** controles usam 5/6/7/8/10/11 px de radius; gaps 2/3/4/6/8/10; insets de navegação 8/12/14/16/20. Thread possui botões radius 7, abaixo do intervalo 8–12 do contrato Aparência. Fontes S2, S4, S10, S11. | Definir tokens por papel: campo, linha, painel, diálogo. Evitar corrigir cada tela com números independentes; alguns espaços ópticos podem ser exceções documentadas. |

## Achados MEDIUM — superfícies, ações e identidade

| ID | Evidência atual e classificação | Correção recomendada |
| --- | --- | --- |
| UI-F-19 | **Profundidade do sidebar diferente:** Code mantém sombra de raiz, Thread não tem sombra, Settings é superfície plana. Medido em Code expandido, fonte S11. | Adotar uma política de separação de chrome. A direção Thread recomenda borda discreta e superfície plana. |
| UI-F-20 | **Code recolhido recupera o estilo anterior:** gradiente do sidebar/footer e botão Tools com fundo colorido destacado mesmo sem estar aberto. [Captura](code-collapsed.png). Fonte S11. | Aplicar a mesma direção visual nos estados expandido e recolhido; destaque deve comunicar estado ou prioridade explícita. |
| UI-F-21 | **Diálogos de famílias diferentes:** Tools/New Workspace usam Radix, fundos quase pretos fixos, gradientes, radius 16 e backdrop com blur 8; Thread/Accounts usam dialog nativo, bg-app, radius 12 e backdrop sem blur. Larguras medidas 860/720/460. Fontes S2, S6, S7, S8, S11. | Unificar superfície, backdrop, título, fechar, header/body/footer e comportamento de foco. Larguras distintas são justificáveis pelo conteúdo; devem ser variantes de tamanho da mesma família. |
| UI-F-22 | **A ação primária muda de cor dentro de Settings:** ações Application são claras, salvar Workspace usa accent azul; Thread também usa claro, componentes Button/primary-action usam accent. Fontes S2, S4, S5, S9. | Escolher uma regra de primary/secondary/destructive que atravesse contextos. Variação de tema pode permanecer; variação por estilo de implementação não deve definir a hierarquia da ação. |
| UI-F-23 | **Alturas e fontes de botões variam até na mesma linha:** New Thread Cancel mede 34, Create 32; Accounts Connect 34; Settings app 32/11 px/500; Save workspace 36/11 px/600; controles globais usam outros tamanhos. Fontes S2, S4, S5, S9. | Usar variantes explícitas de tamanho e alinhar ações do mesmo footer. A borda não deve acrescentar 2 px ao botão secundário. |
| UI-F-24 | **Identidade de provedores fragmentada:** Code/componentes comuns usam AgentProviderIcon; Thread/Accounts usam letras C/O em quadrados neutros. Fontes S2, S6, S13. | Centralizar identificação de provedores com variantes de tamanho e cor. Usar o mesmo símbolo em navegação, conta, composer e seleção de agente. |
| UI-F-25 | **Foco no rail Code tem linguagem antiga:** Settings expandido Code/Thread usa outline accent de 2 px; Tools recolhido Code usa dois box-shadows e remove outline. [Foco Code](code-collapsed-focus.png). Fontes S2, S3, S11. | Usar FocusRing compartilhado. O foco observado existe; o achado é consistência do indicador, não ausência de foco. |

## Achados MEDIUM — leitura, densidade e adaptação

| ID | Evidência atual e classificação | Correção recomendada |
| --- | --- | --- |
| UI-F-26 | **Metadados abaixo da escala definida:** Thread recência/contexto usa 10 px, enquanto o contrato Aparência define 11–12; Settings Updates possui labels 10 e status 9; tokens chamam 11 px de último recurso. Fontes S2, S4, S10. | Reservar a menor escala para casos específicos. Subir metadados operacionais e badges para a escala comum e validar truncamento após o ajuste. |
| UI-F-27 | **Densidade confortável não atravessa os componentes:** root muda 14→15 e tiles Code possuem tokens específicos maiores, mas buscas, captions, footer e títulos amostrados preservam tamanhos em px. [Code](code-comfortable.png), [Thread](thread-comfortable.png). Fontes S2, S4, S10. | Definir o que a preferência deve ampliar: fonte, linha, área clicável e/ou espaços. Conectar as medidas aos tokens de densidade; o teste foi de CSS, não de persistência. |
| UI-F-28 | **Muted fica abaixo da meta de leitura no One Dark:** descrição Settings 12 px em #8b929e sobre #282c34 mede **4,47:1**. A mesma combinação é definida para descrições dos diálogos Thread; o contrato Thread exige 4,5:1. Fontes S2, S4, S10. | Ajustar token ou papel da cor para texto informativo, com margem acima do limite, e medir os outros temas. Settings footer em bg-sidebar mede 7,55:1 e não apresenta esse problema. |
| UI-F-29 | **Cores fixas convivem com tokens de tema:** branch Code usa branco com 45% alpha; Tools/New Workspace têm bases rgba(14,14,18) e gradientes próprios; Thread/Settings usam superfícies do tema. Fontes S8, S10, S11. | Substituir cores estruturais fixas por tokens semânticos. Não há evidência suficiente para declarar falha em todos os temas; o risco vem das regras estáticas verificadas. |
| UI-F-30 | **Responsividade não tem política comum:** Thread muda inset abaixo de 1000 e mantém 248; Code mantém 280; Settings muda para 200 abaixo de 899 e 168 abaixo de 699, trocando categorias por seletor. Capturas 960/900/600, fontes S2, S4. | Definir breakpoints, resize máximo relativo ao viewport e comportamento de recolhimento. Thread oferece recolhimento, portanto manter 248 abaixo de 1000 não basta para declarar violação da alternativa prevista no contrato. |
| UI-F-34 | **Um destino tem três nomes:** categoria Settings “Agents”, título “AI Providers”, links em Tools/Accounts “Agent Settings”. Fontes S4, S6, S7. | Dar ao destino um nome consistente na navegação e nos links; diferenciar contas/assinaturas de configuração de agentes por conteúdo e subtítulo. |

## Achados LOW — precisão de contratos e manutenção

| ID | Evidência atual e classificação | Correção recomendada |
| --- | --- | --- |
| UI-F-31 | **Baseline documentado diverge da janela:** contrato Thread diz 900 px; BrowserWindow atual impõe minWidth 960/minHeight 640. Fonte S14. | Atualizar a documentação e a matriz de verificação para o limite vigente. Não reduzir o limite nativo por consequência desta auditoria. |
| UI-F-32 | **Valores globais e overrides contam histórias diferentes:** token sidebar-w 282; default Code 280; Thread 248; há regras antigas e overrides repetidos para footer/header. Fontes S1, S3, S10, S11. | Criar uma fonte de verdade para geometria e consolidar regras do chrome. Cascata e estilos em camadas não são bugs por si só, mas a duplicação permite que o rail escape do redesign. |
| UI-F-33 | **Títulos de página de mesmo nível têm line-height diferente:** Application H2 21/27,3; Workspace H3 21/31,5. Fontes S4, S5. | Compartilhar PageHeading e revisar a hierarquia semântica segundo a estrutura real. Diferentes tags não são prova suficiente de falha de leitor de tela. |

## Diferenças legítimas que devem permanecer

- Code organiza workspaces, panes, terminais e contexto Git; Thread organiza projetos, conversas, fixadas e recência. Não precisam compartilhar o mesmo conteúdo nem a mesma quantidade de informação por item.
- Tools é uma ação contextual Code; Accounts tem função direta em Thread. A posição e o tratamento do slot contextual podem ser iguais sem exigir menus idênticos.
- Code pode ter status de terminal e barra inferior; Thread precisa de timeline e composer. São superfícies funcionais diferentes.
- Settings tem categorias, seletor Application/Workspace e retorno ao trabalho. Esse fluxo justifica uma organização própria do conteúdo e controles de salvar.
- Limites de leitura 820/840 e diálogos 460/720/860 podem ser variantes de tamanho, caso haja critério declarado. Não é necessário igualar todas as larguras do conteúdo.
- Cada workspace pode escolher tema/densidade. App seleciona o tema do workspace Code ou da conversa Thread; se forem contextos diferentes, a paleta pode mudar legitimamente. Esta auditoria usou o mesmo contexto e não reproduziu uma troca arbitrária de tema.

## O que já está coerente ou não foi reproduzido como problema

| Item | Evidência |
| --- | --- |
| Família tipográfica base | Mesma Inter Variable computada nas três superfícies. |
| Cor do sidebar | Code/Thread usam bg-sidebar; One Dark #21252b nos dois. |
| Texto Settings no footer | Mesma cor #b0b6c0, tamanho 12 e peso 400. As imagens não demonstram um erro de cor nesse texto. |
| Marca/modo expandidos | Ambos possuem chrome 48, logo 18, marca 12/600 e seletor com geometria equivalente. |
| Foco Settings expandido | Outline accent 2 px observado em Code e Thread, sem sombra. |
| Acesso Settings em Code | Existe expandido e recolhido no checkout atual. O problema antigo de ausência não foi reproduzido. |
| Rolagem estrutural | Listas Code/Thread têm overflow-y auto; timeline Thread e conteúdo Settings possuem regiões próprias de scroll. Não foi reproduzida ausência estrutural de scroll nesta amostra curta. |
| Barra extra de modos acima dos terminais | Não está presente no layout atual; seletor fica no sidebar. |

## Padrão comum recomendado

Proposta para a próxima implementação, **não requisito previamente aprovado**:

| Papel | Regra proposta |
| --- | --- |
| Sidebar expandido | **248 px padrão** nos três contextos, aproveitando o valor já usado em Thread/Settings. Code/Thread compartilham preferência e faixa 240–360; limitar máximo conforme o espaço disponível. |
| Rail | **56 px**, marca consistente e botões de ícone 36×36. |
| Chrome | **48 px** de altura, insets e slots comuns; troca de modo em posição fixa. |
| Footer Code/Thread | Vertical: ação contextual (Tools/Accounts) → Settings → Collapse. Todos com mesmas dimensões, alinhamento e estilo. Recolher conserva a ordem. |
| Settings | Mantém categorias e retorno, acompanha a largura comum; não precisa apresentar menus de trabalho. |
| Linhas/campos | Linha de navegação 36 px; campo e botão compacto 32 px; ação principal 36 px. Tamanho explícito, independente de borda. |
| Tipografia | Navegação 13 px; metadados 11–12; título de chrome 14/600; título de página 21/600 com line-height comum; título de diálogo 18/600. Aplicar política de densidade. |
| Ícones | 16 px no chrome, sem shrink; símbolos de provedor compartilhados. Exceções de status menores documentadas. |
| Espaços/raios | Espaços 4/8/12/16/24; controles radius 8, painéis/diálogos 12. |
| Superfícies | Tokens do tema, bordas sutis e chrome plano. Sem destaque permanente de Tools no rail. |
| Ações | Preferir primary claro na direção atual Thread/Settings Application e aplicar a mesma regra aos outros contextos; accent continua em foco/seleção. Destructive e status têm variantes semânticas. |
| Leitura | Texto informativo com contraste de pelo menos 4,5:1, validado por tema; não presumir que todo tx-muted é adequado em todo fundo. |

A correção estrutural deve ocorrer antes do acabamento de cada tela: contrato compartilhado → componentes comuns → adaptação dos conteúdos. Isso evita outra rodada em que cada modo parece correto isoladamente e a troca continua inconsistente.

## Ordem de implementação e aceite sugerido

1. **Geometria e navegação:** UI-F-01–08. Compartilhar width/collapse; alinhar chrome/rail; footer comum; migração das preferências. Aceite: mesma divisória ao alternar Code/Thread, mesma ordem ao recolher e Settings no mesmo slot.
2. **Primitivas visuais:** UI-F-10/13/18/21–25/29/33. SearchField, NavItem, IconButton, ActionButton, DialogShell, ProviderMark e PageHeading; tirar overrides que restauram o estilo anterior. Aceite: dimensões, ícones e foco iguais para controles do mesmo papel.
3. **Hierarquia e linguagem:** UI-F-09/11/12/14–17/26/34. Ações textuais, alcance de busca, títulos, estados selecionados e nomenclatura. Aceite: ação principal identificável e título/metadado com níveis consistentes.
4. **Densidade e limites:** UI-F-27/28/30–32. Contraste por tema, densidade, janela mínima, zoom e matriz de estados. Aceite: controles alcançáveis no limite nativo, leitura adequada e contratos alinhados ao app.

Regressão necessária: troca de modo preserva draft, seleção e DOM dos terminais; resize não cobre ações; recolher/expandir não troca a ordem; abrir/fechar Settings mantém o contexto; salvar workspace preserva guard de alterações; Escape e foco de retorno funcionam nos diálogos. Login real continua sendo verificação separada.

## Cobertura de estados

| Estado | Evidência nesta auditoria |
| --- | --- |
| Expandido/recolhido/selecionado | Capturado em Code e Thread. |
| Thread running/failed/idle | Linhas capturadas com fixtures; não uma execução real. |
| Conta desconectada | Capturado em Accounts e aviso do composer. |
| Updates sem atualização e build de desenvolvimento | Capturado; ações desabilitadas não acionadas. |
| Foco por teclado | Amostras no footer Code/Thread e Tools no rail Code. Escape usado nos diálogos amostrados. |
| Densidade confortável | Amostra de CSS em Code/Thread; não fluxo completo de preferência. |
| Limite nativo e tamanhos menores | Capturados; medidas abaixo do limite são diagnósticas. |
| Login pendente/expirado, quota, aprovação longa, ferramentas longas, catálogo parcial, 50 conversas, streaming e 100 turnos | Não recapturados nesta auditoria. Exigem a matriz específica Thread antes do aceite de uma implementação. |
| Demais temas, escala Windows 125/150%, leitor de tela e auditoria a11y automatizada completa | Não verificados. Não há declaração de conformidade global de acessibilidade. |

## Fontes da implementação

Referências de linha relativas ao checkout auditado:

- **S1:** [navigation-prefs.store.ts](../../../src/store/navigation-prefs.store.ts), linhas 7–15 — width/default/clamp/persistência Code.
- **S2:** [ThreadSidebar.tsx](../../../src/components/Threads/ThreadSidebar.tsx), linhas 34–63 e 66–84; [thread.store.ts](../../../src/store/thread.store.ts), linha 82; [ThreadView.css](../../../src/components/Threads/ThreadView.css), linhas 2–45, 64 e 103–111 — rail, ações, grupos, resize, glyphs, campos e diálogos.
- **S3:** [Sidebar.tsx](../../../src/components/Sidebar/Sidebar.tsx), linhas 167–264 e 378–407; [SidebarNavigation.css](../../../src/components/Sidebar/SidebarNavigation.css), linhas 26–43 — marca, modos, busca, ordem e footer Code.
- **S4:** [SettingsCenter.css](../../../src/components/Settings/SettingsCenter.css), linhas 3–43, 84–114 e 131–142; [SettingsCenter.tsx](../../../src/components/Settings/SettingsCenter.tsx), linhas 16, 57–86 — navegação, campos, categorias, dimensões e breakpoint.
- **S5:** [SettingsModal.tsx](../../../src/components/Settings/SettingsModal.tsx), linha 539; [SettingsCenter.css](../../../src/components/Settings/SettingsCenter.css), linhas 106–115 — título Application e form Workspace integrado.
- **S6:** [ProviderAccountsPanel.tsx](../../../src/components/Threads/ProviderAccountsPanel.tsx), linhas 32–58 — identificação dos provedores e links de configuração.
- **S7:** [ToolsModal.tsx](../../../src/components/Workspace/ToolsModal.tsx), linhas 277–305 e 344–370 — diálogo e Agent Settings.
- **S8:** [NewWorkspaceModal.tsx](../../../src/components/Workspace/NewWorkspaceModal.tsx), linhas 154–173; [features.css](../../../src/styles/features.css), linha 6119 — New Workspace.
- **S9:** [button.tsx](../../../src/components/ui/button.tsx), linhas 8–35; [dialog.tsx](../../../src/components/ui/dialog.tsx), linha 12; [components.css](../../../src/styles/components.css), linhas 366–397 — primitivas e ações globais.
- **S10:** [tokens.css](../../../src/styles/tokens.css), linhas 86–97, 144–178, 310–326 e 354–360 — geometria, raios, tipografia, tema e densidade.
- **S11:** [layout.css](../../../src/styles/layout.css), linhas 453–590, 1388–1550, 2040 e 2249–2273; [orca-shell.css](../../../src/styles/orca-shell.css), linha 63 — hierarquia Code e superfícies anteriores.
- **S12:** [App.tsx](../../../src/App.tsx), linhas 844 e 876–877; [ui.store.ts](../../../src/store/ui.store.ts); [base.css](../../../src/styles/base.css), linhas 23–29 — tema/contexto e shell.
- **S13:** [AgentProviderIcon.tsx](../../../src/components/Sidebar/AgentProviderIcon.tsx) — identidade comum de agentes.
- **S14:** [electron/main/index.ts](../../../electron/main/index.ts), linhas 555–559 — mínimo real da janela.

As medidas completas em measurements.json são a referência para valores computados; não inferir contraste de controles desabilitados ou superfícies com gradiente a partir de contrastFlat.
