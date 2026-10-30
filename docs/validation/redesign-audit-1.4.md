# Auditoria de redesign 1.4

Pedido do usuário, pela visão de produto: quais páginas, modais, feedbacks, modais de permissão e itens de menu
precisam de redesign. A auditoria roda sobre a `main` atual, num perfil de teste (banco temporário, mocks de e2e),
em pt-BR e en, claro e escuro. O app é testado de fora, como uma pessoa exigente que não conhece o código.

Cada achado traz:
- a tela ou o componente;
- a gravidade: **bloqueia** (impede o uso ou engana a pessoa), **atrapalha** (confunde, dá trabalho ou fica
  inconsistente) ou **cosmético**;
- a evidência: o print em `e2e/screenshots/homologation/<pasta>/` ou os passos;
- um critério de aceite sugerido.

As funcionalidades avançadas que faltam ficam numa seção à parte, como propostas de roadmap, e não como defeitos.

Fases:
1. Modais de permissão (prioridade).
2. Menus, paleta e feedbacks.
3. Páginas e modais por modo.

Roteiros: `e2e/homologation/audit-*.spec.ts`, no PR de homologação (#184).

## Fase 1 · Modais de permissão

_Em andamento. O roteiro `audit-permissions.spec.ts` age como um agente: chama o MCP interno com a porta e o token que o
app entrega aos agentes e registra o diálogo nativo que a pessoa veria, inclusive com pedidos adversariais._

## Fase 2 · Menus, paleta e feedbacks

| # | Tela / componente | Gravidade | Problema | Evidência | Critério de aceite |
|---|---|---|---|---|---|
| P2-1 | Paleta de comandos (rótulos) | atrapalha | Os rótulos misturam três estilos: "Categoria: ação" ("Activity: Mark all as read", "Design System: Open Viewer"), verbo ("Open activity center", "Restart terminal", "Toggle sidebar") e substantivo solto ("Linear issues", "Usage & limits", "Provider accounts"). Quem procura não sabe se digita a área ou a ação, e a lista fica sem ritmo. | Inventário de `src/commands/*.ts` na `main` f7f54346 (23 comandos estáticos; a lista completa, com 85, sai da passada com o app aberto) | Todo comando da paleta segue "Categoria: ação no infinitivo" (por exemplo, "Atividade: marcar tudo como lido" e "Terminal: reiniciar"), em en e pt-BR. Um teste de catálogo falha com um rótulo fora do padrão. |

## Fase 3 · Páginas e modais por modo

_A seguir._

## Propostas de roadmap (funcionalidades avançadas que faltam)

_A seguir._
