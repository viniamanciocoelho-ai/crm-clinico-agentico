# SECURITY-AND-PERMISSIONS.md — CAV CRM

> Histórico de 2026-09-13. Não descreve o runtime atual; consulte
> `SYSTEM-ARCHITECTURE.md`, `API-AND-INTEGRATIONS.md` e o relatório de correção
> de 2026-09-14 para o estado verificado.

Base: `lib/auth.ts`, `middleware/tenant.ts`, `middleware/permissoes.ts`,
`middleware/rbac.ts`, `shared/index.ts`, `tenant.test.ts`, `auth.test.ts`,
todos lidos na íntegra em 2026-09-13. Este documento cobre o que está
implementado no Sistema B (o desenho de segurança mais completo do projeto);
o Sistema A, que é o que roda hoje, não implementa nenhuma das proteções
abaixo — ver seção final.

## Isolamento multi-tenant

Regra central (`middleware/tenant.ts`, `resolveContext`): `organizacao_id`
só pode vir do JWT verificado. Todo outro vetor é explicitamente rejeitado:
query string, header customizado (`X-Organizacao-Id`), corpo da requisição
(via `assertBodyHasNoTenant`), segmento de path. Única exceção legítima:
`POST /auth/login`, que aceita `organizacao_id` no corpo porque ainda não
existe sessão — documentado em comentário no próprio código.

### Defesa contra path traversal

`assertSemTraversal` inspeciona a string bruta da URL **antes** de
`new URL()` processá-la, porque `new URL()` normaliza silenciosamente `../`
— um teste do próprio projeto (`tenant.test.ts`, vetor 4b) demonstra que
`/org/../../etc/passwd` vira `/etc/passwd` já normalizado, apagando a
evidência de traversal antes que uma checagem pós-parsing pudesse vê-la.
A defesa decodifica a string até duas vezes (cobre `%2e%2e` e duplo-encoded
`%252e%252e`) e verifica variantes com barra normal e invertida.

### Cobertura de teste confirmada (`tenant.test.ts`, 17 casos)

Sessão válida injetada corretamente; `Authorization` ausente rejeitado;
token adulterado rejeitado; override via query string rejeitado; override via
corpo rejeitado; override via header customizado rejeitado; 8 variantes de
path traversal rejeitadas (literal, no fim do path, percent-encoded,
duplo-encoded, com barra invertida codificada, com barra invertida crua, via
query string, via query string codificada); teste de não-regressão para path
legítimo com ponto (`/api/v1.2/medicoes.relatorio`, para confirmar que a
defesa não é agressiva demais); `organizacao_id` embutido em segmento de path
rejeitado.

## RBAC

Modelo em `shared/index.ts`: enum `RoleType`
(`PROPRIETARIO`/`GERENTE`/`PROFISSIONAL`/`RECEPCAO`) e mapa
`ROLE_PERMISSIONS`:

| Role | Permissões |
|---|---|
| `PROPRIETARIO` | `["*"]` (tudo) |
| `GERENTE` | agenda (read/write), clientes (read/write), `relatorios:read`, `agente_ia:config` |
| `PROFISSIONAL` | `agenda:read_own`, `atendimentos:read_own` |
| `RECEPCAO` | agenda (read/write), clientes (read/write) |

`middleware/permissoes.ts` aplica esse mapa via `exigirPermissao`, com um
mapa de equivalência (`EQUIVALENTES`) para permissões `*_own` — ex.: quem tem
só `agenda:read_own` ainda satisfaz uma checagem de `agenda:read` desde que a
consulta seja restrita ao próprio profissional (`apenasPropriaAgenda`,
`apenasPropriosAtendimentos`, que usam `lib/org.ts`'s
`profissionalDoUsuario` para confirmar o vínculo no banco, nunca aceitando o
vínculo vindo de input do cliente).

