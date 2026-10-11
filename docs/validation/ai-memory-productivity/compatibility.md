# Compatibilidade — execução inicial

Este relatório registra o estado da onda 1. A atualização gerenciada para 2.6.2 e a validação da onda 2 estão em [wave-2.md](wave-2.md).

Data: 2026-10-09. Base OXESpace: `588d6f4f51ce8ea8936a7c137e025a96f439968a` com alterações locais desta trilha. Ambiente: Windows x64, testes sob o Node do Electron instalado. A primeira execução não usou Docker; a certificação Linux posterior foi autorizada pelo usuário e está em [linux-docker.md](linux-docker.md). Runtime do aplicativo permanece fixado em 2.1.0; nenhuma migração de dados do usuário foi feita.

## Resultados comprovados

| Verificação | Resultado |
|---|---|
| Certificação 2.1.0 após mudanças | 12/12 testes, zero skips; runner 10.904 ms |
| Certificação 2.6.2 após mudanças | 17/17 testes, zero skips; runner 13.281 ms |
| Cliente, wrapper, serviço, ferramentas e diagnósticos | 33/33 testes |
| TypeScript | `npm run typecheck` aprovado |
| ESLint dos módulos e testes alterados | Aprovado |
| Gate sem binário informado | Exit 1, `Required: --binary`; não passa por skip |
| Linux via Docker | 12/12 na 2.1.0, 17/17 na 2.6.2 e 33/33 complementares; ver [evidências e tentativas](linux-docker.md) |

Tempos acima são de suítes com quantidades diferentes de testes: **não são benchmark de produtividade, nem prova de regressão/melhoria de latência**. V12 e piloto V14 continuam pendentes.

## Identificação dos binários

Arquivos baixados das releases oficiais, arquivos compactados verificados antes de extrair. Diretórios temporários separados por versão; fixtures novas por teste.

| Windows x64 | SHA256 do ZIP | SHA256 do executável extraído |
|---|---|---|
| 2.1.0 | `72c477e5c02b54c202e1c7515aacf00a1702f9916c51a26d875fcfeff65b1451` | `2af6a668f1148a9b53c63cb64506d065de0ed89f260aa3700cb524db7e333e4a` |
| 2.6.2 | `740952e38b29f684291801251dc5ee7c67fd03b926c72f1fda2d3a006cdb57a0` | `409eeb65e5add0d6ef70c5d7b830f80bca3815d24b233b0daea25e31ae79f47d` |

Reprodução, depois de verificar a origem do executável:

```powershell
node scripts/test-memory-compatibility.mjs --binary C:\caminho\verificado\ai-memory.exe --version 2.6.2 --sha256 409eeb65e5add0d6ef70c5d7b830f80bca3815d24b233b0daea25e31ae79f47d
```

O runner verifica versão, digest, número exato de testes e ausência de skips. Limita execução a 180 segundos e encerra sua árvore de processos se excedida. O JSON temporário é removido; resumo agregado fica no stdout. A workflow `Memory compatibility` prepara quatro células Windows/Linux × 2.1.0/2.6.2 com hashes de arquivos compactados fixados. **Workflow criada localmente, ainda não executada no GitHub**; a compatibilidade Linux foi validada localmente via Docker, mas a workflow ainda não é um gate obrigatório da release principal.

## Falha encontrada e correção

O teste de runtime 2.6.2 excedia 30 segundos durante SessionStart do wrapper. Instrumentação temporária isolou a espera após a execução inerte e antes do retorno de SessionStart. A inspeção de processos identificou um descendente `backfill --auto --quiet`, com data-dir pertencente à fixture. Esse processo específico de teste foi encerrado; o runtime pessoal não foi encerrado.

O wrapper não fornecia `cwd` ao subprocesso nativo. O processo herdava o checkout do aplicativo, enquanto o payload apontava para outro checkout. O código upstream 2.6.2 usa `current_dir()` no disparo de backfill durante SessionStart. A documentação registra importação inicial automática a partir da versão 2.3.0.

Correção: passar o `cwd` da sessão que o serviço já autorizou e definir `AI_MEMORY_BACKFILL_ON_START=false` **depois** da filtragem de ambiente. Isso preserva captura da sessão vinculada e impede a importação automática de históricos como efeito colateral. Após ambas as alterações, o mesmo teste passou nas duas versões. Não foi feito experimento isolando a contribuição temporal de cada alteração; não se atribui todo o timeout a um único mecanismo interno.

