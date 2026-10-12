# Contrato visual/interação — Thread workbench

Data: 2026-09-18. Estado: contrato alvo; a primeira entrega de revisão foi implementada e auditada com capturas. Escopo entregue e diferenças pendentes em [IMPLEMENTATION.md](IMPLEMENTATION.md). Referências: imagens 1–3 do usuário; [matriz](PARITY.md) e [plano](PLAN.md).

## 1. Composição

```text
┌ sidebar comum ┬ contexto da sessão / branch / Run / Open / Review / painéis ┐
│ OXESpace      ├──────────────── conversa ──────────┬──── auxiliar ─────────┤
│ Code  Thread  │ mensagens, progresso público     │ Changes | Files | …    │
│ New thread    │ comandos compactos               │ arquivo e origem        │
│ Filter        │ arquivos com status e +/−        │ diff / editor / preview │
│ Projetos      │ resumo dos arquivos do turno     │ scroll independente     │
│ branch        │                                  │                         │
│   threads     ├ status/fila/pergunta ─────────────┤                         │
│ usage real    │ compositor / anexos / ações      │                         │
│ Accounts      │ modelo / esforço / acesso        │                         │
│ Settings      ├──────────────────────────────────┴─────────────────────────┤
│ Collapse      │ estado de contexto/execução quando disponível              │
└───────────────┴────────────────────────────────────────────────────────────┘
```

Uma barra de contexto por sessão/célula; Code/Thread permanece na sidebar, sem seletor duplicado no topo. A região auxiliar ocupa largura da célula, não vira sidebar de projetos. No grid, cada célula tem conversa, contexto, compositor e painéis próprios. O menu geral de grid não se confunde com o catálogo de painéis.

## 2. Tokens e medidas

| Elemento | Regra |
|---|---|
| Sidebar | Preferência comum ao Code: 248 px inicial, faixa 240–360, rail colapsado 56 |
| Superfícies | `--bg-app`, `--bg-sidebar`, `--bg-elevated`, `--workspace-canvas`/`--pane-surface` quando a composição de pane exigir; sem paleta fixa de Thread |
| Divisórias/foco | `--bd-base`/`--pane-border`, `--accent`, foco visível; mesmas primitivas Code |
| Tipografia | `--font-ui` Inter; corpo `--fs-base` 14, controles/itens `--fs-sm` 13, metadata `--fs-xs` 12; 11 só para densidade excepcional |
| Código/paths | `--font-mono`; código 12–13; paths completos disponíveis por tooltip/copy, não reduzir fonte até ilegível |
| Escala de spacing | Tokens existentes 4/8/12/16/24; grupo separa mensagens em 16–24, tool compacta 4–8 |
| Contexto/cabeçalho | Altura baseada em `--chrome-h` 48; contexto truncado com tooltip, menus 32 px/control-h |
| Linhas de navegação | `--nav-row-h` 36; mesma altura, seleção, recuo e rodapé de Code |
| Coluna de conversa | Máximo 860 px sem painel; padding lateral 24; com painel usar toda largura útil sem manter margem central enorme |
| Painel auxiliar | Inicial 420 px; mínimo 320; máximo 55% da célula respeitando mínimo útil do chat de 480 |
| Layout 1600 | Sidebar 248 + centro ~880 + auxiliar ~472 (exemplo de proporção, resize persistido) |
| Layout 1280 | Sidebar 248 + auxiliar 420 + centro 612, sem margens internas duplicadas |
| Layout 900/narrow | Auxiliar recolhido por padrão. Clique em arquivo abre drawer <= largura útil; conversa fica montada. Close/Escape e retorno de foco sempre visíveis |
| Breakpoint efetivo | Decisão pela largura disponível após sidebar/zoom/célula, não só viewport; se chat+painel não comportam 480+320, usar drawer |
| Grid | Duas colunas apenas com largura útil suficiente; quatro células adaptam 2×2 em telas largas. Narrow usa alternância de células preservadas, sem quatro compositores espremidos |
| Bordas/raios | `--nav-radius` 8 para controles, `--surface-radius` 12 em superfícies; nenhum card dentro de card sem função |

