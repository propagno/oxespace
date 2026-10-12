# Contrato visual Thread Desktop

Status: contrato aplicado à implementação Thread Desktop; chrome e preferências atualizados pelo [contrato comum Desktop](desktop-ui-contract.md). Evidências e limites em thread-desktop-redesign.md.

## Geometria

| Elemento | Especificação |
| --- | --- |
| Shell | height:100%; min-height:0; overflow:hidden; colunas sidebar / minmax(0,1fr); linha minmax(0,1fr) |
| Sidebar | 248 px padrão, ajustável 240–360; largura/recolhimento compartilhados com Code; rail 56 px. Sem gradiente, sombra ou brilho nos botões |
| Marca/modo | Área compacta 48 px; troca Code/Thread acessível, sem adicionar barra ao histórico |
| Cabeçalho conversa | 48 px; padding 12–20 px horizontal; título + projeto/worktree em uma linha, truncar contexto primeiro |
| Área de conteúdo | min-height:0; grid auto / minmax(0,1fr) / auto; sem altura de acordo com conteúdo longo |
| Timeline | overflow-y:auto; min-height:0; overscroll-behavior:contain; scrollbar estável; padding 16 px vertical/24 horizontal |
| Coluna de leitura | max-width 820 px, centralizada; 100% do espaço disponível nos viewports menores |
| Composer | mesma coluna da timeline, inset horizontal 24 px e inferior 12 px; textarea mínimo 40/máximo 144 px; altura inicial total 88–104 px |
| Conta desconectada | Linha compacta de conexão 36–44 px; explicação longa abre painel. Em altura curta, integrar à toolbar do composer |
| Menu/aprovação/contas | max-height calc(100dvh - 48px); conteúdo scroll; ações no fluxo sempre acessíveis |

O baseline nativo atual do app é 960×640. Não reduzir globalmente esse limite neste trabalho. Abaixo de 1000 px, sidebar recolhível e contexto secundário reduzido. Em altura <=600 px, composer de uma linha inicial, cabeçalho e aviso sem duplicação. Manter todos os elementos interativos acessíveis a 125/150% de escala Windows.

## Aparência

Usar bg-app/bg-sidebar/bg-elevated/tx-primary/tx-secondary/tx-muted/bd-base existentes, com derivados discretos só em tokens Thread. Preservar tema escolhido; contraste de texto normal >=4.5:1 e foco visível. Accent só em foco/seleção/ação principal; status usa ícone + texto, não só cor. Border radius 8–12 px, bordas sutis de 1 px. Nenhum card com glow.

Texto das mensagens 14 px/line-height 1.5; título 14 px/600; sidebar 13 px; metadados 11–12 px. Escala 4/8/12/16/24. Usuário tem bubble suave com padding 10–12 px, alinhada à coluna; agente tem texto aberto. Intervalo de mensagens 12–16 px; intervalo entre turnos 20 px. Tool summary 28–32 px; detalhes monospace com linhas longas roláveis horizontalmente, sem expandir a largura do shell.

A conclusão normal aparece discretamente uma vez por turno. Repetições de erro técnico não ocupam blocos grandes. Erro operacional recente tem resumo amigável e ação; detalhe técnico sanitizado fica em expansão. Não esconder o histórico original nem usar falhas como resposta do assistente.

## Navegação

Nova conversa é uma ação textual com ícone, não apenas +. Buscar funciona dentro de Thread e não aciona panes. Fixadas aparecem uma vez na seção própria; conversas restantes sob projetos. Sidebar rows 32–40 px, título truncado com tooltip acessível e atividade discreta. Projeto usa chevron + nome; worktree/contexto no cabeçalho e seletor. Homônimos reais têm path curto como descrição. Sem contador 0 e mensagem vazia repetida.

Menu de conversa: fixar/desafixar e detalhes de contexto nesta entrega. Não desenhar archive/delete/rename até existirem operações. Menus recebem foco, fecham por Escape e restauram foco ao gatilho. Footer de Thread: Contas, Configurações, recolher. Versão fica em Sobre/Configurações.

## Contas e composer

Painel Contas: dois provedores, estado de instalação/conexão, identificação/assinatura quando o cliente fornece. Ações Conectar ou Reconectar, Verificar conexão, Cancelar tentativa; método API é identificado como outro método e não rotulado como assinatura.

Fluxo: escolher provedor -> Conectar -> navegador -> aguardando -> conexão confirmada -> retornar ao rascunho. Se usuário cancela ou timeout, conservar conteúdo e permitir repetir login. Código manual é campo temporário só quando CLI exige. Não exibir senha/token.

Composer com Enter envia, Shift+Enter insere linha; durante composição IME, Enter não envia. Envio com botão disponível. Durante execução, rascunho editável mas envio desabilitado, Stop explícito; não criar fila automática nesta entrega. Provedor é fixo numa conversa existente; novo provedor cria nova conversa. Sem controles de modelo/permissão fictícios. Falha de login pode abrir painel de contas preservando texto. Reenviar falha é ação explícita contextual.

## Rolagem e estados

Inicio de conversa abre no fim; retornar a uma conversa visitada restaura sua posição. Quando o usuário lê acima, streaming mantém âncora e mostra Ir para o fim. Header/composer fixos pelo grid, nunca sobrepostos ao texto. Ferramentas/erros longos devem rolar no body ou painel; login/modal não injeta centenas de pixels fora da timeline.

Fixtures visuais obrigatórias: vazio, conversa curta, histórico 100 turnos, streaming no fim/acima, ferramenta longa, aprovação longa, conta desconectada, login pendente, expirado, CLI ausente, quota atingida, sidebar com 50 conversas, projeto com worktrees/homônimos, falha parcial de catálogo. Capturar themes padrão + tema da imagem e medir bounds, não só visibilidade dos botões.
