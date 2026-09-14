# CAV CRM — Arquitetura e Comandos Compartilhados

## Objetivo
SaaS CRM com agente de IA para clínicas odontológicas, consultórios médicos e SPAs. Stack: Bun monorepo, roteador HTTP nativo, React 19, Drizzle e SQLite.

## Comandos reais
- **Dev**: `bun run --cwd packages/api dev` (API porta 3001)
- **Test**: `bun test ./packages`
- **Build**: `bun run build`
- **Seed**: `bun packages/db/seed.ts`
- **Migrate**: `bun packages/db/migrate.ts`

## Regras obrigatórias
1. Ler sempre antes de editar
2. Nunca hardcode `organizacao_id` — vem de JWT autenticado apenas
3. Validar isolamento de tenant em toda query/mutation
4. Sem segredos em `.env` ou commits
5. Sem merge, deploy ou alteração de produção sem pedido explícito
6. Testes verdes antes de prosseguir fase
7. YAGNI — sem abstrações prematuras
8. Alterações mínimas e reversíveis

## Estado atual
- API: rotas de autenticação, catálogo, agenda, atendimento, CRM, conversas, agente, painel e demo estão registradas em `src/index.ts`.
- Segurança: tenant vem exclusivamente do JWT; permissões são verificadas no roteador.
- Não executar migrations remotas, deploy, merge ou force push sem solicitação explícita.
