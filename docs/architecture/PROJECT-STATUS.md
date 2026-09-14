# PROJECT-STATUS.md — CAV CRM

Auditoria autônoma (Claude Cowork), 2026-09-13. Metodologia: toda afirmação
abaixo vem de leitura direta de código-fonte, não do tracker do projeto nem de
relatórios anteriores. Convenção de rigor: "implementado" = código existe e
roda no fluxo real; "testado" = existe teste que exercita esse caminho
especificamente; "planejado" = existe intenção documentada mas sem código.

## Achado principal: três sistemas de servidor paralelos

O fato arquitetural mais importante deste projeto hoje não é uma feature em
falta — é que existem três implementações de servidor HTTP em
`packages/api/src`, e a mais madura não está no ar. Ver detalhe completo em
[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md) e em
[bugs-e-inconsistencias.md](../../.ai/memory/topics/bugs-e-inconsistencias.md).

Resumo: `bun run dev` sobe `src/index.ts` (Sistema A), um `Bun.serve` cru sem
tenant e sem RBAC. Em paralelo existe um roteador próprio completo e testado
(Sistema B: `router.ts` + `http.ts` + `config.ts` + `middleware/permissoes.ts`
+ `middleware/tenant.ts` + `routes/auth.ts`) com isolamento multi-tenant e
checagem de permissão prontos — mas nenhum arquivo chama `criarHandler()`,
então esse sistema nunca é instanciado. Um terceiro arquivo
(`middleware/rbac.ts`, Sistema C) usa Hono e está quebrado (chama
`getSession()`, que não existe em `tenant.ts`).

## Status por fase (cruzado com `AGENTS.md`)

| Fase | Tracker (`AGENTS.md`) | Realidade verificada |
|---|---|---|
| 0 — Fundação | ✅ | Confirmado. Monorepo Bun, isolamento de tenant (`tenant.ts`) implementado e testado (10 vetores de ataque em `tenant.test.ts`). Parte mais sólida do projeto. |
| 1 — Login/JWT/RBAC/seed | ⏳ "WIP — Hono body parsing" | Mais avançada do que o tracker sugere, mas não ligada. Login, hashing, JWT e permissões existem e passam em teste unitário — só não estão servidos por nenhum processo em execução. Causa raiz real não é "bug de parsing do Hono": é que o Hono foi abandonado (ver `.ai-bootstrap/DECISIONS.md`) e o roteador substituto nunca foi conectado. |
| 2–11 | Não marcadas | Sem rota HTTP real para agenda, clientes, procedimentos, RBAC aplicado, frontend além de placeholder, WhatsApp/Meta Cloud API, jobs, LGPD, relatórios. Lógica de negócio de agenda/contábil/agente de IA já implementada em `lib/`, mas sem rota que a exponha. |

## O que está genuinamente pronto hoje

- Schema de dados completo: 24 tabelas em `packages/db/schema.ts`, todas com
  `organizacao_id` para isolamento de tenant. Ver
  [DATA-MODEL.md](./DATA-MODEL.md).
- Isolamento multi-tenant via JWT: regra de que `organizacao_id` só pode vir
  do token verificado, nunca de query/header/body/path — implementada e
  testada contra 8 variantes de path traversal.
- Três motores de regra de negócio prontos em biblioteca (não expostos por
  rota): anti-conflito de agenda, efeitos contábeis fixos por status de
  atendimento, agente de WhatsApp determinístico. Ver
  [regras-negocio-core.md](../../.ai/memory/topics/regras-negocio-core.md).
- `node_modules` presente no disco — `bun install` já foi executado em algum
  momento anterior a esta auditoria (não nesta sessão, que não teve acesso a
  shell).

## O que está declarado mas não confirmado

- `AGENTS.md` e `README.md` descrevem a stack como usando Hono. Não é mais
  verdade para o sistema em execução — é uma inconsistência de documentação a
  corrigir, não corrigida aqui (fora de escopo).
- `.ai-bootstrap/CLAUDE_BOOTSTRAP_REPORT.md` (sessão anterior, mesmo dia)
  afirma RBAC testado. Não há arquivo de teste de RBAC no projeto — ver
  [bootstrap-anterior-claude-code.md](../../.ai/memory/topics/bootstrap-anterior-claude-code.md).
  Tratar essa e outras afirmações de "testado" em relatórios anteriores com
  cautela até verificação direta.

## Limitação de ferramenta nesta auditoria

Esta sessão (Claude Cowork) não teve acesso a shell (`bash`) durante toda a
execução — falha de montagem confirmada, não específica desta tarefa. Isso
significa: nenhum `bun test`, `bun install` ou `git` foi executado para
verificar este relatório; toda verificação veio de leitura estática de
código-fonte e arquivos de teste (lidos, não executados). Recomenda-se rodar
`bun test` assim que houver shell disponível para confirmar que os testes
citados aqui realmente passam.

## Próximo passo de maior valor

Não é escrever mais lógica de negócio — é decidir o que fazer com os três
sistemas de servidor (ver
[adr/0002-tres-sistemas-servidor-decisao-pendente.md](./adr/0002-tres-sistemas-servidor-decisao-pendente.md)).
Se a decisão for adotar o Sistema B, o trabalho é criar um `server.ts` que
chama `criarHandler(rotasAuth, sqlite)` e substitui `index.ts`.
