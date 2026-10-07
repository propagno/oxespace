# Diagnóstico: Web Preview, Playwright e nova Thread via MCP

## Sintoma e alcance

Pedido: servir uma página Node com três abas, abri-la no Web Preview, obter uma captura de cada aba com Playwright e enviar o diretório absoluto das imagens para uma nova Thread via MCP.

Observado nesta sessão:

- O servidor criado em `web-preview-playwright-test/server.mjs` respondeu a `http://127.0.0.1:4178/health` com `{"ok":true,"port":4178}`.
- `oxespace_capabilities({})` permaneceu sem resposta durante aproximadamente 703 segundos até a interrupção do turno. A captura do usuário mostrava `mcpToolCall · oxespace_capabilities` em execução, `Waiting for your input` e nenhum formulário visível.
- `oxespace_open_web_preview({url:"http://127.0.0.1:4178"})` não retornou durante 25 segundos. Esse limite foi imposto por `Promise.race` no cliente, que **não cancela** a chamada MCP subjacente e não prova falha no servidor.
- O runtime de navegador integrado respondeu `No browser is available`; a descoberta subsequente retornou `[]`. Portanto, não havia uma instância acessível daquele navegador para `tab.playwright` nesta sessão. Isso não mede, por si só, a disponibilidade do Web Preview do OXESpace.
- Não foram produzidos prints nem criada outra Thread. O catálogo MCP visível não contém ferramenta comum de criar Thread e enviar mensagem para ela.
- Os arquivos `logs/main.log` e `logs/main.old.log` locais não trazem correlação dessa chamada. O log mais recente observado tem data de modificação anterior ao incidente da captura, portanto não permite localizar a requisição entre ponte, servidor e UI.

## Causas confirmadas e limites

| Camada | Achado | Estado |
| --- | --- | --- |
| Servidor Node | HTTP local respondeu ao health check. A URL usa protocolo aceito por `isSafeExternalUrl`. | Eliminada como causa da primeira parada. |
| Descoberta de capabilities | `automationTools` aguarda `delegation.capabilities(execution)` sem prazo máximo; esse método aguarda `projectIdentity()`, que inclui `realpath` sem prazo. `catch` só cobre rejeição. | Caminho concreto capaz de prender essa ferramenta, mas sem trace não há prova de que tenha sido o ponto de bloqueio neste incidente. |
| Abertura do preview | `openWebPreview` autentica, valida URL, emite evento em memória e retorna `{opened:true}`. Não aguarda o carregamento da página. | Bloqueio de 25 s não se explica pelo carregamento do site dentro desse handler. A parada está antes dele, na autenticação/transporte, ou em listener síncrono; a etapa exata é desconhecida. |
| Ponte MCP | `http.request` usa `req.setTimeout(5000)`, prazo de inatividade do socket. Não há prazo de ponta a ponta com correlação e cancelamento no RPC principal. | Lacuna de contenção/observabilidade confirmada. Não é prova de que a ponte instalada executou esse código. |
| Web Preview | O evento é `fire-and-forget`; `opened:true` confirma despacho, não URL carregada no painel. | Sucesso reportado pode ser falso, embora essa chamada nem tenha retornado aqui. |
| Playwright | A ferramenta de navegador integrada encontrou zero navegadores; o controle MCP do preview usa Electron/CDP, não entrega uma sessão `tab.playwright`. | Requisito de Playwright no Web Preview indisponível nesta sessão. |
| Nova Thread | `ThreadApi.create` existe via IPC da UI; as ferramentas MCP de delegação criam trabalho isolado e têm semântica diferente. Não existe ferramenta MCP geral `thread.create` + `thread.send`. | Lacuna de capacidade confirmada para o pedido literal. |
| Capturas em disco | `oxespace_capture_web_preview` devolve um bloco `image/png` em base64; não grava arquivo nem devolve caminho. | Etapa adicional de persistência seria necessária mesmo com preview funcional. |
| UI de espera | `deriveThreadLiveActivity` rotula todo estado `approval` como `Waiting for your input` e nunca o marca como stale; `useThreadStateCheck` não observa estados que aguardam input. | Pode mostrar espera indefinida. A captura não prova que a chamada de capabilities tenha originado o estado `approval`; ele pode ser anterior. |

## Hipóteses abertas, em ordem

