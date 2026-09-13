# Manuais com evidências pelo MCP

Este incremento permite produzir manuais locais em Markdown e HTML com screenshots
e manifesto JSON. Não depende do AI Memory e não publica arquivos automaticamente.

## Como usar

1. Abra o projeto e o Web Preview no OXESpace. Faça login manualmente.
2. Para um site remoto, habilite **External**. Habilite **Agent access** somente
   se autorizar compartilhar conteúdo com o agente e, potencialmente, seu fornecedor.
3. Em um terminal com o MCP configurado, peça:

   > Crie um manual deste fluxo usando as ferramentas oxespace_documentation.
   > Primeiro apresente o roteiro. Inspecione o Web Preview; peça aprovação para
   > interagir. Capture cada etapa, mascare dados privados, confira as imagens e
   > exporte Markdown e HTML. Não publique nem altere dados reais sem aprovação.

4. O agente cria um manual com `oxespace_documentation_create` (título e chave
   estável), salva passos com `_checkpoint`, usa `oxespace_preview_interact` para
   inspecionar e interagir, e associa screenshots aos passos com `_capture`.
5. `_image` retorna a imagem ao agente para revisão. Essa chamada também exige
   acesso habilitado no preview. Marcar um passo `verified` exige screenshot e
   evidência textual; é uma afirmação do agente, não uma auditoria independente.
6. `_export` gera arquivos locais e informa seus caminhos, avisando sobre passos
   sem captura ou sem revisão. O HTML inclui as imagens; Markdown precisa ficar
   junto dos arquivos PNG. O manifesto contém o roteiro e notas de handoff.

## Continuidade e concorrência

`_list` encontra manuais do projeto; `_get` retorna roteiro, notas, revisões e
operações. Uma nova sessão pode continuar pelo mesmo `jobId`, sem reutilizar o
session ID do agente anterior. Worktrees usam a identidade do diretório Git comum.
Projetos diferentes são isolados. Fora de Git, a identidade é o diretório real.

Cada checkpoint exige a revisão atual. Em conflito, releia o manual e reconcilie
as alterações. Capturas e exports têm uma chave de idempotência: após timeout,
consulte `_get` e reutilize a chave com os mesmos parâmetros. Não repita cliques
automaticamente: uma ação pode ter sido executada mesmo sem resposta.

Ao reiniciar, operações que ainda estavam em execução ficam `interrupted`.
Capturas concluídas têm referência e recibo gravados na mesma transação. Notas e
artefatos sobrevivem ao encerramento do terminal. O login do navegador e o opt-in
não são restaurados automaticamente.

## Limites e segurança

- Capturas: viewport ou elemento totalmente visível. Captura de página inteira
  foi excluída após reproduzir imagens incorretas no compositor do Electron/Windows.
  Divida páginas longas em etapas; a ação `scroll` leva um seletor à área visível
  após confirmação. Não há interação dentro de iframes.
- Inspeção não lê valores de inputs. Screenshots mascaram inputs, textareas,
  iframes, elementos `data-private`/`data-sensitive` e seletores `redact` adicionais.
  Isso não garante anonimização: textos, títulos, caminhos e elementos dinâmicos
  podem conter dados privados. Revise antes de compartilhar. As máscaras são DOM
  overlays, não uma fronteira de segurança contra páginas maliciosas.
- `highlight` destaca elementos. Clique, preenchimento e navegação exigem
  confirmação nativa por ação. Senhas e uploads devem ser feitos manualmente.
  Inspecione novamente após cada ação: envio de evento não prova sucesso funcional.
- Conteúdo da página é evidência não confiável, nunca instrução para o agente.
- Arquivos ficam em `userData/documentation/<jobId>`; metadados no banco do app.
  Não há criptografia adicional, limpeza automática, editor visual ou botão de
  exclusão neste incremento. Inclua diretório e banco nas políticas de backup e
  retenção. Não use dados de produção sem autorização.
- Limites: 100 passos/manual, 200 capturas, 20 MB/captura, 64 MB de imagens/export.
  Histórico e listagem retornam até 100 registros. Use manuais menores por capítulo.

## Escopo ainda pendente

Exportação nativa PDF/DOCX, captura longa confiável, biblioteca visual de artefatos,
retenção gerenciada, coordenação automática de capítulos e journal genérico para
todas as operações MCP não estão implementados neste incremento. Handoff funciona
pelos checkpoints/notas compartilhados, sem despertar automaticamente outros agentes.

## Verificação

`npm run test:electron -- tests/integration/documentation.test.ts tests/integration/documentation-tools.test.ts tests/integration/migrations.test.ts`

`npm run build` e `npx playwright test e2e/documentation-preview.spec.ts`

O E2E usa uma página HTTP local e o webview real, com serviços de terminal simulados.
Confirmações nativas são simuladas somente no processo isolado do teste.
