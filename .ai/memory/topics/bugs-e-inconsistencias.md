# Bugs e inconsistências encontrados (documentados, não corrigidos)

Escopo desta auditoria foi documentação/arquitetura — nada abaixo foi corrigido
no código. Listado aqui para não ser redescoberto do zero na próxima sessão.

## 1. `rbac.ts` é Hono, mas é o único arquivo Hono do projeto — e está quebrado

`packages/api/src/middleware/rbac.ts` importa `Context`/`Next` de `"hono"` e
chama `getSession(c)` importado de `./tenant`. `tenant.ts` não exporta
`getSession` (exporta `resolveContext`, com assinatura totalmente diferente:
recebe `Request`/`URL` puros, não um `Context` do Hono). Busca por `import
... from "hono"` em todo `packages/api/src` confirma: `rbac.ts` é o ÚNICO
arquivo do projeto que importa Hono. A dependência `hono: ^4.4.0` no
`package.json` existe só por causa desse arquivo órfão — não há nenhum `new
Hono()` em lugar nenhum do projeto. `rbac.ts` não pode funcionar como está;
provável causa raiz do "WIP — Hono body parsing" citado em `AGENTS.md`.

## 2. Três implementações de JWT que não conversam entre si

`lib/auth.ts` usa `process.env.JWT_SECRET || "dev-secret"` (usada pelo router
real — ver achado 3). `src/index.ts` usa o literal `"dev-secret"` fixo, sem
ler env. `routes/auth.ts` reusa `lib/auth.ts` corretamente (não reimplementa),
mas como roda sob um router que nunca é iniciado (achado 3), seus tokens nunca
chegam a ser emitidos em produção. O único literal divergente hardcoded é o de
`index.ts`.

## 3. Existem TRÊS sistemas de servidor paralelos, e o mais completo nunca é ligado

Achado mais importante desta auditoria. Não é só "Hono não está montado" —
há um sistema de roteamento próprio, completo e testado, que está pronto mas
nunca é instanciado:

- **Sistema A — `index.ts` (o que roda de fato)**: `bun run --watch
  src/index.ts` é o script `dev` real. `Bun.serve` cru, rotas hardcoded
  (`/health`, `/auth/login`), sem tenant, sem RBAC, sem usar `lib/auth.ts`
  nem `router.ts`. É o único que efetivamente atende requisições hoje.
- **Sistema B — router próprio (`router.ts` + `http.ts` + `config.ts` +
  `middleware/permissoes.ts` + `middleware/tenant.ts` + `routes/auth.ts`)**:
  um roteador HTTP completo, escrito à mão (sem framework), com casamento de
  path por padrão (`:param`), tradução de erros de domínio em status HTTP
  (`respostaDeErro`: `TenantViolationError`→403, `PermissionDeniedError`→403,
  `ConflitoError`→409, `UnauthorizedError`→401), isolamento de tenant via
  `resolveContext` e checagem de permissão via `exigirPermissao`. `router.ts`
  exporta `criarHandler(rotas, sqlite)` que monta tudo isso — **mas não existe
  nenhum arquivo em todo o projeto que chame `criarHandler`**. Confirmado por
  busca textual: a única ocorrência de `criarHandler(` é a própria definição.
  Este é o sistema mais maduro (é o que `tenant.test.ts` exercita
  diretamente, chamando `resolveContext`), mas nunca é ligado a uma porta.
- **Sistema C — `rbac.ts` (Hono, quebrado)**: ver achado 1. Não se conecta a
  nem A nem B.

Consequência prática: todo o trabalho de isolamento multi-tenant e regras de
permissão (Sistema B) já está pronto e testado, mas **zero dessas proteções
está ativa em qualquer servidor rodando hoje** — quem sobe com `bun run dev`
recebe o Sistema A, sem tenant e sem RBAC. Ação de maior valor para uma
próxima sessão de código: criar um `server.ts` que chama
`criarHandler(rotasAuth, sqlite)` e o serve via `Bun.serve`, substituindo
`index.ts` — não decidido aqui, é fora de escopo desta auditoria (só
documentação).

## 4. `.env.example` incompleto

Não declara `JWT_SECRET` nem `PASSWORD_SALT`. Um setup novo roda em silêncio
com os fallbacks hardcoded acima — inclusive fora de ambiente de dev, se
alguém esquecer de setar as vars em produção.

## 5. Teste de expiração de JWT não testa expiração de verdade

Em `lib/auth.test.ts`, o teste "should reject expired JWT" não chama
`verifyJWT` sobre um token expirado — decodifica manualmente um payload e
compara `exp < now`, com o comentário "Skip verification for this test since
it's expired". O caminho de rejeição por expiração dentro de `verifyJWT` não
tem cobertura direta.

## 6. `packages/db/package.json` aponta para caminhos que não existem

Scripts `migrate:dev`/`seed` apontam para `scripts/migrate-dev.ts` e
`scripts/seed.ts`; os arquivos reais são `packages/db/migrate.ts` e
`packages/db/seed.ts`, direto na raiz do pacote, sem pasta `scripts/`.

## 7. Migração não usa drizzle-kit apesar de configurado

`drizzle.config.ts` aponta `out: "./migrations"`, mas `migrate.ts` roda DDL
bruto (`CREATE TABLE IF NOT EXISTS ...`) via `bun:sqlite`, sem gerar/aplicar
migrations do drizzle-kit. Não foi possível confirmar (sem shell) se
`./migrations` já contém arquivos gerados alguma vez.

## 8. Sem Git

Nenhum `.git` em `cav-crm`. Não é um bloqueio para este trabalho de
documentação, mas impede rollback real e histórico de decisões — recomendado
antes de qualquer mudança de código.