1. A chamada não chegou ao servidor MCP interno ou seu resultado não retornou pelo adaptador do provedor. Explica por que até `openWebPreview`, cujo handler é imediato, ficou pendente. Exige correlação de IDs nas quatro bordas.
2. A chamada de capabilities chegou e ficou aguardando `projectIdentity` ou `delegation.capabilities`. Explica capabilities, mas não explica sozinha a abertura do preview; ambas poderiam compartilhar um processo principal indisponível.
3. A instalação beta.6 em execução difere da árvore de código local, que contém correções ainda não publicadas. Exige comparar SHA/versão do `app.asar` e da ponte lançada.
4. O `approval` exibido é um pedido pendente anterior fora da janela do histórico. A correção local de `pendingRequests` cobre isso, mas ainda não estava instalada na beta.6. Exige inspecionar o estado da Thread afetada, sem reexecutar a ferramenta bloqueada.

Não há evidência suficiente para atribuir a parada exclusivamente a Full access, ao servidor Node, ao Playwright, à cota do modelo ou à rede pública.

## Correções recomendadas

1. **P0, contenção do MCP:** introduzir deadline absoluto por chamada no cliente e no servidor, com ID de correlação, etapa e erro estruturado. Cancelar a operação subjacente quando possível. Nunca repetir automaticamente operações que possam ter efeito após `delivery:unknown`.
2. **P0, diagnóstico observável:** registrar apenas ferramenta, ID, execução, timestamps de entrada/saída/timeout e etapa (`provider`, `bridge`, `RPC`, `handler`, `renderer`), com rotação pequena. Um status de operação deve distinguir “aguardando aprovação real”, “ferramenta em execução” e “sem resposta do transporte”.
3. **P0, UI:** se `approval` não tiver pedido pendente visível, mostrar atualização/diagnóstico/interrupção; se o último sinal envelhecer, exibir falha de comunicação e permitir inspeção mesmo no estado `approval`. A correção local dos cartões pendentes deve ser incluída na próxima instalação antes de retestar.
4. **P1, capabilities:** retornar o catálogo estático imediatamente e tratar a capacidade de delegação como opcional com prazo curto. Evitar `realpath` sem limite no caminho de descoberta.
5. **P1, Web Preview:** devolver `queued` com ID e implementar confirmação explícita de painel montado, navegação e URL final, ou esperar essa confirmação sob prazo limitado. Não chamar despacho de evento de “opened”.
6. **P1, fluxo de captura:** oferecer saída local segura para a captura, limitada a diretório de artefatos do workspace, e devolver caminho absoluto, tamanho e hash. A API atual só devolve bytes.
7. **P1, Playwright:** definir uma ligação suportada entre Playwright e o alvo do Web Preview com controle por execução, ou declarar que os controles MCP do preview substituem Playwright para esse caso. Um navegador externo separado não comprova o Web Preview do OXESpace.
8. **P1, Thread MCP:** expor criação e envio a uma Thread normal com escopo, idempotência e autorização explícitos. Delegação em worktree e mensagens de Team não substituem esse contrato.
9. **Processo do agente:** descobrir capacidades por metadados já disponíveis quando possível; não usar `Promise.race` como se cancelasse uma chamada MCP; informar imediatamente quando o backend não oferecer o requisito pedido.

## Como confirmar a causa exata na próxima reprodução

Sem repetir chamadas longas às cegas: habilitar o trace curto acima, confirmar qual build e ponte estão em execução, iniciar uma única chamada de leitura simples e depois uma abertura de `localhost`. O último ID/etapa com timestamp visto indicará se a parada está antes do RPC, em `projectIdentity`, no handler, no evento de UI ou na volta ao provedor. Só então aplicar o hotfix do ponto confirmado. Não iniciar Docker para esse diagnóstico.

## Implementação beta.7

O reparo local removeu a consulta assíncrona de delegação de `oxespace_capabilities`, adicionou prazo absoluto e ID de correlação à ponte, registrou apenas chamadas lentas/erros no log rotativo de 512 KiB, distinguiu preview enfileirado de carregado, permitiu salvar capturas PNG com caminho absoluto e adicionou ferramentas MCP para criar/enviar a uma Thread normal com chaves idempotentes. A interface sinaliza pedido ausente e mantém cartões pendentes fora do histórico paginado. A migração 63 persiste os vínculos de handoff. A causa exata do travamento antigo continua indeterminada até existir trace da instalação beta.7.
