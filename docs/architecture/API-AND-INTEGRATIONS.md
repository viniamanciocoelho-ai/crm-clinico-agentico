# API-AND-INTEGRATIONS.md — CAV CRM

Base: leitura direta de `packages/api/src` (15 arquivos). Ver
[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md) para o contexto completo
dos três sistemas de servidor — este documento foca no contrato de API em
si, distinguindo o que está **no ar** (Sistema A) do que está **desenhado e
testado, mas não servido** (Sistema B).

## O que responde requisições HTTP hoje (Sistema A, `src/index.ts`)

| Método | Rota | Autenticação | Observação |
|---|---|---|---|
| GET | `/health` | Nenhuma | Hardcoded no handler |
| POST | `/auth/login` | Nenhuma (é o próprio login) | Reimplementa hash/JWT inline, não usa `lib/auth.ts`; secret hardcoded `"dev-secret"` |
| * | qualquer outro caminho | — | 404 |

Nenhuma outra rota existe no sistema em execução. Não há CRUD de clientes,
agenda, procedimentos, etc. servido por HTTP hoje, apesar de a lógica de
negócio existir em `lib/`.

## O que está desenhado e testado, mas não servido (Sistema B)

Contrato de rota (`Rota` interface em `router.ts`): `{ metodo, caminho,
permissao?, publica?, handler }`. Path matching suporta parâmetros
(`:id`). Rotas implementadas hoje neste sistema:

| Método | Rota | Pública? | Observação |
|---|---|---|---|
| POST | `/auth/login` | Sim | Única rota que aceita `organizacao_id` no corpo — legítimo, pois ainda não há sessão |
| GET | `/auth/eu` | Não | Retorna dados do usuário da sessão corrente |

Apenas estas duas rotas de negócio existem em `routes/`. O roteador em si
(`criarHandler`) está pronto para receber mais rotas (agenda, clientes,
procedimentos, atendimentos), mas nenhuma foi escrita ainda — a lógica que
essas rotas chamariam (`lib/agenda.ts`, `lib/contabil.ts`) já existe como
função, só falta o wrapper HTTP.

### Contrato de erro (Sistema B, via `respostaDeErro` em `http.ts`)

| Exceção de domínio | Status HTTP |
|---|---|
| `TenantViolationError` | 403 |
| `PermissionDeniedError` | 403 |
| `ConflitoError` | 409 |
| `UnauthorizedError` | 401 |
| `BadRequestError` | 400 (via `ApiError` base) |
| `NotFoundError` | 404 (via `ApiError` base) |
| Qualquer outra exceção | 500, logada via `console.error` |

Este contrato não está ativo hoje porque o roteador que o aplica nunca é
instanciado (ver achado central em
[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md)).

## Autenticação

JWT hand-rolled (não uma lib padrão) em `lib/auth.ts`: header/payload em
base64url, assinatura via `createHash("sha256")` sobre a concatenação de
header+payload+secret. Ver nota de segurança em
[SECURITY-AND-PERMISSIONS.md](./SECURITY-AND-PERMISSIONS.md) — isso não é uma
construção HMAC padrão. `routes/auth.ts` usa corretamente este módulo;
`src/index.ts` reimplementa a mesma ideia de forma divergente e com secret
hardcoded diferente.

## Integrações externas

Nenhuma integração externa real foi encontrada implementada (sem chamadas de
rede a APIs de terceiros em `packages/api/src`). O schema modela campos
compatíveis com uma futura integração WhatsApp/Meta Cloud API
(`conversas.canal`, `mensagens`), mas não há client HTTP, webhook receiver,
nem SDK de nenhum provedor de mensageria no código. `.ai-bootstrap/DECISIONS.md`
(sessão anterior) lista "templates Meta Cloud API" como decisão adiada —
confirma que ainda não foi implementado, não é uma lacuna desta auditoria.

Turso (`TURSO_CONNECTION_URL`) está declarado em `.env.example` mas vazio —
sem integração ativa; o projeto roda 100% em SQLite de arquivo local hoje.

## Recomendação (não executada nesta auditoria)

Se a decisão for adotar o Sistema B como base (ver
[adr/0002-tres-sistemas-servidor-decisao-pendente.md](./adr/0002-tres-sistemas-servidor-decisao-pendente.md)),
o próximo contrato de API a desenhar são as rotas de agenda e atendimento,
já que a lógica de negócio (`lib/agenda.ts`, `lib/contabil.ts`) está pronta e
só falta o wrapper HTTP no padrão de `routes/auth.ts`.
