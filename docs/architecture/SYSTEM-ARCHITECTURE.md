# SYSTEM-ARCHITECTURE.md — CAV CRM

Base: leitura direta de todos os 15 arquivos de `packages/api/src`, `schema.ts`
completo, `packages/shared/index.ts`. Auditoria de 2026-09-13.

## Visão geral do monorepo

Bun workspaces, 4 pacotes:

- `packages/shared` — tipos e constantes cross-package (`RoleType`,
  `SessionData`, `ROLE_PERMISSIONS`, exceções de domínio
  `TenantViolationError`/`PermissionDeniedError`). Publicado internamente
  como `@cav-crm/shared`.
- `packages/db` — schema Drizzle (`bun:sqlite`), `client.ts`, `migrate.ts`
  (DDL bruto idempotente, não usa drizzle-kit apesar de configurado),
  `seed.ts`.
- `packages/api` — servidor HTTP. Três sistemas paralelos, detalhados abaixo.
- `packages/web` — React 19 + Vite, hoje é placeholder ("Fase 0: Fundação
  iniciada" em `App.tsx`), sem consumo real da API ainda.

Sem Turso conectado (variável vazia em `.env.example`); tudo roda em SQLite de
arquivo local (`dev.db`) via `bun:sqlite`.

## O achado central: três sistemas de servidor não integrados

### Sistema A — `src/index.ts` (o único em execução)

Script `dev` real (`bun run --watch src/index.ts`). `Bun.serve` cru, sem
framework, sem router formal:

- Rotas hardcoded no corpo do handler: `/health`, `POST /auth/login`.
  Qualquer outro caminho retorna 404.
- `new Database("dev.db")` com caminho fixo — ignora `DATABASE_URL` e o
  `config.ts` do Sistema B.
- Hashing e JWT reimplementados inline (não usa `lib/auth.ts`): SHA-256 com
  salt hardcoded `"dev-salt"`, assinatura com secret hardcoded `"dev-secret"`.
- Sem isolamento de tenant, sem RBAC — nenhuma checagem de permissão em
  nenhuma rota.
- Loga o corpo bruto da requisição no console (`console.log("Raw body:",
  text)`) — nota de higiene de log, não necessariamente um vazamento de
  segredo hoje, mas prática a evitar (corpo de login inclui senha em texto
  claro na fase de request).

Este é o único código que atende requisições reais hoje.

### Sistema B — roteador próprio (completo, testado, nunca instanciado)

Conjunto de arquivos que formam um roteador HTTP escrito à mão, sem
framework:

- `router.ts` — exporta `criarHandler(rotas: Rota[], sqlite)`, que retorna
  uma função `fetch(req, urlBruta)`. Faz casamento de path com suporte a
  parâmetros (`:id`), resolve o contexto de tenant via `resolveContext`,
  checa permissão via `exigirPermissao`, despacha para o handler da rota
  casada, e captura exceções via `respostaDeErro`.
- `http.ts` — classes de erro de domínio (`ApiError`, `NotFoundError`,
  `BadRequestError`) e helpers de parsing/validação de corpo (`lerCorpo`,
  `exigirTexto`, `opcionalTexto`, `exigirInstante`, `opcionalNumero`).
  `respostaDeErro(e)` centraliza o mapeamento erro→status HTTP:
  `TenantViolationError`→403, `PermissionDeniedError`→403,
  `ConflitoError`→409, `UnauthorizedError`→401, fallback 500 com
  `console.error`.
- `config.ts` — `DB_PATH` a partir de `DATABASE_URL` (com strip de prefixo
  `file://`/`file:`), instância `sqlite` com `journal_mode=WAL` e
  `foreign_keys=ON`, `PORT` de `process.env.PORT` (default 3001),
  `DEMO_ORG_ID`.
- `middleware/tenant.ts` — `resolveContext(req, url, urlBruta?)`: única fonte
  de verdade do tenant é o JWT verificado; rejeita `organizacao_id` vindo de
  query, header customizado, corpo ou segmento de path. Defesa contra path
  traversal opera sobre a string bruta da URL (antes de `new URL()`
  normalizar `../`), com decodificação dupla. Ver
  [isolamento-multi-tenant.md](../../.ai/memory/topics/isolamento-multi-tenant.md).
- `middleware/permissoes.ts` — `permissaoConcedida`/`exigirPermissao` sobre
  `ROLE_PERMISSIONS` (de `@cav-crm/shared`), com mapa de equivalência para
  permissões `*_own` (ex.: quem tem `agenda:read_own` também satisfaz checagem
  de `agenda:read` restrita ao próprio registro).
- `routes/auth.ts` — `POST /auth/login` e `GET /auth/eu`. Reusa corretamente
  `lib/auth.ts` (não reimplementa hashing/JWT). É a única rota que aceita
  `organizacao_id` no corpo — legítimo, pois ainda não existe sessão antes do
  login.
- `lib/org.ts` — `carregarOrg` (config da organização) e
  `profissionalDoUsuario` (liga usuário logado a registro de profissional,
  para restringir views de "própria agenda" a partir de vínculo verificado no
  banco, nunca de input do cliente).

**Nenhum arquivo do projeto chama `criarHandler()`** — confirmado por busca
textual: a única ocorrência de `criarHandler(` é a própria definição em
`router.ts`. Este é o sistema mais maduro (é o que `tenant.test.ts` exercita
diretamente), mas está completamente desconectado de qualquer processo em
execução.

### Sistema C — `middleware/rbac.ts` (Hono, quebrado, órfão)

Único arquivo do projeto que importa de `"hono"` (`Context`, `Next`). Exporta
`requireRole(...roles)` e `requirePermission(permission)`, ambos chamando
`getSession(c)` importado de `./tenant` — mas `tenant.ts` não exporta
`getSession` (exporta `resolveContext`, com assinatura incompatível: recebe
`Request`/`URL` puros, não um `Context` do Hono). Este arquivo não compila
corretamente contra a API real de `tenant.ts` e não é usado por A nem por B.
A dependência `hono: ^4.4.0` no `package.json` do pacote existe só por causa
deste arquivo.

Segundo `.ai-bootstrap/DECISIONS.md` (sessão anterior de Claude Code, mesmo
dia), o Hono foi deliberadamente rejeitado por um "bug de body parsing com
Bun dev server", com pivô para `Bun.serve` nativo (= Sistema A). Isso explica
a origem do Sistema A, mas não explica por que o Sistema B (que não depende
de Hono) também ficou órfão, nem por que `rbac.ts` não foi removido.

## Diagrama textual

```
Requisição HTTP
      |
      v
bun run dev  →  src/index.ts (Sistema A, EM EXECUÇÃO)
                  - Bun.serve cru
                  - /health, /auth/login hardcoded
                  - sem tenant, sem RBAC
                  - JWT/hash inline, secret hardcoded

[não conectado a nenhum processo]
router.ts → criarHandler(rotas, sqlite) (Sistema B, PRONTO, NUNCA CHAMADO)
                  - resolveContext (tenant via JWT)
                  - exigirPermissao (RBAC via ROLE_PERMISSIONS)
                  - routes/auth.ts (login real)
                  - respostaDeErro (mapeamento de exceções → HTTP)

[órfão, quebrado]
middleware/rbac.ts (Sistema C, Hono, getSession() não existe)
```

## Lógica de negócio em `lib/` (pronta, sem rota que a exponha)

`agenda.ts` (motor anti-conflito), `contabil.ts` (efeitos fixos por status de
atendimento), `agente.ts` (agente de WhatsApp determinístico). Detalhes em
[regras-negocio-core.md](../../.ai/memory/topics/regras-negocio-core.md).
Nenhuma delas tem rota em `routes/` além de `auth.ts` — chamáveis diretamente
como função, mas não como endpoint HTTP hoje.

## Decisão em aberto (não tomada nesta auditoria)

Qual sistema deve ser a base daqui para frente — A (simples, no ar, sem
segurança) ou B (completo, testado, parado)? Ver
[adr/0002-tres-sistemas-servidor-decisao-pendente.md](./adr/0002-tres-sistemas-servidor-decisao-pendente.md).
Esta auditoria documenta a situação e recomenda B como base técnica (é o que
tem tenant/RBAC prontos), mas não executa a migração — está fora do escopo de
uma auditoria de documentação.