**Importante**: esse RBAC só é aplicado dentro do Sistema B
(`criarHandler`), que não está no ar (ver
[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md)). O único teste
relacionado a RBAC (`auth.test.ts`, describe "RBAC") verifica apenas o
conteúdo do objeto `ROLE_PERMISSIONS` — não exercita `exigirPermissao` nem
nenhum middleware. Não há teste de comportamento de RBAC em uso real.

## `middleware/rbac.ts` — quebrado, não usar como referência

Único arquivo Hono do projeto. Chama `getSession(c)` importado de
`./tenant`, mas `tenant.ts` não exporta essa função — exporta
`resolveContext`, com assinatura incompatível (`Request`/`URL` puros, não um
`Context` do Hono). Este arquivo não funciona como está e não deve ser usado
como base para nenhuma implementação futura sem reescrita.

## Autenticação e hashing

`lib/auth.ts`: `hashPassword`/`verifyPassword` via `createHash("sha256")`
sobre senha + salt (`PASSWORD_SALT`, fallback hardcoded `"dev-salt"`).
`createJWT`/`verifyJWT` implementam um esquema JWT-like manualmente: header e
payload em base64url, "assinatura" = `createHash("sha256")` sobre a
concatenação de header+payload+secret (`JWT_SECRET`, fallback hardcoded
`"dev-secret"`).

**Nota de segurança**: isso não é uma construção HMAC padrão (HS256 real
usa HMAC, não um hash simples de concatenação). Um hash simples de
concatenação de secret+dados é uma prática mais fraca e não deve ser tratada
como equivalente a HMAC em termos de garantias criptográficas — não foi
avaliado nesta auditoria se isso é explorável na prática (auditoria de
documentação, não pentest), mas é um ponto que merece revisão por alguém com
foco em segurança antes de produção.

### Segredos com fallback hardcoded

`.env.example` não declara `JWT_SECRET` nem `PASSWORD_SALT`. Um setup novo
roda silenciosamente com os fallbacks `"dev-secret"`/`"dev-salt"` — inclusive
fora de ambiente de desenvolvimento, se alguém esquecer de configurar as
variáveis em produção. Recomendação: falhar explicitamente (throw) se essas
variáveis não estiverem definidas em `NODE_ENV=production`, em vez de usar
fallback silencioso.

### Teste de expiração de JWT é fraco

Em `auth.test.ts`, o teste "should reject expired JWT" não chama
`verifyJWT` sobre um token realmente expirado — decodifica manualmente o
payload e compara `exp < now`, com comentário no próprio código "Skip
verification for this test since it's expired". O caminho de rejeição por
expiração dentro de `verifyJWT` não tem cobertura direta de teste. O teste de
assinatura adulterada, por outro lado, é sólido: adultera a assinatura e
chama `verifyJWT` de verdade, esperando `null`.

## O que está ativo no servidor que roda hoje (Sistema A)

Nada do RBAC ou isolamento de tenant acima está em vigor em `src/index.ts`.
As únicas duas rotas (`/health`, `/auth/login`) não passam por
`resolveContext` nem por `exigirPermissao`. O login em si funciona (hash e
verificação de senha), mas com secret/salt hardcoded divergentes dos de
`lib/auth.ts`, e sem nenhuma verificação de permissão em rotas subsequentes
porque não há rotas subsequentes.

## Resumo de risco

| Item | Risco se for para produção como está |
|---|---|
| Sistema A no ar sem tenant/RBAC | Alto — qualquer rota futura adicionada a `index.ts` seguindo o padrão atual nasceria sem isolamento |
| Secrets com fallback hardcoded | Alto — falha silenciosa, não failure-fast |
| JWT não-HMAC padrão | Médio — não avaliado profundidade de exploração, mas desvio de prática recomendada |
| RBAC sem teste de comportamento | Médio — lógica existe e parece correta por inspeção, mas não há rede de segurança de teste |
| `rbac.ts` quebrado presente no código | Baixo — não é chamado por ninguém, mas pode confundir quem tentar reusá-lo |
