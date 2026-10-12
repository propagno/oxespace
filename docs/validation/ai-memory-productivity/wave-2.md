# Onda 2 — atualização e identidade de captura

Data: 2026-10-10. T03/T04 implementadas em código local. O runtime oferecido para instalação gerenciada é **ai-memory 2.6.2**; dados pessoais existentes não foram migrados nesta validação. Os testes usaram somente diretórios e contas sintéticos. A entrega de captura externa e a matriz de ciclo completo seguem para T05–T07.

## Resultado da implementação

- Instalação verificada por checksum de arquivo oficial, extração em diretório temporário e troca atômica; erros de checksum/extração não deixam runtime ativado. Arquivo compactado temporário é removido. Instalação já verificada é reutilizada somente se manifest e executável ainda conferirem.
- Transação de atualização 2.1.0 → 2.6.2: parar apenas processo gerenciado; negar migração se outra escuta ocupar a porta; verificar espaço e rejeitar links; copiar diretório completo parado (incluindo SQLite/WAL, spool e token); iniciar 2.6.2 sobre a cópia em porta loopback isolada; trocar diretórios após saúde; registrar cada fase em journal privado. Recuperação restaura o estado antigo após interrupção. Snapshot antigo é retido para rollback; escritos feitos depois da atualização são preservados à parte. Um snapshot pendente impede empilhar upgrades.
- Configuração gerenciada 2.6.2 usa `--enable-api`, perfil desativado e ofertas de handoff sem consumo automático. Servidor conectado permanece intocado e não recebe configuração/token em disco local. Hooks gerados são regeneráveis sem duplicação; JSON temporário do instalador é removido.
- Thread recebe a configuração do hook apenas com hooks habilitados e acesso de escrita. A seleção é feita antes do subprocesso, usando execução, workspace, agente esperado e projeto já vinculados; hookless/read-only mantém MCP do projeto mas rejeita captura nativa. Variáveis herdadas de outro workspace continuam filtradas. Produtor externo não é ativado nesta onda.
- O fim de uma execução só solicita `finalize-session` para sessões cujo `SessionEnd` nativo foi observado. Isso impede declarar uma sessão filha viva encerrada por saída do pai; continuidade completa e drain ficam no gate T07.

## Validação executada

| Ambiente | Evidência | Resultado |
|---|---|---|
| Windows x64 | Falhas injetadas após cópia, validação, snapshot, troca e gravação de settings; journal simulado em estado intermediário; symlink/junction e rollback | Testes unitários passaram, sem skips na execução final |
| Windows x64 | Binários oficiais 2.1.0/2.6.2, dados sintéticos, upgrade, busca após upgrade, restauração com token e conteúdo, hooks repetidos | Teste nativo aprovado isoladamente; uma execução paralela excedeu timeout curto de busca, aprovada na repetição isolada sem alterar timeout |
| Windows x64 | ZIP oficial em fetch controlado: checksum incorreto, extração inválida, instalação limpa, reutilização do manifest | 1/1 aprovado |
| Windows x64 | Transporte de subprocesso, serviço, identidade de worktrees e isolamento de marcador | Suítes direcionadas aprovadas; ver saída local |
| Linux x64 em Docker limitado | Tar oficiais SHA256 verificados; migração, rollback, instalação, transporte, serviço e falhas injetadas | 16/16 aprovados; teste nativo de migração repetido após ajuste de parada: 1/1 |
| Build | `npm run build`, incluindo `verify:bundle` | Aprovado |

O contêiner Linux usou a imagem de certificação previamente validada, 1 CPU, 1 GiB RAM, 192 PIDs, log de 2 MiB e workspace montado somente para leitura. O contêiner foi removido e o Docker Desktop desligado. Nenhuma memória pessoal ou servidor conectado foi migrado. A execução Linux completa ocorreu antes do ajuste final de limpeza dos JSONs temporários do instalador e da proteção contra corrida entre lançamento e migração; ambos foram exercitados no Windows após a alteração. Essa diferença de revisão está registrada, sem extrapolar cobertura.

## Limites para a onda 3

O snapshot ocupa espaço adicional até o usuário decidir sobre ele; a UI oferece restauração e o processo bloqueia outro upgrade enquanto ele existir. Não há compactação/limpeza de acervo nesta onda. A validação da máquina Windows não certifica instalação real de pacote Electron nem autenticação Linux dos provedores. Eventos de filhos que continuam após a saída do pai exigem o modelo externo de ciclo e outbox de T05–T07; nenhum evento não admitido é apresentado como persistido. O baseline comparativo e o piloto continuam em T15/T16.
