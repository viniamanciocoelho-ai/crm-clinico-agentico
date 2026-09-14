# Auditoria de validação independente — servidores da API

Data: 2026-09-13
Autor: sessão Claude Cowork (nova sessão, sem memória da auditoria anterior)
Escopo: validar no código, sem confiar no relatório do Cowork anterior, os documentos em `docs/architecture/`, `.ai/memory/`, `AGENTS.md` e `CLAUDE.md`.

## Método

Toda afirmação abaixo vem de leitura direta e integral dos arquivos-fonte listados na seção "Diff e arquivos analisados", não do relatório anterior. Onde o relatório anterior é citado, é para contraste, nunca como fonte de fato.

**Limitação confirmada: sem acesso a shell nesta sessão.** `mcp__workspace__bash` falhou 6 vezes consecutivas, todas com o mesmo erro de mount (`RPC error -1... virtiofs/Plan9 share "c" not mounted`), causa raiz apontada pela própria ferramenta como uma atualização do Windows de 8/set/2026 que impede o workspace de alcançar os arquivos do usuário. A última tentativa, feita nesta sessão especificamente para checar se o ambiente tinha se recuperado, falhou do mesmo jeito. Por isso os itens 1, 2, 3, 5 e 6 abaixo foram resolvidos por leitura de código linha a linha, não por execução. Isso está sinalizado explicitamente onde relevante — não é a mesma coisa que rodar o teste de verdade.

## 1. Três implementações de servidor (confirmado)

- **Sistema A** — `packages/api/src/index.ts` (64 linhas). `Bun.serve` cru, sem framework. Só duas rotas hardcoded: `GET /health` e `POST /auth/login`. Reimplementa hash de senha e JWT inline com `"dev-salt"` e `"dev-secret"` como *strings literais* (não lê `process.env`, diferente de `lib/auth.ts`). Loga o corpo bruto da requisição no console (`console.log("Raw body:", text)`), incluindo senha em texto puro no login. Sem isolamento de tenant, sem RBAC.
- **Sistema B** — `router.ts` + `http.ts` + `config.ts` + `middleware/permissoes.ts` + `middleware/tenant.ts` + `routes/auth.ts` + `lib/org.ts`. Roteador HTTP próprio com casamento de padrão de path (`:param`), isolamento de tenant via `resolveContext`, RBAC via `exigirPermissao`, tradução de erro de domínio pra status HTTP em `respostaDeErro`. `routes/auth.ts` reusa corretamente `lib/auth.ts` (não reimplementa nada). Confirmado por `Grep` em todo o projeto (excluindo comentários/docs): `criarHandler(` tem exatamente uma ocorrência — a própria definição — e zero chamadas. Ou seja: o sistema mais completo nunca é instanciado.
- **Sistema C** — `middleware/rbac.ts` (38 linhas). Único arquivo do projeto que importa de `"hono"`. Exporta `requireRole` e `requirePermission`, ambos dependentes de `getSession(c)` importado de `./tenant`. Confirmado por leitura integral de `tenant.ts`: **não existe `getSession` nesse arquivo** — os exports reais são `resolveContext`, `assertBodyHasNoTenant`, `UnauthorizedError`, `TenantViolationError`, e `resolveContext` nem tem a assinatura compatível com um `Context` do Hono. Isso é um bug de código real, não falta de dependência: `hono@4.13.7` está instalado e declarado (`"hono": "^4.4.0"` no `package.json` do pacote `api`).

## 2. Qual servidor realmente inicia

**Sistema A.** Confirmado pelo script `dev` do `package.json` raiz/API: `bun run --watch src/index.ts`. É esse arquivo que sobe hoje, sem isolamento de tenant e sem RBAC.

## 3. Qual tem os testes e recursos mais completos

**Sistema B**, folgado. Dois arquivos de teste sustentam isso:

