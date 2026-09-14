# ROADMAP.md — CAV CRM

Base: fases declaradas em `AGENTS.md` (1 a 11), cruzadas com os comentários
de fase encontrados diretamente no schema (`packages/db/schema.ts`) e com o
estado de código verificado nesta auditoria. Este documento organiza o que
já existe vs. o que falta — não introduz prioridades novas que não estejam
já implícitas nessas duas fontes.

## Fases conforme `AGENTS.md`

| Fase | Descrição (tracker) | Status verificado |
|---|---|---|
| 0 | Monorepo, tenant middleware, testes de isolamento | Feito e testado |
| 1 | Login JWT, RBAC, seed demo | Código pronto e testado no Sistema B; não está no ar (ver [SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md)) |
| 2 | Catálogo (procedimentos, profissionais, salas, insumos) | Schema completo (`profissionais`, `salas`, `procedimentos`, `procedimento_profissionais`, `procedimento_recursos`, `insumos`, `ficha_tecnica_itens`). Sem rota HTTP, sem lógica de aplicação além do schema |
| 3 | Agenda | Schema completo (`agendamentos`, com bloqueio de preparo/limpeza). Motor de regras pronto em `lib/agenda.ts` (3 regras anti-conflito). Sem rota HTTP |
| 4 | Atendimento | Schema completo (`atendimentos`, `movimentacoes_estoque`, `pagamentos`). Motor de efeitos contábeis pronto em `lib/contabil.ts` (5 efeitos fixos por status). Sem rota HTTP |
| 5 | CRM (clientes, leads) | Schema completo (`clientes` com dedup por telefone e campos LGPD, `tags`, `cliente_tags`, `motivos_perda`, `leads`). Sem rota HTTP além do que toca `auth` |
| 6 | Conversas | Schema completo (`conversas`, `mensagens`). Sem integração de canal (WhatsApp/Meta Cloud API) implementada |
| 7 | IA | Schema completo (`ia_acoes_log`). Motor determinístico pronto em `lib/agente.ts` (regra "nunca inventar dado", escalação por regex). Sem rota HTTP, sem integração de canal real |
| 8 | Jobs / reativação | Schema completo (`reativacoes_log`, `jobs_execucoes`, `organizacoes.reativacao_dias`). Nenhum job agendado real encontrado implementado |
| 9 | Painel (frontend) | `packages/web` é placeholder ("Fase 0: Fundação iniciada" em `App.tsx`), sem consumo real da API |
| 10 | Demo | Não avaliado nesta auditoria — nenhum artefato de demo encontrado |
| 11 | UI | Não avaliado nesta auditoria além do placeholder de `packages/web` |

## Leitura desta tabela

O padrão que se repete da Fase 2 à 8 é sempre o mesmo: **schema de dados
completo, lógica de negócio pronta em biblioteca quando existe (agenda,
contábil, IA), zero rota HTTP exposta**. Isso não é "fases não começadas" no
sentido de "nada foi feito" — é "o desenho de dados e as regras mais
complexas já foram pensadas e implementadas, falta a camada de exposição
HTTP e, em alguns casos, a integração externa (canal de mensageria)".

## Decisão que bloqueia o avanço eficiente das próximas fases

Antes de escrever qualquer rota nova para as Fases 2-8, existe uma decisão
não tomada que afeta todas elas igualmente: qual sistema de servidor vai
hospedar essas rotas — o Sistema A (simples, no ar, sem tenant/RBAC) ou o
Sistema B (completo, testado, parado)? Ver
[adr/0002-tres-sistemas-servidor-decisao-pendente.md](./adr/0002-tres-sistemas-servidor-decisao-pendente.md).
Escrever rotas novas em cima do Sistema A hoje significa replicar
manualmente isolamento de tenant e RBAC que já existem prontos no Sistema B
— risco de inconsistência e retrabalho.

## Sugestão de sequência (não uma decisão tomada, uma sugestão desta auditoria)

1. Resolver a decisão de arquitetura (ADR 0002) — sem isso, qualquer rota
   nova corre risco de nascer no sistema errado.
2. Se Sistema B for escolhido: criar `server.ts` chamando
   `criarHandler(rotasAuth, sqlite)`, substituindo `index.ts` como entrypoint
   de `dev`/`build`.
3. Expor Fase 2 (catálogo) e Fase 3 (agenda) via rotas no padrão de
   `routes/auth.ts` — a lógica de `lib/agenda.ts` já está pronta, é
   majoritariamente trabalho de wrapper HTTP + validação de entrada.
4. Expor Fase 4 (atendimento/contábil) da mesma forma.
5. Só então investir em Fase 5-7 (CRM/conversas/IA), que dependem de decisão
   de canal de mensageria (WhatsApp/Meta Cloud API) ainda não tomada
   (`.ai-bootstrap/DECISIONS.md` lista isso como decisão adiada).
