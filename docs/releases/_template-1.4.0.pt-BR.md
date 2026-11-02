<!--
Modelo das notas da 1.4.0 em português, para a release no GitHub; no corte vira 1.4.0.pt-BR.md. Mesmas seções e
mesma ordem do _template-1.4.0.md, com os mesmos itens: o que entra ou sai de um entra ou sai do outro.
Voz: você, resultado primeiro, abertura em negrito em cada item, nomes de tela como o app mostra; termos do
docs/design/glossary.md. Sem IDs internos, números de PR ou códigos. Apague este comentário antes de publicar.
-->
# OXESpace 1.4.0

Um espaço de trabalho que parece um produto só: português e inglês no app inteiro, pedidos que nunca esperam para
sempre, nada perdido ao fechar, seus agentes no celular e dois modos novos, o OxePod para contêineres e o OxePost
para APIs. Instalações da 1.3.x no Windows se atualizam sozinhas; no Linux, instale o pacote novo (a AppImage se
atualiza sozinha).

## Aprovar o que os agentes pedem

<!-- S1 · guia: docs/guide/pt-BR/01-acoes-confiaveis.md -->
- **Pedidos nunca esperam para sempre.** Um pedido de um agente ou do app que ninguém responde é negado quando
  expira, e um pedido crítico não pode ser permitido nos primeiros segundos.
- **Comandos que reescrevem o Git ou mexem em arquivos protegidos sempre perguntam.** `checkout`, `reset`, `clean`,
  `rebase` e afins, qualquer comando que cite os arquivos protegidos do OXESpace e qualquer comando que mude a
  configuração do Git (a sua, a do sistema ou a do repositório) nunca são aprovados por uma regra salva.
- **Regras em que você pode confiar.** Uma regra de permitir só aprova quando cobre todos os comandos de uma linha;
  comandos só de leitura dentro do projeto podem ser aprovados automaticamente (**Permissões** numa conversa). Uma
  ferramenta MCP negada sai das ferramentas do agente na sessão seguinte.
- **Política da organização em regras simples**, aplicada a provedores, ferramentas, servidores MCP, skills, bancos
  de dados e memória compartilhada, e mostrada nas Configurações.
- **Links e pré-visualizações são confirmados.** Um link só abre fora do app depois que você vê o endereço real;
  pré-visualizações de URLs com usuário ou senha são recusadas.
- **Servidores MCP que mudam depois que você confiou neles ficam em quarentena**, aparecem bem (um contador no botão
  de MCP), não listam ferramentas e só voltam a ser confiáveis de propósito.
- **Bancos de dados mais seguros.** Uma escrita em produção no MongoDB pede que você digite o nome; SQL arriscado
  (`COPY … PROGRAM`, blocos `DO`, travas de linha) é sinalizado; uma leitura de um agente nunca fecha a sua sessão.
- **Um pedido termina com quem pediu.** Fechar um painel ou encerrar a sessão de um agente retira os pedidos e as
  permissões que ele deixou esperando; eles aparecem como cancelados, não como respondidos.
- **Um agente não pode se passar pelo app ou pelo seu sistema.** Um nome que o agente escolhe para si é recusado
  quando imita o OXESpace, seus modos ou abas, o seu sistema operacional ou o fabricante dele ("Windows Security",
  "System Administrator").
- **Pedidos no app, não numa janela do sistema.** Todo pedido abre dentro da janela e diz quem pede, o risco em
  palavras (Baixo, Médio, Alto, Crítico) e o que vai acontecer. O texto do próprio agente fica separado das notas do
  app. **Negar** é o padrão, um pedido crítico não pode ser permitido com Enter, e você pode rever as decisões desta
  sessão.

## Fechar e voltar sem perder os agentes

