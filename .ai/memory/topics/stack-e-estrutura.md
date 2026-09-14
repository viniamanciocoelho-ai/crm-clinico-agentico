# Stack e estrutura do monorepo

Confirmado por leitura direta de código em 2026-09-13.

## Stack real

Bun workspaces (`package.json` raiz: `workspaces: ["packages/*"]`), TypeScript `^7`
estrito (`strict: true`, `noUncheckedIndexedAccess: true`). SQLite local via
`bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`). Turso citado no README e no
`.env.example` (`TURSO_CONNECTION_URL`) mas vazio — hoje roda 100% em SQLite de
arquivo (`dev.db`), sem Turso conectado.

## Pacotes

- `packages/db` — schema Drizzle (`schema.ts`, 409 linhas, 21 tabelas), `client.ts`
  (conexão), `seed.ts`, `migrate.ts`, `drizzle.config.ts`, `index.ts` (barrel).
- `packages/api` — três sistemas paralelos, ver [[bugs-e-inconsistencias]]:
  entrypoint real `src/index.ts` (Bun.serve cru, sem framework); roteador
  próprio maduro e testado (`router.ts`, `http.ts`, `config.ts`,
  `middleware/permissoes.ts`, `middleware/tenant.ts`, `routes/auth.ts`) nunca
  instanciado; e `middleware/rbac.ts`, único arquivo Hono do projeto, quebrado
  e não usado pelos outros dois. `hono: ^4.4.0` no `package.json` existe só
  por causa desse terceiro arquivo órfão. Lógica de negócio pronta em `lib/`
  (`agenda.ts`, `contabil.ts`, `agente.ts`, `auth.ts`, `org.ts`).
- `packages/web` — React 19 + Vite, hoje é só um placeholder ("Fase 0: Fundação
  iniciada" em `App.tsx`).
- `packages/shared` — tipos e constantes cross-package (`RoleType`, `SessionData`,
  `ROLE_PERMISSIONS`, `TenantViolationError`, `PermissionDeniedError`). Exportado
  como `@cav-crm/shared` via `workspaces:*`.

## Scripts declarados vs. reais (achado, não corrigido)

`packages/db/package.json` declara `migrate:dev: bun scripts/migrate-dev.ts` e
`seed: bun scripts/seed.ts`, mas os arquivos reais estão em
`packages/db/migrate.ts` e `packages/db/seed.ts` (sem a pasta `scripts/`). Esses
scripts do `package.json` provavelmente falham se executados como estão.

## Ambiente

`.env.example` declara `DATABASE_URL`, `TURSO_CONNECTION_URL` (vazio),
`API_PORT=3001`, `NODE_ENV`. Não declara `JWT_SECRET` nem `PASSWORD_SALT`, que o
código usa com fallback inseguro — ver [[bugs-e-inconsistencias]].

## Git

Nenhum diretório `.git` encontrado em nenhum nível de `cav-crm` (checagem
recursiva por `**/.git/HEAD`, sem resultado). Projeto não está sob controle de
versão ainda.
