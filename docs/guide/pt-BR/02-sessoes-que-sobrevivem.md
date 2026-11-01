# Fechar e voltar sem perder os agentes

> Fechar ou travar o OXESpace nunca perde os agentes nem o trabalho: cada painel volta à sua sessão ou diz por que não voltou.

<!-- Sobre esta página: Fatia S2 · Quem preenche: BACKEND (B17) + FRONTEND (F32) · Itens: B17, F32, F19, B2 · parcial: escrita a partir do que está na main em 31/10 (proteção ao fechar, ferramentas Interrompidas, Retomar sessões dos agentes, hooks de status, divisão recusada). "Sessão retomada" / "Sessão não retomada" e começar um painel do zero entram com o B17 (#309) e o F32 (#311). -->

Também em: [en](../en/02-sessions-that-survive.md)

## O que você consegue fazer

- Fechar o OXESpace com alterações não salvas
- Decidir o que fazer com uma ferramenta Interrompida
- Fazer os painéis dos agentes voltarem à sessão depois de reiniciar
- Ligar os hooks de status
- O que "Sessão retomada" e "Sessão não retomada" querem dizer
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

### Decidir o que fazer com uma ferramenta Interrompida

Se o OxeChat estava rodando uma ferramenta quando o app fechou ou travou, a conversa mostra essa ferramenta como
**Interrompida** quando você volta. Ela pode ou não ter surtido efeito, e nada é executado de novo sozinho.

1. Abra a conversa e encontre a ferramenta marcada **Interrompida**.
2. Escolha:
   - **Continuar**: o agente é orientado a verificar o que aconteceu antes de seguir. A conversa diz **Continuada: o
     agente foi orientado a verificar o que aconteceu primeiro.**
   - **Dispensar**: a ferramenta fica como está e nada roda de novo. A conversa diz **Dispensada. Nada foi executado
     de novo.**

### Fazer os painéis dos agentes voltarem à sessão depois de reiniciar

1. Abra **Configurações › Terminal**.
2. Ligue **Retomar sessões dos agentes**.

Com isso ligado, quando o OXESpace reinicia, os painéis do Claude Code e do Codex reabrem a sessão em que estavam.

### Ligar os hooks de status

Com os hooks, o Claude Code e o Codex informam por conta própria se estão trabalhando, aguardando ou prontos, em vez de
o OXESpace adivinhar pela saída do terminal.

1. Abra **Configurações › Notificações**.
2. Em **Hooks de status dos agentes**, ligue **Informar o status do Claude Code por hooks** (e o mesmo para o Codex).
3. A linha passa a dizer **Instalado.**

O OXESpace grava na configuração do próprio agente e mantém os hooks que você já tem. Para tirar, desligue a mesma
chave.

### O que "Sessão retomada" e "Sessão não retomada" querem dizer

<!-- A PREENCHER quando o F32 (#311) entrar: o aviso do painel e o que cada motivo de "não retomada" pede. Copiar os
textos de shared/locales, não do PR. -->

1. …

### Começar um painel do zero

<!-- A PREENCHER quando o B17 (#309) / F32 (#311) entrarem: a ação que abre uma sessão nova no lugar da retomada. -->

1. …

### Dividir painéis sem apertar demais

Um layout tem um número fixo de lugares. Quando todos estão ocupados, dividir não aperta os painéis: o OXESpace avisa.

1. Divida um painel (**Dividir o painel à direita** ou **Dividir o painel para baixo**).
2. Se aparecer **Não dá para dividir este painel aqui**, escolha um layout maior, ou ligue o layout dividido para
   adicionar painéis livremente.

## O que o OXESpace garante

- Fechar com alterações não salvas sempre pergunta antes; se alguma não puder ser salva, nada é fechado.
- Desligar o computador e instalar uma atualização do app não esperam pela pergunta.
- Uma ferramenta que rodava quando o app fechou nunca é executada de novo sozinha: você escolhe **Continuar** ou
  **Dispensar**.
- O comando de retomada é montado pelo OXESpace, nunca digitado no seu shell.
<!-- Entra com o B17 (#309): "Uma sessão apagada do disco não é retomada: o painel diz isso e começa uma nova." -->

## Se algo der errado

- **"1 alteração não pôde ser salva, então nada foi fechado."** O OXESpace não fechou nada. Abra o arquivo ou a
  requisição que ele cita, leia o motivo (por exemplo, sem permissão na pasta), salve de novo e feche de novo.
- **"Não foi possível atualizar: …"** nos hooks de status: o OXESpace não conseguiu gravar na configuração do agente.
  Leia o motivo, corrija (por exemplo, a permissão do arquivo) e ligue a chave de novo.
- **"Instalado em parte (faltando: …)"**: desligue e ligue a chave de novo para instalar o que falta.
- **"Não instalado — usando a heurística da saída."**: os hooks estão desligados; o status vem da leitura do terminal.

<!-- A PREENCHER com o F32 (#311): os motivos de "Sessão não retomada" e o que fazer em cada um. -->

## No celular

Nada muda no celular.

## Limites conhecidos

- A retomada vale para painéis do Claude Code e do Codex; outros agentes e shells comuns começam uma sessão nova.
- No Windows, um painel do Claude Code cujo shell foi aberto por um caminho curto com `~1` (por exemplo
  `C:\Users\RUNNER~1\…`) pode não achar a sessão salva quando o projeto foi adicionado pelo caminho completo. O painel
  avisa que a sessão não foi retomada e começa do zero; a conversa salva continua no disco.

<!-- Capturas: `docs/guide/assets/S2/<nome>.pt-BR.<claro|escuro>.png`. -->
