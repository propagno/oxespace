# UI-SPEC — Thread Desktop profissional

Contrato para [PLAN.md](PLAN.md), 2026-09-17. Referência: organização de conversa do Codex Desktop; preservar identidade/tokens OXESpace. Sem novos pacotes ou scripts externos. Reusar Radix já instalado, DesktopDialog, NavigationChrome, SearchField, botões/tooltips e Markdown existentes.

## 1. Tokens e composição

- Superfícies: `--bg-app` na conversa, `--bg-sidebar` na navegação, `--bg-elevated` em compositor/popovers, `--bg-hover` em interação. Texto `--tx-primary`, `--tx-secondary`, `--tx-muted`; borda `--bd-base`; foco `--accent`. Corrigir uso isolado de `--ac-primary` inexistente no menu atual.
- Manter preferências de tema; evitar preto/cinza hardcoded e azul para rótulos que não são links. Status distinguido também por ícone/texto.
- Cabeçalho 48 px fixos; título 14 px/600, contexto 12 px. Menu ⋯ para ações da conversa, sem Tools/Advanced CLI.
- Coluna de conteúdo e compositor com mesma largura útil máxima 800 px. Padding lateral 24 px a partir de 1100 px de viewport; 16 px abaixo. Conteúdo começa a 20 px do cabeçalho; entre turnos 24 px; entre parágrafos 10 px; atividades/mensagem 12 px.
- Grid `48px minmax(0,1fr) auto`; scroll apenas no histórico, sidebar e listas independentes. Composer em linha própria, margem inferior 12 px e gap 12 px do histórico. Não sobrepor mensagens com position fixed.
- Corpo 14 px/1.6 (`--fs-base`, candidato local de line-height), headings Markdown 15/16 px e peso600. Código mono12/13 com copiar; tabelas e blocos longos têm overflow interno.
- Sidebar usa largura/collapse compartilhados já existentes; não redefinir valores exclusivos para Thread.

## 2. ThreadComposer

Padding12, radius14 px, borda1 px discreta, sem glow. Input min44/max160 px, crescimento até seis linhas e scroll interno depois. Com uma linha: altura total alvo100–112 px. Rodapé em uma linha com controles de28–32 px:

`[/] [Modelo ▾] [Esforço ▾] [Permissões ▾] … [Enviar ↑ / Parar □]`

Modelo max200 px com ellipsis e tooltip do nome completo; esforço sem truncar. Em largura útil <600 px, permissões migram para segunda linha ou menu de configurações, mantendo modelo+esforço visíveis. Não esconder opções obrigatórias atrás de `/model`. Em execução textarea permanece editável para preparar draft; enviar substituído por parar, sem envio automático ao concluir.

Estados: vazio permite configurar; loading do catálogo afeta só seletores; enviando bloqueia submit duplicado; executando mostra parar; falha preserva draft e apresenta recuperação; sucesso limpa somente o texto que foi enviado. Nenhuma mudança de modelo gera mensagem da IA.

## 3. Modelo e esforço

Popover ancorado ao rodapé, abre para cima com detecção de colisão, largura320–360 px, altura máxima min(360 px, espaço disponível). Cada linha: nome, descrição curta de até duas linhas, indicador selecionado. Busca quando >8 modelos. Catálogo paginado no backend; nenhuma lista hardcoded de IDs.

| Estado | Modelo | Esforço |
|---|---|---|
| Normal | Nome efetivo sempre visível | Valor efetivo, opções específicas do modelo |
| Carregando | “Carregando modelos…”; input continua utilizável | “Carregando…” |
| Vazio | “Nenhum modelo disponível”; “Atualizar modelos” / “Conectar conta” conforme causa | “Não disponível” com motivo |
| Erro | “Não foi possível carregar modelos”; “Tentar novamente” | Manter último efetivo; nenhuma escolha presumida |
| Salvando | Item pendente com spinner; nome anterior continua referência efetiva | Mesmo contrato; bloquear duplicata |
| Sucesso | Novo nome após confirmação; fecha popover e devolve foco | Novo nível após confirmação |
| Turno ativo | Seleção marcada “Próximo turno”; exibir atual no detalhe | Idem |
| Modelo sem esforço configurável | Controle modelo normal | “Automático”, desabilitado com explicação; não fingir High |

Ao trocar modelo, conservar esforço somente se válido. Caso contrário propor default retornado pelo provider e apresentar combinação antes de aplicar. Se não houver default confiável, solicitar seleção válida no popover. Mudanças rápidas usam revisão para ignorar confirmações obsoletas. Falha reverte pending e mantém popover com retry.

ARIA: botões “Selecionar modelo” e “Selecionar esforço”, expanded/controls, listbox/options ou componentes Radix adequados. Setas navegam; Enter seleciona; Escape fecha e devolve foco sem limpar texto. Anúncio discreto da configuração aplicada, não a cada hover.

## 4. Atividade e mensagens