A regressão executa o wrapper real em VM controlada e confirma cwd, ambiente sanitizado e bloqueio do backfill. Os testes nativos também proíbem backfill automático. Não foi auditado o conteúdo interno das fixtures das primeiras tentativas; não se afirma que nenhum histórico foi lido pelo processo identificado. Nenhum conteúdo foi incluído nos relatórios.

## Contratos confirmados em 2.6.2

- `--enable-api`: identidade autenticada, handshake MCP, schemas de ferramentas e leitura incremental funcionam sem `--enable-web`.
- Capture-owner suprime captura nativa; preflight distingue a política do projeto da supressão por produtor externo.
- Batch distingue `stored`, `replayed` e `dropped_invalid`. Para lotes contíguos observados, o servidor retorna `accepted` e `results`, sem `accepted_indices`; o worker futuro precisa suportar ambas as formas.
- Configuração sem consumo automático mantém ofertas durante abertura de sessão. Aceitar um ID específico não consome a outra oferta.
- O handshake exige anunciar JSON e SSE no cabeçalho Accept; anunciar apenas JSON produz HTTP 406. A integração mantém o cabeçalho original. Recebimento efetivo de SSE ainda é rejeitado como protocolo não suportado, sem sucesso vazio.
- Cliente distingue autenticação, transporte, protocolo, rejeição MCP, cancelamento e resposta excessiva. Mensagens remotas privadas não são anexadas ao erro. O prazo do manager aborta o transporte através do provider vinculado à operação.

## Decisão relay / outbox

**Escolha para T05: outbox própria e separada do banco upstream**, com contrato de entrega inspirado no relay e testes de equivalência. O relay documentado exige compilação Cargo separada; não aparece no ZIP Windows verificado. Seus limites são de pending body bytes e contagens/receipts, diferentes do limite físico total de 64 MiB e 10.000 eventos proposto para OXESpace. Reutilizar o binário exigiria nova distribuição e controle adicional do tamanho físico, sem eliminar trabalho de admissão e políticas.

Não instalar Rust nem compilar o companion nesta etapa. A decisão não implica que o relay seja inseguro; considera distribuição e limites deste produto. Sanitização local, quota física, ACK parcial, colisão, ordenação e recuperação devem ser demonstrados antes de ativar a captura externa.

## Limites e próximo gate

T01/T02 concluídas no gate da onda 1, conforme [fechamento e ajuste de sequenciamento](wave-1.md). Contratos Windows/Linux, decisão relay/outbox e baseline de recuperação disponíveis. T02 implementa HTTP/cancelamento/capacidades e estados separados de captura/entrega/consolidação, expostos como `unknown` até existir evidência do estágio correspondente. Disponibilidade da API não comprova persistência; UI e observabilidade efetiva pertencem às ondas posteriores.

Em 2026-10-10, a caracterização `tests/integration/memory-thread-environment.test.ts` executou um subprocesso pelo transporte de produção: o ID de execução e workspace novo chegam, mas `OXESPACE_MEMORY_RUN` fornecido pelo launcher é omitido. O wrapper real retorna `{}` sem configurar captura. Confirmada a falha estrutural de propagação; isso não demonstra que todas as sessões tenham perdido captura. A correção com seleção de produtor pertence a T04/T07, evitando captura duplicada.

O runtime gerenciado continua 2.1.0. V12 ponta a ponta, matriz autenticada completa e CI hospedada não foram aprovados: seguem em T15/T16 e nos gates intermediários correspondentes. Codex e Claude autenticados no Windows; 7 smokes nativos e a retomada Claude com dois turnos reais passaram. Confiança de planejamento revista para 92/100, com justificativa por dimensão no PLAN; não é nota de maturidade do produto nem autorização para migrar dados sem V03.

Fontes: [release 2.6.2](https://github.com/akitaonrails/ai-memory/releases/tag/v2.6.2), [hook nativo](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/crates/ai-memory-cli/src/commands/hook.rs), [instalação e upgrade](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/docs/install.md), [relay](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/companions/ai-memory-relay/README.md).
