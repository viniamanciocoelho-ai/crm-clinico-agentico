# CAV CRM — Arquitetura e Comandos Compartilhados

## Objetivo
SaaS CRM com agente de IA para clínicas odontológicas, consultórios médicos e SPAs. Stack: Bun monorepo, Hono, React 19, Drizzle, SQLite/Turso.

## Comandos reais
- **Dev**: `bun packages/api/src/index.ts` (API porta 3001)
- **Test**: `bun test packages/**/*.test.ts`
- **Build**: `bun build packages/api/src/index.ts`
- **Seed**: `bun packages/db/seed.ts`
- **Migrate**: `bun packages/db/migrate.ts`

## Regras obrigatórias
1. Ler sempre antes de editar
2. Nunca hardcode `organizacao_id` — vem de JWT autenticado apenas
3. Validar isolamento de tenant em toda query/mutation
4. Sem segredos em `.env` ou commits
5. Sem push, merge, deploy ou alteração de produção
6. Testes verdes antes de prosseguir fase
7. YAGNI — sem abstrações prematuras
8. Alterações mínimas e reversíveis

## Fases (1-11)
- **0**: ✅ Monorepo, tenant middleware, testes isolamento
- **1**: ⏳ Login JWT, RBAC, seed demo (WIP — Hono body parsing)
- **2-11**: Catálogo, agenda, atendimento, CRM, conversas, IA, jobs, painel, demo, UI