- `middleware/tenant.test.ts` — 17 blocos `it(...)` (contagem direta, confere com o "17 casos" de `SECURITY-AND-PERMISSIONS.md`/`TEST-STRATEGY.md`). Cobre: sessão válida via Bearer; rejeição sem `Authorization`; token adulterado; override por query string; override por body; override por header customizado; 8 variantes de path traversal (literal, no fim do path, percent-encoded, duplo-encoded, com backslash, backslash cru, traversal em query string, traversal encoded em query string); um teste específico provando que `new URL()` normaliza `../` antes de qualquer checagem enxergar (por isso a defesa opera sobre a URL bruta); um teste de não-regressão pra confirmar que paths legítimos com ponto (`/medicoes..x`) não são falsamente rejeitados; override via `organizacao_id` embutido no path.
- `lib/auth.test.ts` — 8 testes. Hash/verify de senha: sólido. Create/verify de JWT: sólido. Assinatura adulterada rejeitada: sólido, testa a função real. **Rejeição de JWT expirado: fraco** — o teste não chama `verifyJWT` num token de fato expirado; ele monta manualmente um payload com `exp: now - 1` e só compara `expiredPayload.exp < now` como objeto, com comentário no próprio código dizendo "Skip verification for this test since it's expired". O branch real de expiração dentro de `verifyJWT` não tem cobertura direta. Os 4 testes de RBAC só verificam a constante estática `ROLE_PERMISSIONS`, não exercitam `permissoes.ts` nem `rbac.ts`.

Sistema A e C não têm arquivo de teste próprio.

## 4. O que impede a adoção do Sistema B

Nenhuma dependência ausente ou incompatível — o bloqueio é 100% de integração, não de biblioteca:

- Falta um bootstrap que chame `criarHandler(rotasAuth, sqlite)` e sirva isso via `Bun.serve` (ou substitua `index.ts` por esse bootstrap). É literalmente a única peça faltante pra Sistema B rodar.
- Não depende de resolver o Sistema C quebrado — Hono não é usado por B em nenhum ponto.
- Risco real de consolidação: hoje só `routes/auth.ts` existe como rota registrada em B (login + `/auth/eu`). Toda a lógica de negócio mais avançada (`lib/agenda.ts`, `lib/contabil.ts`, `lib/agente.ts` — não lidos nesta sessão, mas citados em `regras-negocio-core.md`) está em bibliotecas chamáveis diretamente, sem rota HTTP que as exponha ainda.

## 5. Tenant, RBAC e path traversal — funcionam de verdade?

- **Tenant**: sim, por leitura de código linha a linha. `resolveContext` extrai `organizacao_id` exclusivamente do JWT verificado; rejeita explicitamente query string, header `X-Organizacao-Id` e path. `assertBodyHasNoTenant` rejeita `organizacao_id`/`organizacaoId` no corpo. Os 17 testes exercitam essa lógica de forma consistente com o código.
- **Path traversal**: sim, por leitura de código. `assertSemTraversal` opera sobre a URL bruta (pré-`new URL()`), decodifica cada segmento até duas vezes (pega `%252e%252e`), compara segmento inteiro (não substring, evitando falso positivo em `/medicoes..x`). Os 8 sub-casos de VETOR 4 no teste cobrem as variantes de encoding relevantes.
- **RBAC**: parcialmente. A lógica em `middleware/permissoes.ts` (`exigirPermissao`, equivalências como `agenda:read_own` satisfazendo `agenda:read`) está implementada e é consistente com `ROLE_PERMISSIONS` de `packages/shared`. Mas **não tem teste de integração** — os 4 testes de RBAC em `auth.test.ts` só verificam a constante, não o middleware. E o Sistema C (`rbac.ts`), que é o único arquivo com "RBAC" no nome que usa Hono, está quebrado e não pode ser usado como está.

Ressalva explícita: isso é validação por leitura de código, não por execução da suíte de teste (bloqueado pela falta de shell — ver seção 7).

## 6. Afirmações documentais incorretas (confirmado)

