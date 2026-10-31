# Aprovar o que os agentes pedem

> Toda ação de agente que importa pergunta uma vez, com clareza, dentro do OXESpace, e nunca trava nem passa sem você.

<!-- Sobre esta página: Fatia S1 · Quem preenche: BACKEND (contrato) + FRONTEND (F18) · Itens: B10, F18, B7.3, B16, B12, B6 · parcial: descreve o que já está na main em 31/10 (cartão de pedido do OxeChat, regras de permissão, B10, B16). O modal de aprovação do app (F18, #243) e os níveis de risco entram nesta página quando ele for mergeado. -->

Também em: [en](../en/01-trustworthy-actions.md)

## O que você consegue fazer

- Ler um pedido do agente numa conversa do OxeChat
- Aprovar, permitir neste turno, permitir na sessão ou recusar
- Salvar uma regra para não ser perguntado de novo
- Aprovar sozinho os comandos que só leem o projeto
- Ocultar um pedido para ler a conversa

## Como fazer

### Ler um pedido do agente numa conversa do OxeChat

Quando o agente precisa da sua permissão, a conversa mostra um cartão de pedido acima da caixa de mensagem, e o
OxeChat no seletor de modos ganha um contador.

1. Leia a primeira linha: ela diz o que o agente quer fazer, por exemplo **Revise o comando antes de permitir que ele
   rode.**
2. Confira o **Comando** (ou a ferramenta, o plano, ou as **Alterações de arquivos** propostas).
3. Leia o **Motivo do agente**. É o que o agente diz; o OXESpace não verificou.
4. Para ler mais à vontade, clique em **Expandir**. Para voltar o espaço à conversa, clique em **Reduzir**.

### Aprovar, permitir neste turno, permitir na sessão ou recusar

1. Escolha uma das respostas do cartão:
   - **Aprovar**: só este pedido.
   - **Permitir neste turno**: os pedidos iguais até o agente terminar o turno.
   - **Permitir na sessão**: os pedidos iguais nesta sessão do agente.
   - **Recusar**: o agente recebe a recusa e segue sem fazer.
2. O cartão some e a conversa continua. Se houver outro pedido, ele aparece em seguida.

As respostas que o provedor não oferece para aquele pedido não aparecem.

### Salvar uma regra para não ser perguntado de novo

1. No cartão, escolha **Sempre permitir …** (o texto diz o que a regra cobre).
2. A regra fica salva para este projeto.
3. Para ver ou apagar as regras, abra **Permissões** na conversa (`Ctrl+Shift+M`).

### Aprovar sozinho os comandos que só leem o projeto

1. Abra **Permissões** (`Ctrl+Shift+M`).
2. Ligue **Aprovar comandos somente leitura automaticamente**.

Comandos como `ls`, `cat`, `grep`, `git status` e `git diff` passam sem perguntar quando só leem arquivos dentro do
projeto. Um comando que lê fora do projeto, grava um arquivo, executa outro programa ou usa a rede continua
perguntando.

### Ocultar um pedido para ler a conversa

1. Clique em **Ocultar**. O pedido continua esperando, e o aviso no topo diz que **O agente está esperando a sua
   resposta**.
2. Clique em **Mostrar** para voltar ao pedido.

## O que o OXESpace garante

- Uma regra de permitir só aprova quando cobre **todos** os comandos de uma linha, ou todos os arquivos; o resto
  continua perguntando a você.
- Comandos que mexem em arquivos protegidos do OXESpace, ou que trocam, desfazem ou apagam o que está no Git
  (`checkout`, `reset`, `clean`, `rebase`…), **nunca** são aprovados por uma regra: sempre perguntam.
- Uma ferramenta MCP negada sai das ferramentas do agente quando a próxima sessão começa.
- Um pedido do app que ninguém responde é negado quando expira (5 minutos); nada espera para sempre.

## Se algo der errado

- **"O provedor está esperando uma resposta, mas o pedido não está disponível."** O agente parou num pedido que a
  conversa não conseguiu mostrar. Atualize o pedido ou pare o turno com o botão de parar e peça de novo.
- **"Não foi possível carregar as regras de permissão"** ou **"A alteração não foi salva"**: feche e abra
  **Permissões** de novo. Se continuar, relate em **Ajuda › Diagnóstico**.
- **"Bloqueada pelas permissões"** numa conversa: o acesso dela não deixa a ação acontecer. Revise o acesso da conversa
  e as regras salvas; o OXESpace não amplia o acesso sozinho.

## No celular

Ainda nada muda no celular. Responder a pedidos pelo celular chega com o app Android (veja
[Acompanhar e responder pelo celular](04-celular.md)).

## Limites conhecidos

- O modal de aprovação do app, com o risco em palavras (Baixo, Médio, Alto, Crítico) e o histórico das decisões,
  chega com o F18 nesta versão; esta página é atualizada quando ele entrar.

<!-- Capturas: `docs/guide/assets/S1/<nome>.pt-BR.<claro|escuro>.png`. -->
