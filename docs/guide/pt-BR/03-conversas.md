# Organizar muitas conversas no OxeChat

> O OxeChat organiza muitas conversas e o trabalho dentro delas, e tudo continua no lugar depois de reiniciar.

<!-- Sobre esta página: Fatia S3 · Quem preenche: FRONTEND · Itens: F13, F15a, F14, F30, F17, B19, B20 (B1.3 conversas aninhadas e B1.4 coordenadora foram para a 1.4.1, corte de escopo do usuário) · parcial: escrita a partir do que está na main em 31/10 (seções e menu da conversa, F13; chat lateral, F15a). Painel da sessão (F14, #227), atividade (F30, #298) e arquivar quando o PR fecha entram quando forem para a main. -->

Também em: [en](../en/03-conversations.md)

## O que você consegue fazer

- Agrupar conversas em seções
- Usar o menu de uma conversa
- Chat lateral sobre uma conversa
- Painel da sessão: contexto, ferramentas e custo
- Atividade: o que aconteceu enquanto você estava fora
- Arquivar a conversa quando o PR dela fecha

## Como fazer

### Agrupar conversas em seções

As seções agrupam as conversas de um projeto sob um nome. O OXESpace guarda as seções, então elas continuam iguais
depois de reiniciar.

1. Na barra lateral do OxeChat, abra o menu **…** do projeto e escolha **Nova seção…**.
2. Digite o **Nome da seção** (até o limite que aparece abaixo do campo) e clique em **Criar seção**.
3. Para pôr uma conversa na seção, arraste a conversa até ela, ou abra o menu da conversa e use **Mover para seção**.
   Pelo mesmo submenu dá para criar uma seção nova já com a conversa dentro.
4. Para recolher ou abrir uma seção, clique no nome dela.
5. No menu **…** da seção você tem **Renomear seção…**, **Mover seção para cima**, **Mover seção para baixo** e
   **Excluir seção…**.

Excluir uma seção não exclui nenhuma conversa: as conversas dela voltam para **Sem seção**.

### Usar o menu de uma conversa

Clique com o botão direito numa conversa da lista, use o botão **…** dela, ou, com a conversa em foco, pressione
`Shift+F10` ou a tecla de menu. O menu tem:

- **Abrir ao lado**: abre a conversa lado a lado com a atual;
- **Renomear conversa…**;
- **Fixar conversa** / **Desafixar conversa**: as fixadas ficam em **Fixadas**, no topo da lista;
- **Mover para seção**;
- **Marcar como lida** / **Marcar como não lida**;
- **Arquivar conversa**: ela sai da lista e fica em **Arquivadas**, de onde dá para restaurá-la (ou com `/resume`);
- **Excluir conversa**: tira a conversa do OXESpace. A sessão do provedor e os arquivos do projeto são mantidos.

Arquivar ou excluir pede confirmação, e um turno em andamento é interrompido. Se a conversa tem uma worktree própria,
o OXESpace pergunta antes o que fazer com ela.

### Chat lateral sobre uma conversa

O chat lateral responde perguntas sobre a conversa sem mexer nela.

1. Com a conversa aberta, pressione `Ctrl+.` (`Cmd+.` no macOS), ou abra **Mais ações** no topo da conversa e escolha
   **Chat lateral**.
2. Uma gaveta abre ao lado com uma **Cópia somente leitura** da conversa. Escreva em **Pergunte sobre esta conversa…** e
   clique em **Perguntar**.
3. A gaveta mostra o **Custo até agora** das perguntas.
4. Para fechar, pressione `Ctrl+.` de novo ou use o botão de fechar da gaveta.

<!-- 1.4.1: "Conversas que um agente iniciou (aninhadas)" e "A coordenadora do projeto e a visão do projeto" (B1.3/B1.4, #287/#290) voltam com os PRs delas. -->

### Painel da sessão: contexto, ferramentas e custo

<!-- A PREENCHER quando o F14 (#227) entrar. -->

1. …

### Atividade: o que aconteceu enquanto você estava fora

<!-- A PREENCHER quando o F30 (#298) entrar: o sino, Ctrl+Shift+A, o que precisa de você, o que terminou e o que é
novo. -->

1. …

### Arquivar a conversa quando o PR dela fecha

<!-- A PREENCHER quando o item entrar na main. -->

1. …

## O que o OXESpace garante

- As seções são guardadas pelo OXESpace e continuam iguais depois de reiniciar.
- Excluir uma seção nunca exclui uma conversa.
- O chat lateral não envia nada à conversa principal, e a cópia é descartada quando você fecha.
- Excluir uma conversa mantém a sessão do provedor e os arquivos do projeto.
<!-- 1.4.1, com o B1.4: "A coordenadora do projeto nunca responde um pedido nem uma aprovação." -->

## Se algo der errado

- **"Já existe uma seção com este nome neste projeto."** Escolha outro nome.
- **"Use de 1 a … caracteres, sem quebras de linha nem caracteres de controle."** Encurte o nome ou tire as quebras de
  linha.
- **"Esta seção não existe mais."** Ela foi excluída em outro lugar; a lista se atualiza.
- **"Não foi possível atualizar as seções."** Tente de novo. Se continuar, relate em **Relatar um problema…** (o botão de menu ao lado do logo › **Ajuda**, ou a paleta de comandos).
- **"O chat lateral não abriu. Tente de novo."** Feche a gaveta e abra de novo com `Ctrl+.`.
- **"A pergunta não chegou ao chat lateral. Feche e abra de novo."** A cópia parou: feche e abra o chat lateral. A
  conversa principal não é afetada.

<!-- A PREENCHER com as fatias que faltam (#227, #298). -->

## No celular

Nada muda no celular.

## Limites conhecidos

- As seções valem por projeto; uma conversa fica em uma seção só.

<!-- Capturas: `docs/guide/assets/S3/<nome>.pt-BR.<claro|escuro>.png`. -->