1. **`.ai/memory/topics/stack-e-estrutura.md`, linha 15**: "schema.ts, 409 linhas, 21 tabelas". Errado — contagem direta de `CREATE TABLE` em `schema.ts` e, cruzado, em `migrate.ts` (que replica o DDL manualmente) dá **24 tabelas** nos dois arquivos. `docs/architecture/DATA-MODEL.md` já registra "24 tabelas" corretamente — a divergência é só nesse arquivo de memória.
2. **`.ai/memory/topics/status-fases.md`, linha 11**: "tenant.test.ts (10 vetores de ataque cobertos...)". Não bate com nenhuma contagem direta possível: são 17 blocos `it()`, ou 6 grupos rotulados "VETOR" (1, 2, 3, 4, 4b, 5) se agrupados por rótulo, ou 8 sub-casos só dentro do VETOR 4. "10" não corresponde a nenhuma dessas leituras — é uma inconsistência interna entre esse arquivo e `SECURITY-AND-PERMISSIONS.md`/`TEST-STRATEGY.md` (que dizem corretamente "17 casos"), provavelmente por metodologias de contagem diferentes nunca explicitadas.
3. **`AGENTS.md`, linha 4**: "Stack: Bun monorepo, Hono, React 19, Drizzle, SQLite/Turso." Enganoso — lista Hono como parte da stack real em uso, mas Hono aparece em exatamente um arquivo (`middleware/rbac.ts`), que está quebrado (import de função inexistente) e nunca é instanciado por nenhum dos outros dois sistemas. O servidor que de fato roda (`index.ts`, Sistema A) usa `Bun.serve` cru, sem Hono em lugar nenhum. Um leitor de `AGENTS.md` concluiria que a API roda em Hono, o que é falso hoje.
4. **`packages/db/package.json`**, scripts `migrate:dev` e `seed` apontam pra `packages/db/scripts/migrate-dev.ts` e `packages/db/scripts/seed.ts` — essa pasta `scripts/` não existe. Os arquivos reais são `packages/db/migrate.ts` e `packages/db/seed.ts`, direto na raiz do pacote (confirmado por `Glob`). Não é uma "afirmação documental" no sentido estrito, mas confirma o achado já registrado em `bugs-e-inconsistencias.md`: esses scripts do `package.json` falham como estão. `AGENTS.md` (linhas 10-11), coincidentemente, documenta os caminhos certos (`bun packages/db/seed.ts`, `bun packages/db/migrate.ts`), então a fonte de verdade prática é `AGENTS.md`, não o `package.json` do pacote.

Todos os demais achados de `.ai/memory/topics/bugs-e-inconsistencias.md` (JWT/salt hardcoded em `index.ts`, log de senha em texto puro, `.env.example` sem `JWT_SECRET`/`PASSWORD_SALT`, Turso declarado e não usado, ausência de migrations geradas por drizzle-kit apesar de `drizzle.config.ts` apontar `out: "./migrations"`) foram cruzados com leitura fresca do código nesta sessão e se confirmam corretos.

## 7. Evidência de comandos executados

**Nenhum comando pôde ser executado nesta sessão.** `mcp__workspace__bash` falhou 6 vezes consecutivas com erro de mount (detalhe técnico na seção "Método"), incluindo uma tentativa final feita especificamente para reverificar antes de escrever este relatório. A ferramenta reportou explicitamente para não insistir mais.

Para fechar essa lacuna, os comandos que precisam ser rodados manualmente (pelo usuário ou por uma sessão com shell disponível, ex. Claude Code) são:

```
bun install
bun test packages/**/*.test.ts
tsc --noEmit -p packages/api
bun build packages/api/src/index.ts
```

Até esses comandos rodarem de fato, "17 testes passam" e "typecheck limpo" são inferências de leitura de código, não fatos verificados por execução. Trate como boa evidência circunstancial, não como substituto de rodar a suíte.

## 8. Recomendação objetiva

**Sistema B deve virar o servidor oficial.** É o único com isolamento de tenant, RBAC e defesa de path traversal implementados e testados de forma não-trivial. Sistema A, hoje em produção de fato, tem dois problemas de segurança concretos (segredo hardcoded, log de senha em texto puro) além de zero proteção de tenant/RBAC — não é uma base segura pra continuar construindo em cima. Sistema C está quebrado e não vale a pena consertar antes de decidir se Hono entra no projeto de verdade ou sai — hoje ele não tem nenhuma vantagem sobre B pra justificar o retrabalho.

## 9. Plano seguro de consolidação