Novos tokens compartilhados, se necessários, são adicionados ao design system e auditados também no modo Code. Não acrescentar hex/rgb local só para copiar uma captura. Usar tokens semânticos de estado (dot-green/dot-red etc.) e labels/ícones; verde/vermelho no diff exige sinais +/− e descrição acessível.

## 3. Conversa e arquivos

Mensagens do usuário: alinhadas à direita, largura limitada, superfície distinta sutil derivada do tema. Assistente: texto aberto, hierarquia de Markdown já existente; evitar avatar grande/timestamp em toda linha. Timestamp completo e provider/turno ficam em detalhes acessíveis.

Atividade: resumo fechado de 32–36 px com verbo legível, contagem, duração/estado disponíveis e chevron. Comandos mostram linha compacta; output expande em área limitada com scroll/copy. Aprovações, falhas e perguntas requeridas são visíveis e não escondidas no grupo.

Arquivo: ícone coerente com ação, caminho relativo clicável, status textual/ícone e contagem +/− comprovada. Hover/foco revelam Open changes/copy path, sem exigir hover para descoberta: teclado/menu de linha continuam disponíveis. Nenhum `tool.input` JSON como apresentação padrão de edição.

Ao expandir: diff inline com números de linha somente confiáveis, contexto colapsável, highlight que respeita tema e scrollbar própria. Patch ausente informa “Patch not available”; nada de +0 −0 inventado. Truncamento aponta limite e opção de consultar arquivo/diff atual, deixando claro que é outra fonte.

Resumo ao concluir: header “3 files changed · +42 −11” somente quando comprovado; lista deduplicada por caminho/operação com contagem por arquivo; ação View changes. Undo aparece apenas após R14 e quando verificável. O texto final do agente pode explicar a mudança; UI não inventa a justificativa de cada arquivo.

Exemplo de fixture para validação (dados simulados, não mudança real do projeto):

```text
Edited  src/App.tsx                         +18 −7  Applied
Edited  src/components/Threads/ThreadView…  +24 −4  Applied
Created src/components/Threads/ThreadFile…  +56     Applied

3 files changed · +98 −11           View changes   Undo [quando elegível]
```

Diferenciar “Applying…”, “Applied”, “Denied”, “Failed”, “Observed · attribution unknown” e “Patch unavailable”. Leitura de arquivo não soma arquivo alterado. Edição pendente não recebe marcador de sucesso.

## 4. Changes/Files/Git

Menu de painéis com label+ícone+check, no formato da imagem 2; manter labels completos no menu em vez de só ícones. Cabeçalho tem título, origem/contexto e Close, além de expand/collapse quando útil. Primeiro lote lista apenas Changes/Files disponíveis; itens planejados não aparentam funcionar.

Changes oferece fonte explícita: **This turn / Selected turn / Current project**, revision/time e arquivo selecionado. Lista de arquivos e corpo de diff podem alternar conforme largura. Unificado/lado a lado, wrap, busca e Reviewed são opções locais de review. Comentário de linha indica destinatário e revisão. Feedback de envio não confunde adicionar ao rascunho com envio efetivo ao agente.

Files é árvore da raiz real da Thread, excluindo diretórios gerados conforme configuração existente, com estados loading/empty/permission/missing. Viewer/editor indica quando conteúdo mudou externamente e apresenta salvamento/erro reais. Links de arquivos removidos mostram diff histórico, sem tentar ler caminho inexistente como se ainda existisse.

Git separa staged/unstaged/untracked e merge conflicts. Stage e Reviewed são distintos. Campo de commit e branch/remote informam alvo. PR/Push/Merge aparecem quando conexão/capacidade forem verificadas, com ação deliberada. Desfazer do turno mostra proposta e conflito; nunca reset genérico escondido.

## 5. Compositor e operação

Compositor fixo na célula; textarea 44–144 px por conteúdo, padding 12–16 e linha de ações; abaixo, seletores de modelo/esforço/acesso derivados de catálogos reais. Todos os controles cabem/refluem em narrow/zoom, sem reticências no valor crítico de acesso. Estado pending “Next turn” não se confunde com configuração efetiva.

Anexos/menções em chips removíveis, com preview e estado de envio/limite. Attach só habilita suporte implementado; imagem textual não simula multimodal. Enter envia/queue conforme estado; Shift+Enter quebra linha; IME não envia prematuramente. Slash abre busca em memória, preserva foco e não inicia processo.

