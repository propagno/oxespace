# Fechar e voltar sem perder os agentes

> Fechar ou travar o OXESpace nunca perde os agentes nem o trabalho: cada painel volta à sua sessão ou diz por que não voltou.

<!-- Sobre esta página: Fatia S2 · Quem preenche: BACKEND (B17) + FRONTEND (F32) · Itens: B17, F32, F19, B2 · rascunho (esqueleto) -->

Também em: [en](../en/02-sessions-that-survive.md)

## O que você consegue fazer

- Fechar o OXESpace com alterações não salvas
- O que "Sessão retomada" e "Sessão não retomada" querem dizer
- Ativar a retomada após um travamento (hooks de status)
- Começar um painel do zero
- Dividir painéis sem apertar demais

## Como fazer

### Fechar o OXESpace com alterações não salvas

Se um arquivo do editor do OxeCode ou uma requisição do OxePost tem alterações não salvas, fechar a janela ou sair do
app pergunta antes.

1. Leia a lista **Alterações não salvas**: cada item diz onde está (por exemplo **Editor do OxeCode · src** ou
   **Requisição do OxePost**).
2. Escolha:
   - **Salvar tudo e fechar** (ou **Salvar tudo e sair**): salva cada alteração e fecha;
   - **Fechar sem salvar** (ou **Sair sem salvar**): fecha e perde as alterações listadas;
   - **Cancelar**: volta ao trabalho sem fechar nada. É o botão com o foco quando a pergunta abre.

### O que "Sessão retomada" e "Sessão não retomada" querem dizer

<!-- A PREENCHER: Passos numerados, um por ação. Nomes de tela em negrito, como aparecem no app. -->

1. …

### Ativar a retomada após um travamento (hooks de status)

<!-- A PREENCHER: Passos numerados, um por ação. Nomes de tela em negrito, como aparecem no app. -->

1. …

### Começar um painel do zero

<!-- A PREENCHER: Passos numerados, um por ação. Nomes de tela em negrito, como aparecem no app. -->

1. …

### Dividir painéis sem apertar demais

<!-- A PREENCHER: Passos numerados, um por ação. Nomes de tela em negrito, como aparecem no app. -->

1. …

## O que o OXESpace garante

- Fechar com alterações não salvas sempre pergunta antes; se alguma não puder ser salva, nada é fechado.
- Desligar o computador e instalar uma atualização do app não esperam pela pergunta.
- O comando de retomada é montado pelo OXESpace, nunca digitado no seu shell.
- Uma sessão apagada do disco não é retomada: o painel avisa e abre uma nova.

## Se algo der errado

- **"1 alteração não pôde ser salva, então nada foi fechado."** O OXESpace não fechou nada. Abra o arquivo ou a requisição indicada, veja o motivo do erro (por exemplo, sem permissão na pasta), salve de novo e feche outra vez.

<!-- A PREENCHER: Cada mensagem que a pessoa pode ver (as mensagens C3 desta fatia) com o que fazer. -->

## No celular

Nada muda no celular.

## Limites conhecidos

<!-- A PREENCHER: O que ainda não funciona na 1.4, em uma linha cada. -->

<!-- Capturas: `docs/guide/assets/S2/<nome>.pt-BR.<claro|escuro>.png`. -->
