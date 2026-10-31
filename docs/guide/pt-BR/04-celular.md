# Acompanhar e responder pelo celular

> Parear o celular pela Wi-Fi, acompanhar os agentes e responder pedidos com segurança, sem nuvem.

<!-- Sobre esta página: Fatia S4 · Quem preenche: MOBILE · Itens: B9, M1, M5–M9, B9.2 · parcial: escrita a partir das telas do app Android e de Configurações › Dispositivos que estão na main em 31/10. O gateway do computador (#180) e a cadeia do app (#222 → #236) ainda não entraram; até lá, Configurações › Dispositivos diz que a conexão com o celular não está disponível nesta versão. Conferir cada passo no app real quando entrarem. -->

Também em: [en](../en/04-phone.md)

## O que você consegue fazer

- Ligar a conexão com o celular no computador
- Parear o celular pelo código
- Ver se o celular está conectado
- Responder a um pedido pelo celular
- Remover um celular pareado

## Como fazer

### Ligar a conexão com o celular no computador

1. No computador, abra **Configurações › Dispositivos**.
2. Em **Conexão com o celular**, ligue **Permitir que celulares desta rede se conectem**.
3. Leia **Antes de os celulares se conectarem** e clique em **Ligar**.
4. No Windows, o sistema pergunta se o OXESpace pode aceitar conexões: permita em **redes privadas** (o Wi-Fi de casa ou
   do escritório). Redes públicas podem ficar desmarcadas.
5. A seção passa a dizer **Escutando em …, porta …**.

Desligada, a conexão não abre nenhuma porta.

### Parear o celular pelo código

1. No computador, em **Parear um celular**, clique em **Mostrar código de pareamento**. O código vale uma vez e dura
   dois minutos.
2. No celular, abra o OXESpace e toque em **Parear com o computador**.
3. Toque em **Permitir câmera** se o celular pedir. A câmera só lê o código; nada do que ela vê sai do celular.
4. Aponte a câmera para o código na tela do computador.
5. O celular mostra **Confirme no computador** e um código de verificação.
6. No computador, a pergunta **Parear …?** mostra o mesmo código. Se for igual ao do celular, clique em **Parear**;
   se não for, clique em **Recusar**.
7. O celular mostra **Pareado**. Toque em **Concluir**.

Se o computador mudar de endereço na rede, use **Informar o endereço do computador** no menu do celular e digite o
endereço que aparece em **Configurações › Dispositivos** (por exemplo `192.168.0.12`).

### Ver se o celular está conectado

- No celular, a tela inicial diz **Conectado a …** (ou **Conectando a …**).
- No computador, **Celulares pareados** mostra cada aparelho como **Conectado** ou **Desconectado**, com a data em que
  foi visto por último.

### Responder a um pedido pelo celular

1. Quando um agente precisa de você, o celular avisa: **Precisa de você: …**. Toque no aviso para abrir o pedido, ou
   abra a aba **Pedidos** e toque nele.
2. Leia o pedido: o que o agente quer fazer, o **Comando**, a **Pasta**, os **Arquivos que ele alteraria** e o risco
   (**Só lê**, **Altera algo** ou **Apaga, eleva acesso ou publica**). O que está em **Escrito pelo agente** é a
   explicação do próprio agente, não do OXESpace.
3. Para negar, escreva, se quiser, um **Motivo, dito ao agente (opcional)** e toque em **Negar**.
4. Para permitir, toque em **Permitir uma vez**.
5. Confirme que é você com a digital, o rosto ou o bloqueio de tela do celular.
6. O celular mostra **Respondido.**

Num pedido que altera, apaga ou publica algo, **Negar** é o primeiro botão; **Permitir uma vez** fica abaixo dele.
Se o agente fez uma pergunta, escolha as opções e toque em **Enviar respostas**. Um pedido que só o computador pode
responder mostra **Responda no computador** no topo e não tem botões.

Dentro de uma conversa, um pedido esperando mostra **Precisa de você** e **Responder**, que abre o mesmo pedido.

### Remover um celular pareado

1. No computador, em **Celulares pareados**, clique em **Remover** ao lado do aparelho.
2. Confirme. O celular é desconectado na hora e não consegue mais se conectar; para usá-lo de novo, pareie outra vez.

## O que o OXESpace garante

- A conexão com o celular vem **desligada**; desligada, nenhuma porta fica aberta.
- Ligada, o OXESpace escuta só em endereços de rede privada, numa conexão criptografada que só celulares pareados podem
  usar. Nada fica exposto à internet.
- O celular confere a impressão digital do certificado do computador antes de confiar na conexão; outro aparelho no
  mesmo endereço é recusado.
- Um código de pareamento vale uma vez e expira em 2 minutos; no máximo 5 celulares por computador.
- O nome de rede do seu computador nunca é enviado: o celular vê o nome que você escolhe em **Nome deste computador**.
- Nenhuma resposta sai do celular sem a sua confirmação (digital, rosto ou bloqueio de tela); se você cancelar, nada é
  enviado.
- O celular só oferece as respostas que o computador ofereceu, e nunca "permitir sempre nesta sessão".

## Se algo der errado

- **"O código expirou."** Mostre um novo no computador e leia em até 2 minutos.
- **"Esse código já foi usado."** Mostre um novo código.
- **"Outro aparelho respondeu nesse endereço, não o seu computador. Nada foi enviado."** Você pode estar em outra
  Wi-Fi. Confira a rede e pareie de novo.
- **"Esse código aponta para fora da sua rede local."** O OXESpace só pareia na mesma Wi-Fi.
- **"Tentativas de pareamento demais."** Espere 2 minutos e tente de novo.
- **"Seu computador já tem 5 aparelhos pareados."** Remova um em **Configurações › Dispositivos**.
- **"O acesso à câmera está desligado para o OXESpace."** Toque em **Abrir configurações** e ligue a câmera.
- **"Não foi possível falar com o computador."** Confira se ele está ligado, na mesma Wi-Fi, e com a conexão com o
  celular ligada.
- **"Não enviado: a confirmação neste celular foi cancelada."** Toque de novo em **Negar** ou **Permitir uma vez** e
  confirme que é você.
- **"Ele já foi respondido ou não espera mais."** Alguém já respondeu, no computador ou em outro celular. Nada a fazer.
- **"A conversa seguiu em frente; este pedido não vale mais."** O agente já está em outro passo; veja a conversa.
- **"Só o seu computador pode responder este."** Responda no computador.
- **"Ações demais em um minuto. Tente de novo daqui a pouco."** Espere um pouco e tente de novo.
- **"… removeu este celular."** O aparelho foi removido no computador. Pareie de novo.
- **"… usa outra versão do OXESpace."** Atualize o app ou o OXESpace no computador.

## No celular

Esta página é sobre o celular.

## Limites conhecidos

- Só Android nesta versão.
- O celular e o computador precisam estar na mesma rede local; não há acesso pela internet.
- O que é só do computador (pedidos protegidos, permissões, perguntas com segredo) não pode ser respondido pelo celular:
  ele diz para responder no computador.

<!-- Capturas: `docs/guide/assets/S4/<nome>.pt-BR.<claro|escuro>.png`, dos goldens do Paparazzi e do e2e do pareamento. -->
