# ADR 0001 — Isolamento de tenant exclusivamente via JWT verificado

**Status**: Aceito e implementado (não uma decisão desta auditoria — decisão
já tomada e implementada no código antes desta sessão; documentada aqui
porque não existia ADR formal para ela).

## Contexto

CAV CRM é multi-tenant: uma instância atende múltiplas organizações
(clínicas/consultórios/SPAs), particionadas por `organizacao_id` em todas as
tabelas de negócio. Um erro de isolamento de tenant nesse desenho permite que
dados de uma organização vazem para outra — a classe de bug mais grave
possível para um SaaS deste tipo.

## Decisão

`organizacao_id` só pode ser resolvido a partir do JWT verificado da sessão
(`middleware/tenant.ts`, `resolveContext`). Nenhum outro vetor de entrada —
query string, header customizado, corpo da requisição, segmento de path — é
aceito como fonte de tenant, mesmo que o valor pareça coincidir com o do JWT.
A única exceção documentada é `POST /auth/login`, que aceita
`organizacao_id` no corpo porque ainda não existe sessão a resolver.

Como reforço adicional, a defesa contra path traversal opera sobre a string
bruta da URL, antes de `new URL()` normalizá-la — porque a normalização do
`URL` nativo colapsa `../` silenciosamente, o que apagaria evidência de uma
tentativa de traversal antes que uma checagem pós-parsing pudesse detectá-la.

## Consequências

Positivas: superfície de ataque de vazamento entre tenants reduzida a "o JWT
foi verificado corretamente" — um único ponto de verdade, testável de forma
concentrada (`tenant.test.ts`, 17 casos, incluindo 8 variantes de path
traversal). Qualquer rota nova que use `resolveContext` corretamente herda
essa proteção automaticamente.

Negativas / trade-off: exige que toda rota nova, em qualquer sistema de
servidor, efetivamente chame `resolveContext` — não há enforcement
automático a nível de framework que impeça alguém de escrever uma rota que
ignore essa função (como de fato aconteceu no Sistema A, `src/index.ts`, que
não usa `resolveContext` em nenhuma rota). Esse é o motivo pelo qual o
Sistema A é classificado como de alto risco em
[SECURITY-AND-PERMISSIONS.md](../SECURITY-AND-PERMISSIONS.md) — não porque a
regra em si seja fraca, mas porque nada obriga seu uso fora do roteador que
a implementa (Sistema B).

## Referências

[isolamento-multi-tenant.md](../../../.ai/memory/topics/isolamento-multi-tenant.md),
[SECURITY-AND-PERMISSIONS.md](../SECURITY-AND-PERMISSIONS.md).