Durante execução: status “Working · 01:32”, Stop, tarefa em andamento pública e fila visível. Follow-up pode ser enfileirado sem interromper o turno; fila permite editar/cancelar. Falha/interrupt pausa envio seguinte até ação explícita. Perguntas bloqueadoras ocupam uma região clara com opções/texto/cancel, nunca escondidas sob textarea.

Voz: botão e shortcut consistentes com OXEVoice; estado recording/transcribing/error; fechar/cancel encerra tarefa e impede callback tardio. Draft anterior preservado e texto transcrito segue política de inserir no cursor. Permissões/erros não criam toast impossível de fechar.

Quota/contexto: compactos, sem roubar espaço do input. Cartão de conta contém janela de sessão/semanal, percentual/remaining e reset local confirmado, checkedAt e estado indisponível. Indicador de contexto mostra tokens/limite observados, não consumo de assinatura. Mensagem de erro usa o cartão de diagnóstico existente com timestamp/código/causa sanitizada.

## 6. Estados e comportamento verificável

| Estado | Apresentação/ação |
|---|---|
| Sem projeto/thread | Orientação curta + criar/selecionar; nenhum painel com dado da sessão anterior |
| Loading/recovery | Estado localizado, tentar novamente; histórico/draft preservados |
| Streaming | Atualizações compactas; follow somente se o usuário estava no fim |
| Histórico lido acima | Manter âncora; Latest messages com contador; não puxar scroll por quota/painel |
| Arquivo selecionado | Caminho/turno real no painel; seleção não muda enquanto chegam outras tools |
| Dados de patch ausentes | Label explícita; ações disponíveis não prometem diff histórico inexistente |
| Falha do agente | Diagnóstico específico, timestamp e uso quando disponível; reconnect/refresh úteis |
| Sem Git/sem HEAD | Files e patches nativos funcionam; Git explica indisponibilidade/initial commit |
| Mudança externa/conflito | Mostrar origem/revisão; Undo/comment anchor bloqueado ou precisa revalidar |
| Painel close/reopen | Preserva seleção/scroll e restaura foco; não altera adapter/turno |
| Terminal/servidor rodando | Origem/cwd/process state explícitos; fechar visualmente difere de Stop process |
| Split/narrow | Foco e tab/célula explícitos; histórico não desmonta por compressão |
| Fila após erro/restart | Pausada com editar/cancelar/retomar; sem envio surpresa |
| Provider sem capacidade | Motivo legível e lacuna rastreada; sem botão falso ou prompt literal |

## 7. Acessibilidade, scroll e desempenho

Todas as ações têm label/tooltip e foco visível. Menus/popovers/drawers usam Radix/primitivas existentes; Escape fecha a superfície mais interna e devolve foco ao iniciador. Resize tem alternativa de teclado; drag de sessão tem menu “Open in split”. Não trocar destino de Enter/Stop por evento de foco atrasado. `aria-live` anuncia mudança de estado/necessidade de ação, não cada token de streaming.

Contrast AA para texto/controles nos temas aprovados; seleção não depende só de cor. Paths/diffs/código têm overflow próprio; nenhuma barra horizontal da página. Timeline mantém âncora com medidas variáveis e carga de histórico; footer/status/composer nunca ficam atrás do painel.

Metas propostas a medir após baseline: interação de slash/painel p95 <100 ms; digitação p95 <50 ms no fixture de 10.000 eventos; leitura de histórico carrega páginas, não blobs integrais de patches. Em streaming, eventos agrupam writes/renderizações e operações de diff/highlight grandes devem poder ser canceladas/substituídas. Metas não representam medições feitas nesta sessão.

## 8. Gate visual

R02 entrega protótipo/capturas; cada onda implementada entrega a mesma fixture com capturas before/after. Revisar 900×600, 1280×800 e 1600×1000, temas light/dark, zoom 125/150%, sidebar expand/collapse, painel aberto/fechado, duas/quatro células, teclado e estados da tabela.

Critério profissional: mesmas medidas/tokens de Code, texto legível e alinhado, ações previsíveis, hierarquia de conteúdo, patches verificáveis, sem estado falso/scroll quebrado. A aprovação de uma captura bonita não substitui testes de raiz/turno, ações Git, filas, perguntas e processos.
