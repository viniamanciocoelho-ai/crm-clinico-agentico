# CAV CRM

SaaS CRM com agente de IA para clínicas odontológicas, consultórios médicos e SPAs.

## Desenvolvimento

```bash
bun install
bun run dev
```

## Estrutura

- `packages/db` — Schema Drizzle, migrações
- `packages/api` — Servidor Hono
- `packages/web` — Frontend React 19 + Vite
- `packages/shared` — Types, constants

## Variáveis de ambiente

Copie `.env.example` para `.env.local` (dev) e `.env.prod` (produção).