<!-- S2 · guia: docs/guide/pt-BR/02-sessoes-que-sobrevivem.md -->
- **Nada se perde ao fechar.** Fechar a janela ou sair com arquivos do editor ou requisições do OxePost sem salvar
  lista tudo antes: salvar tudo, fechar sem salvar ou cancelar. Se um salvamento falha, nada fecha. Uma janela que
  para de responder fecha mesmo assim depois de alguns segundos.
- **Uma queda não repete o que o agente fez.** Ferramentas que estavam rodando quando o app fechou voltam como
  *Interrompido*, com **Continuar** (pede ao agente que confira antes) ou **Dispensar**; nada roda de novo.
- **Dividir painéis além do layout não derruba mais a janela**, e uma divisão sem espaço diz por quê.
- **Painéis de agente voltam para a sessão anterior do Claude ou do Codex** depois de reiniciar ou de uma queda,
  inclusive em projetos abertos por um link ou por um caminho curto do Windows.
<!-- entra quando o F32 (#311) for mesclado: acrescentar ao item acima ", ou dizem por que não conseguiram". -->

## Organizar muitas conversas

<!-- S3 · guia: docs/guide/pt-BR/03-conversas.md -->
- **Seções na lista de conversas**, guardadas pelo app: crie, renomeie, recolha, arraste conversas para dentro ou use
  o menu.
- **Um chat lateral sobre uma conversa** (`Ctrl+.`): pergunte sobre ela numa gaveta ao lado; nada chega à conversa.
- **Uma worktree isolada por conversa**, se você quiser: a conversa trabalha na própria branch e a worktree é
  limpa quando ela termina.
- **A Atividade** (o sino, `Ctrl+Shift+A`) lista o que precisa de você, o que terminou e o que é novo, e guarda
  tudo entre reinícios.
- **Uso por turno**: contexto e passos no painel de uso; um passo em andamento avisa quando está mais lento que o
  normal.
- **OxeCode e OxeChat**: os dois modos de agente têm uma família de nomes só, e conversas se chamam conversas.
- **Detalhes da conversa**, pelo cabeçalho da conversa: o ambiente (projeto, worktree, branch, agente, modelo), o
  contexto em detalhe com **Compactar**, os servidores MCP e as ferramentas que ela usou, os arquivos que ela mudou e
  o trabalho em segundo plano. Reordene as seções arrastando ou pelo menu de cada seção.
<!-- conversas aninhadas e a coordenadora do projeto (B1.3/B1.4, #287/#290) são da 1.4.1: corte de escopo do usuário; nunca listar aqui. -->

## O seu celular

<!-- S4 · guia: docs/guide/pt-BR/04-celular.md -->
- **Acompanhe e responda seus agentes de um celular Android.** Ligue a conexão com o celular em
  **Configurações › Dispositivos** e pareie lendo um código pela sua Wi-Fi local. Vem desligada, usa uma conexão
  criptografada que o celular confere com o certificado do seu computador, e nada passa pela nuvem.
- **Conversas e terminais ao vivo**, retomados exatamente onde você parou; envie uma mensagem, oriente ou pare um
  turno e responda pedidos com a sua digital. O que só o computador pode responder diz isso no celular.
- **Até 5 celulares por computador**, cada um removível na hora em **Configurações › Dispositivos**.
<!-- entra no corte: onde baixar o app Android (M8). -->
- **Notificações quando um agente precisa de você, termina ou falha**, com o celular no bolso; ele se reconecta
  sozinho quando a Wi-Fi volta.
- **O que é secreto fica na tela.** Pedidos, terminais e o código de pareamento ficam fora dos Recentes, das capturas
  de tela e das gravações de tela. No Android 13 ou mais novo, o app pode ter o próprio idioma
  (Configurações do Android › Apps › OXESpace › Idioma).
<!-- entra quando o M10/M11 (#384/#386) for mesclado: "A conversa no celular com o design Mandacaru: uma barra do
turno com o tempo, passos agrupados com diffs no lugar, uma fila visível, o pedido pendente fixo acima da caixa de
mensagem e uma fileira de teclas com Esc, Tab, Ctrl+C e setas para o terminal." -->

## As ferramentas do OXESpace para os agentes

<!-- S5 · guia: docs/guide/pt-BR/05-ferramentas-dos-agentes.md -->
- **Todo recurso do OXESpace que um agente pode usar está ao alcance pelo MCP**, e o que é só seu (pedidos, contas,
  segredos, política) nunca está.
- **Grupos de ferramentas sob demanda.** A partir dos grupos por projeto da 1.3.3, cada grupo pode ficar desligado,
  sob demanda ou sempre ligado por projeto no `oxe.yaml`; um grupo desligado nunca é oferecido a um agente.
  Resultados longos de ferramentas são cortados, e o texto completo fica num arquivo.
- **Um grupo desligado continua desligado.** O OXESpace recusa as ferramentas dele em toda chamada, mesmo se um
  agente editar a própria configuração de MCP, e registra isso em **Configurações › Diagnóstico**.
- **Configurações › Ferramentas** mostra cada grupo, o modo dele neste projeto e o custo em tokens, e muda o modo.
  Se o `oxe.yaml` tiver um erro, a página avisa e os agentes continuam com os últimos modos que puderam ser lidos até
  você corrigir.
<!-- entra quando o #336 for mesclado: "**Menos tokens no início de um agente do OxeCode.** Um agente que o OXESpace
inicia num terminal começa com cerca de 9.000 caracteres de definições de ferramentas em vez de 64.600, e fica
sabendo quando a busca de código do OXESpace é melhor que o grep." Números medidos: 64.574 → 8.965 caracteres. -->
- **Busca de código que você liga por projeto**: busca semântica por projeto do OxeChat, com um interruptor só.

## OxePod e OxePost

- **O OxePod é um modo próprio** (`Ctrl+4`): contêineres, imagens, volumes e redes, logs e estatísticas, com Docker
  ou Podman. O OxeQuery fica com os bancos de dados e conecta a um contêiner de banco com um clique.
- **OxePost, um cliente de API** (`Ctrl+5`): requisições salvas como arquivos no projeto, ambientes e segredos, e
  importação de cURL ou OpenAPI.
- **OxeQuery**: autocompletar que conhece o esquema, uma grade com filtro, fixar e um visualizador de JSON,
  **Carregar mais** para resultados longos, lint de SQL e conexões de produção seguras.

## O OXESpace do seu jeito

<!-- S6 · guia: docs/guide/pt-BR/06-o-app-do-seu-jeito.md -->
- **Português e inglês** no app inteiro, trocados nas Configurações sem reiniciar.
- **Um teclado para morar nele**: uma paleta de comandos para tudo (`Ctrl+K`), um guia de atalhos e
  **Configurações › Teclado**, F6 para andar entre regiões e um modo em que o Tab sai do terminal.
- **Acessibilidade**: verificações WCAG 2.2 AA no Windows e no Linux, cores forçadas, alvos de 24 px e caminhos de
  teclado para todas as listas.
- **Escala da interface, densidade e movimento** (Sistema, Reduzido, Completo) para o app inteiro.
- **Um visual novo**: o design Mandacaru (moldura mais leve, configurações dentro da janela, um conjunto só de estados
  para vazio, carregando, erro e offline) e a marca nova, da tela de abertura aos ícones.
- **Atualizações do seu jeito**: automático, só avisar ou desligado; fique numa versão; ou receba as versões beta.
- **Relatar um problema…** (o botão de menu ao lado do logo › **Ajuda**, ou a paleta de comandos) monta um relatório
  sem dados sensíveis para você revisar; o diagnóstico só mede enquanto está aberto.
- **Um início mais leve**: o que a primeira tela não precisa agora só carrega quando você abre.

## O que mudou de lugar ou saiu

- **Os contêineres saíram do OxeQuery para o OxePod.**
- **Nomes dos modos**: Code agora é OxeCode e Thread agora é OxeChat.
<!-- entra quando o F34 for mesclado: "**O OXEVoice foi removido.** O OXESpace não grava mais voz; o ditado do seu
sistema continua digitando em qualquer campo, e o modelo de voz baixado é apagado no primeiro início. A voz nativa
está prevista para uma versão futura." -->
<!-- entra quando o F35 (#344) for mesclado: "**A equipe saiu da barra de título.** Abra em **Ferramentas › Equipe do
projeto…**, na paleta de comandos ou com `Ctrl+Shift+T`." -->
- **Ações de Git iniciadas pelo OXESpace pulam os hooks do repositório.** Push, troca de branch e criação de worktree
  rodam sem eles; use o terminal quando um fluxo depende de hooks. Os agentes não chegam à rede pelo Git: quando uma
  tarefa precisa da branch remota mais recente, você faz o fetch no painel Git ou no terminal.
- **Fechar um painel encerra o que ele iniciou.** Trabalhos mandados para o segundo plano com `nohup` ou `disown`, e
  apps abertos pelo painel (`gedit &`, `notepad x`), agora fecham junto. Para manter algo rodando, inicie fora do
  OXESpace ou como um serviço do sistema.

## Segurança

- **Uma redação de segredos só**, em todo lugar onde texto sai do app, e uma exportação de auditoria em JSONL.
- **Texto não confiável vai cercado**: saída de programas, texto remoto e memória chegam aos agentes marcados como
  dados, não como instruções; edições na configuração dos agentes são vigiadas.
- **A janela principal não abre link sozinha**, e toda chamada entre processos confere que vem da janela do próprio
  app.
- **O app instalado carrega menos para ler.** Os source maps do processo principal não vão mais no pacote.
- **O Git passa por uma proteção só.** O OXESpace não roda Git de rede num repositório cujas configurações próprias
  mudam como o Git se conecta ou se autentica (`core.sshCommand`, `credential.helper` e afins); rode esses comandos no
  terminal. As suas configurações globais do Git nunca disparam isso.
- **O app empacotado não pode ser usado como um Node.js comum**, então outros programas não conseguem usá-lo para
  rodar o próprio código.

## Limites conhecidos

- Os limites listados na [1.3.0](1.3.0.md) continuam valendo, a menos que uma seção acima diga o contrário.
- **No Windows, um programa gráfico usado como comando de um painel aparece como encerrado logo de início.** Rode-o
  pelo shell do painel. Shells, Claude Code e Codex não são afetados.
- **No Linux e no macOS, um daemon de verdade (um processo que se separa duas vezes) continua rodando depois que o
  painel fecha.**
- **Um filtro do Git adicionado às configurações de um repositório no momento em que uma ação começa pode rodar uma
  vez** antes que o OXESpace perceba.
- **Voltar para a 1.3.3 exige restaurar o backup automático antes de abrir a 1.3.3.** A 1.4.0 atualiza seus dados na
  primeira vez que abre, depois de salvar uma cópia verificada. A 1.3.3 não consegue ler os dados atualizados: mostra
  "No workspaces yet", sem aviso, embora nada se perca. Para voltar: feche o OXESpace, instale a 1.3.3 pela página de
  Releases e, **antes de abri-la**, coloque o `oxespace-v77-…sqlite3` mais recente da pasta `db-backups` no lugar de
  `oxespace.sqlite3`. A pasta é `%APPDATA%\OXESpace` no Windows e `~/.config/oxespace` no Linux. Depois abra a 1.3.3.
  Os passos completos estão em
  [Voltar para a versão anterior em uma máquina](https://github.com/propagno/oxespace/blob/main/docs/ci-cd.md#going-back-to-the-previous-release-on-one-machine)
  (em inglês).
- **O celular e o computador precisam estar na mesma rede local**; não há acesso pela internet, e o app do celular é
  só para Android.