ThreadActivityGroup ocupa32–40 px fechado, sem cartão por ação. Rótulos determinísticos a partir dos eventos: “Explorou o projeto · 12 ações”, “Executou 3 comandos”, “Alterou 2 arquivos”. Sem dados de categoria confiáveis: “Concluiu 12 ações”. Duração só com timestamps reais.

Durante execução mostrar resumo e último alvo conhecido numa linha, spinner discreto. Ao concluir, recolher automaticamente apenas se usuário não expandiu manualmente. Grupo expandido lista linhas28–32 px com ícone, alvo, duração e estado. Detalhe abre dentro da linha, output máximo240 px de altura com scroll; conteúdo completo sob ação explícita.

Falha: indicador persistente e linha do erro acessível; erro não desaparece dentro de um grupo aparentemente bem sucedido. Aprovações não são escondidas no agrupamento: cartão com ação concreta, arquivo/comando e escopo, “Aprovar”/“Recusar”. Durante resposta bloquear duplicata; encerrada mostrar resultado. Cancelamento não vira sucesso.

Mensagens do agente sem bolha/borda, nome/avatar apenas onde identifica novo bloco do agente. Commentary e final mantêm ordem; não resumir conteúdo por IA para “limpar” o histórico. Ações “Copiar resposta” e “Tentar novamente” aparecem discretamente, acessíveis por foco. Retry informa que reenvia a solicitação e não duplica execução ativa.

Loading: linha única “Trabalhando…”, sem skeleton de parágrafos. Empty: título “O que vamos fazer neste projeto?” e contextualização curta. Error: mensagem acionável no turno; sucesso: resposta e atividade recolhida, sem avalanche de checks. Estado interrompido visível e nova mensagem possível.

## 5. Comandos, permissões e painéis

Menu `/` fica ancorado ao composer, máximo360 px e scroll; busca local; rótulo+descrição curta, sem badge “Advanced tools”. Enter/Tab insere seleção; segundo Enter envia quando apropriado; argumentos preservados; Escape fecha. Slash desconhecido apresenta “Comando não reconhecido” + “Ver comandos”, sem consumir turno.

Comando com argumentos ausentes abre formulário contextual dentro da Thread. Operações extensas (sessões, diff, integrações) usam painel lateral de360–440 px em viewport>=1200; abaixo disso DesktopDialog até min(640 px, viewport−32 px), fechável, mantendo componente de conversa montado. Fechar painel recupera foco/draft. Não bloquear conversa só porque um painel de consulta está aberto.

Permissões: menu rotulado pela política efetiva. Ampliação de acesso exige escolha explícita e confirmação do escopo, sem modificar preferências globais silenciosamente. Carregando mantém último valor; indisponível mostra motivo; falha não altera rótulo; aprovação pendente vai para cartão do turno. Opção gerenciada/sem suporte aparece desabilitada com motivo.

Sessões/diff/integrações: loading em skeleton de lista; vazio com ação específica (“Criar conversa”, “Adicionar integração”) apenas se implementada; erro com “Tentar novamente”; sucesso atualiza lista; mutação pendente bloqueia somente item afetado. Exclusão confirma objeto/alcance, cancelamento não muda dados. Não apresentar funcionalidades apenas decorativas.

## 6. Scroll, foco e acessibilidade

- Preservar âncora ao expandir atividades, paginar, atualizar itens ou mudar configuração. Seguir streaming somente quando já próximo ao fim (limiar atual64 px).
- “Últimas mensagens” ocupa espaço de status reservado acima do compositor; não cobre aprovação, rodapé ou última linha legível.
- Zero captura global do teclado de outro modo/painel. IME e AltGr preservados; voz/erro fecha conforme recuperação já implementada.
- Tab percorre controles em ordem visual; todos ícones têm label; ring2 px `--accent`, offset2. Sem hover obrigatório para ação.
- Texto normal contraste>=4.5:1, controles/foco>=3:1, medir em temas claro e escuro. Alvos mínimos28 px para desktop e44 px em modo touch. Reduced motion remove shimmer/animação não essencial.
- aria-live polite apenas para transições de turno/configuração/erro, não para cada token ou evento de ferramenta. Não mover foco com novo output.

## 7. Revisão objetiva

Fixtures: conversa curta/vazia, screenshot equivalente com12 tools, execução longa, falha na ferramenta, aprovação, modelo indisponível, conta expirada, catálogos extensos, mensagens e paths longos, 100 turnos e muitos eventos. Capturas900×600/1280×800/1600×1000, zoom125/150%, temas light/dark, sidebar240/248/360 e colapsado.

Comparar hierarquia, densidade, alinhamento e estados por este contrato. Reprovar: commandExecution como título principal, cartão por tool, modelo só via comando, label de configuração divergente do runtime, terminal auxiliar, composer cortado, foco roubado, scroll que impede leitura. Registrar UI-REVIEW com prova por critério antes de declarar finalizado.
