# Thread beta.6 — imagens de 2026-10-07

Evidência: seis capturas fornecidas em `Downloads/bugprojetos`, entre 12:36 e 12:44. As imagens não foram copiadas para o repositório.

## Diagnóstico e alterações

- Diffs extensos: a coluna implícita do grid de arquivos crescia pela largura mínima do conteúdo. Coluna limitada por `minmax(0, 1fr)` e filhos com `min-width: 0`; linhas longas continuam acessíveis pela rolagem interna do diff.
- Comando em execução: o elemento flex que envolve o título não podia encolher. Agora o título trunca dentro do cartão, conserva tooltip e deixa espaço para ícone e contador.
- Duração: o contador já media o turno inteiro, mas parecia medir o comando exibido. Agora apresenta `Turn · duração`, com explicação acessível de que inclui comandos anteriores e espera por respostas.
- Full access: no adaptador Codex, sandbox e `approvalPolicy` são enviados separadamente. A imagem mostra um pedido MCP, apresentado como elicitation. Full access não autoriza responder automaticamente a formulários, URLs ou confirmações MCP. O seletor agora mostra também a política de comandos; o menu e o cartão explicam essa distinção. Não houve mudança silenciosa de permissões nem autoaceitação de pedidos.

## Validação

Regressão Electron ampliada com comando muito longo e diff com linha extensa, verificando limites do cartão e coluna, rolagem interna e identificação do tempo do turno: passou (32 segundos). Os 40 testes focados de atividade, aprovações e adaptador Codex passaram. Teste de componente verifica que a explicação MCP não envia resposta sem ação do usuário. Build e limites de bundle passaram. Docker não foi iniciado.

Estas alterações locais ainda não foram publicadas nem instaladas sobre a beta.6 em uso.

Checagem de tipos, lint dos arquivos alterados e `git diff --check` também passaram.

## Correção funcional após nova evidência de espera sem resposta

A captura posterior mostra `Waiting for your input` sem cartão de resposta e sem sinal recente por mais de 37 minutos. A chamada de memória desta própria sessão também ficou bloqueada; não repetir essa integração para registrar a correção.

A explicação de Full access era insuficiente para esse problema. Foram identificadas duas lacunas: pedidos acionáveis dependiam da janela de 250 eventos devolvida pelo backend e eram montados apenas dentro do histórico virtualizado. A projeção agora inclui uma lista separada de pedidos pendentes (até 100 por leitura; os demais ficam disponíveis nas leituras seguintes após resolver os anteriores), consultada quando o estado exige input. A interface apresenta esses cartões acima do composer, fora da virtualização, e mantém os pedidos resolvidos no histórico. Se o status exige input sem pedido disponível, oferece atualizar a leitura e abrir diagnóstico, com orientação para interromper pelo botão existente; não inventa uma aprovação nem reenvia a mensagem.

Regressão de banco: pedido seguido de 300 eventos permanece acionável em uma janela de 20 eventos e desaparece da lista após resolução. Dezessete testes focados passaram. Validação Electron ampliada passou (32,3 segundos), cobrindo resposta a pedido ausente do histórico, botões acessíveis após rolar a conversa e estado de espera sem payload. Essas regressões comprovam as lacunas corrigidas; não estabelecem, sem o estado da sessão afetada, a causa exclusiva da espera na captura.

Após a correção funcional, build, checagem de tipos, lint dos arquivos envolvidos, limites de bundle e `git diff --check` passaram. Docker não foi iniciado e a integração MCP bloqueada não foi chamada novamente. A instalação beta.6 existente não foi substituída.
