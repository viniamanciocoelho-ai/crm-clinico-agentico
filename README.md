# CAV CRM

CRM clínico multi-tenant com API Bun, roteador HTTP próprio, SQLite e frontend React 19.

## Desenvolvimento

```bash
bun install
bun run --cwd packages/api dev
```

## Validação

```bash
bun test ./packages
bun run typecheck
bun run build
```

## Estrutura

- `packages/db` — schema Drizzle e DDL SQLite local.
- `packages/api` — API Bun com autenticação JWT, RBAC e isolamento por `organizacao_id`.
- `packages/web` — frontend React 19 + Vite.
- `packages/shared` — tipos, permissões e erros compartilhados.

## Ambiente

Use `.env.example` como referência. Em produção, `JWT_SECRET` e `PASSWORD_SALT` são obrigatórios.