1. Criar um novo arquivo de bootstrap (ex. `src/server.ts`) que importe `criarHandler` de `router.ts`, monte `rotasAuth` e sirva via `Bun.serve({ port: PORT, fetch: criarHandler(rotasAuth, sqlite) })`, reaproveitando `config.ts` pra porta e conexão.
2. Trocar o script `dev` do `package.json` de `src/index.ts` pra esse novo bootstrap, só depois de confirmar (com `bun test` rodando de verdade) que os 17+8 testes existentes continuam passando sem alteração de lógica.
3. Manter `src/index.ts` no repositório por um ciclo curto, renomeado pra algo como `src/index.legacy.ts` ou movido pra uma pasta `_deprecated/`, sem apagar — permite rollback rápido e serve de referência pro que ainda falta portar (nenhuma rota nova, só as duas que já existem).
4. Remover ou consertar `middleware/rbac.ts` (Sistema C) numa etapa separada: decidir primeiro se Hono entra no projeto formalmente (aí vale portar `router.ts`/`http.ts` pra cima de Hono) ou se sai de vez (aí `rbac.ts` e a dependência `hono` do `package.json` do pacote `api` podem ser removidos). Não misturar essa decisão com a consolidação A→B.
5. Corrigir os scripts quebrados de `packages/db/package.json` (`scripts/migrate-dev.ts` → `migrate.ts`, mesmo pro `seed`) no mesmo PR da consolidação, já que é uma correção de uma linha e de baixo risco.
6. Só depois de B estar no ar e testado de ponta a ponta, atacar a cobertura fraca identificada: teste real de token expirado em `lib/auth.test.ts` (hoje não exercita o branch real) e teste de integração pra `middleware/permissoes.ts` (hoje só a constante `ROLE_PERMISSIONS` é testada, não o middleware).
7. Corrigir as afirmações documentais incorretas listadas na seção 6 (`stack-e-estrutura.md`, `status-fases.md`, `AGENTS.md`) como parte da mesma mudança, pra não deixar a documentação nova já nascendo desatualizada.

Nenhum desses passos foi executado nesta sessão — é auditoria e recomendação, não implementação, conforme solicitado.

## 10. Diff / comparação dos arquivos analisados

Não existe repositório Git em `cav-crm` (confirmado por busca recursiva de `.git/HEAD` em sessão anterior, sem resultado, e não há indício de que isso mudou). Não há como gerar um `git diff` real. Em vez disso, segue comparação lado a lado dos três sistemas nos pontos que importam pra decisão:

| Critério | Sistema A (`index.ts`) | Sistema B (`router.ts`+cia) | Sistema C (`rbac.ts`) |
|---|---|---|---|
| Roda hoje via `bun run dev` | Sim | Não (nunca instanciado) | Não (não é servidor, é middleware) |
| Isolamento de tenant | Não | Sim, testado (17 casos) | N/A (depende de B/A pra existir) |
| RBAC | Não | Sim (`permissoes.ts`), sem teste de integração | Quebrado (`getSession` inexistente) |
| Path traversal | Não | Sim, testado (8 variantes) | N/A |
| Segredo JWT/salt | Hardcoded literal no arquivo | Lido de `process.env` com fallback (`lib/auth.ts`) | N/A |
| Log de dado sensível | Sim (`console.log` do corpo bruto, incluindo senha) | Não | N/A |
| Dependência de framework externo | Nenhuma | Nenhuma | Hono (única no projeto) |
| Rotas expostas | `/health`, `/auth/login` | `/auth/login`, `/auth/eu` | Nenhuma (é middleware) |
| Arquivo de teste próprio | Não | `tenant.test.ts` (17), `auth.test.ts` (8) | Não |

Arquivos lidos na íntegra nesta auditoria (fonte de cada afirmação acima e nas seções 1-6): `packages/api/src/index.ts`, `router.ts`, `http.ts`, `config.ts`, `middleware/rbac.ts`, `middleware/tenant.ts`, `middleware/tenant.test.ts`, `middleware/permissoes.ts`, `routes/auth.ts`, `lib/auth.ts`, `lib/auth.test.ts`, `lib/org.ts`, `packages/shared/index.ts`, `packages/shared/package.json`, `packages/db/schema.ts`, `packages/db/client.ts`, `packages/db/drizzle.config.ts`, `packages/db/migrate.ts`, `packages/db/package.json`, `packages/web/package.json`, `packages/api/package.json`, `.env.example`, `tsconfig.json`, `AGENTS.md`, `CLAUDE.md`, `.ai/memory/topics/stack-e-estrutura.md`, `.ai/memory/topics/status-fases.md`, `.ai/memory/topics/bugs-e-inconsistencias.md`, `docs/architecture/DATA-MODEL.md`, `.ai-bootstrap/COWORK_SOURCES.md`, `COWORK_DECISIONS.md`, `COWORK_ROLLBACK.md`, `COWORK_MANIFEST.sha256`.
