# Status real por fase (verificado em código, não em intenção)

Fonte de verdade: `AGENTS.md` (tracker do projeto) cruzado com leitura direta do
código em 2026-09-13. Convenção de rigor: só marcar "implementado" o que tem
código funcionando, e só marcar "testado" o que tem teste que realmente exercita
o caminho.

## Fase 0 — Fundação: implementado e testado

Monorepo Bun, `packages/api/src/middleware/tenant.ts` (isolamento multi-tenant
via JWT) e `tenant.test.ts` (10 vetores de ataque cobertos, incluindo path
traversal literal/encoded/duplo-encoded/backslash). Essa é a parte mais sólida
do projeto hoje.

## Fase 1 — Login JWT, RBAC, seed demo: mais avançada do que o tracker sugere, mas não ligada

`AGENTS.md` registra "WIP — Hono body parsing". A causa raiz real é mais
específica do que "Hono quebrado": existe um roteador HTTP próprio, completo
e testado (`router.ts` + `http.ts` + `config.ts` + `middleware/permissoes.ts`
+ `middleware/tenant.ts` + `routes/auth.ts`), com login, resolução de sessão,
isolamento de tenant e checagem de permissão já implementados — mas **nenhum
arquivo do projeto chama `criarHandler()` para efetivamente subir esse
roteador**. Quem roda com `bun run dev` recebe `src/index.ts`, um `Bun.serve`
cru e paralelo, sem nenhuma dessas proteções. Hono só aparece em
`middleware/rbac.ts`, que está quebrado e não é usado por nenhum dos outros
dois sistemas. Ver detalhe completo em [[bugs-e-inconsistencias]].

## Fases 2 a 11 — não iniciadas como API exposta, mas com bases prontas

Sem rota HTTP real para: CRUD de agenda/clientes/procedimentos, RBAC aplicado
de fato, frontend além do placeholder, integração WhatsApp/Meta Cloud API,
jobs agendados, LGPD/exportação, relatórios. As peças de lógica de negócio
mais avançadas (agenda, contábil, agente IA — ver [[regras-negocio-core]]) já
têm implementação de biblioteca pronta em `packages/api/src/lib/`, chamáveis
diretamente, mas sem nenhuma rota do roteador próprio (`routes/`) que as
exponha ainda — só `routes/auth.ts` (login) existe hoje.

## Achado transversal importante

A lógica de negócio mais sofisticada do projeto (regras anti-conflito de
agenda, efeitos contábeis fixos por status, agente de IA determinístico, e o
próprio roteador com isolamento de tenant) já está escrita e testada — mas
nada disso está no ar. O maior ganho de uma próxima sessão de código não é
"escrever mais lógica", é "ligar o que já existe": criar um bootstrap de
servidor que use `criarHandler(rotasAuth, sqlite)` no lugar de `index.ts`.
