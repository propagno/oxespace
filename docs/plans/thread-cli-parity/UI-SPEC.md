# Contrato UI para paridade operacional

Data:2026-09-18. Estado: planejado. Complementa [UI-SPEC do workbench](../thread-workbench/UI-SPEC.md); conserva tokens e componentes Code.

## Superfícies e comportamento

**Compositor:** textarea montado permanentemente, modelo/esforço/política efetiva no rodapé; configurações pendentes indicam próximo turno. Anexos ficam em chips com thumbnail/nome/status/remover. Paste de código mantém newline; paste/drop de imagem cria upload, sem auto-send. Barra abre catálogo em memória; refresh é explícito. Enviar Agora direciona turno somente se suportado; Adicionar à fila mantém a ordem e mostra quando será processado. Erro mantém texto/anexos.

**Perguntas:** cartões na timeline, separados de mensagem/atividade, com título claro, opções e descrição, seleção única/múltipla ou texto livre, Responder/Cancelar. Header mostra aguardando resposta e sidebar indica a sessão pendente. Campos obrigatórios têm validação inline. Pergunta é renderizada mesmo em read-only; responder não altera permissões de escrita.

**Aprovações:** mostrar ação/comando/arquivos/rede, motivo e alcance solicitado antes dos botões. Decisões permitidas vêm do provider: aprovar esta ação/turno/sessão, negar/cancelar, editar escopo quando suportado. Não exibir opção ausente no protocolo. Fechar detalhes/pressionar Escape não aprova e não cancela silenciosamente o request; o cartão permanece até decisão/expired/resolved.

**Fila:** lista compacta sobre o compositor ou painel acessível, com queued/sending/running/unknown/paused/failed. Editar, remover e reordenar preservam snapshots e IDs. Falha/auth/quota ou pergunta pausa avanço. Resultado desconhecido oferece reconciliar/retomar; reenviar escrita exige escolha explícita, sem spinner eterno.

**Sessões:** navegador nativo com provider/root/branch/status/atualização, filtro e import/resume. Rótulos distinguem ocultar projeto, remover Thread local, arquivar sessão nativa e excluir sessão nativa. Menus por projeto/Thread reúnem ações secundárias; New thread continua fácil de localizar. Branch fica abaixo do projeto com truncamento/title. Sidebar expanded/collapsed tem dimensões/footer consistentes com Code.

**Extensões:** MCP/apps/plugins/hooks/skills com discovery/habilitado/authorized/connected/failed separados. Autenticar/recarregar/testar são ações reais e mostram resultado. OAuth/form/url não abre agent TUI; usa diálogo/fluxo de conta validado. Falta de API tem explicação e permanece lacuna. Listas vazias de resources/templates não dizem disconnected.

**Observabilidade:** tool/comando/arquivo/request/child são entradas semânticas; output expansível por item/turno, sem poluir o chat com nome técnico repetido. Progresso público, erro e quota são distintos. Mostrar origem/horário de reset e política/modelo efetivos; ausência de dado recebe texto explícito. Nunca mostrar raciocínio privado ou config com credenciais.

**Workbench:** manter conversa ao lado dos painéis. Files/editor/Git/Preview/terminal explícito recebem o root da Thread; comentário de revisão chega ao draft correto. Fechar painel não mata execução. Células opcionais mantêm compositor/draft/foco/requests próprios; só célula focada recebe atalhos/voz.

## Estados/foco/teclado

- Loading/success/failed/denied/cancelled/expired/recovering possuem texto e controle de saída; nenhum erro impossível de fechar.
- Trocar Thread não transfere resposta ou gravação; retomar restaurará request válido e rascunho.
- Setas/Enter/Escape em menu só controlam menu. Enter no multiline/composição IME não envia indevidamente; Shift+Enter adiciona linha.
- Diálogos Radix com título/descrição, foco contido e retorno ao trigger; cards não capturam foco automaticamente durante leitura/streaming.
- O compositor continua editável durante execução; envio oferece ação suportada de steering/fila. Config UI pending não pode declarar native apply confirmado.
- Readers têm labels, live regions moderadas e status sem depender só de cor; reduz-motion respeitado.
- Voz Ctrl+Shift+V/hold funciona no compositor focado; dismiss interrompe captura/cancela HUD e mantém texto, sem destino no Code oculto.

## Identidade, responsividade e aceite visual

Usar tokens Code de superfícies, tipografia, dimensões, bordas, focus ring, estados/destructive; Lucide, Radix, DesktopDialog e DetailList existentes. Não introduzir paleta independente ou Tailwind do cdesktop. Texto do produto mostra provider/efeito/estado; IDs técnicos ficam em detalhes.

Em1440x900: sidebar e chat legíveis com painel lateral. Em900x720: workbench drawer, dialogs/menu sem overflow horizontal e foco recuperável. Emlargura menor: preservar controles essenciais com menu acessível e scroll interno; não empilhar margens grandes em cima/baixo. Claro/escuro e escala do sistema são verificados.

Capturas obrigatórias durante implementação: pergunta pendente, aprovação com alcance, fila e anexo, erro recuperável, integrações, dois worktrees/células, sidebar expand/collapse e review; tema claro/escuro em900/1440. Comparar com Code real na mesma configuração. Screenshot sozinha não comprova que ação funciona.
