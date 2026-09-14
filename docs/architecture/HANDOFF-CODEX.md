# HANDOFF-CODEX.md — CAV CRM

> Handoff histórico de 2026-09-13. Consulte `PROJECT-STATUS.md` para o estado
> operacional atual.

Instruções para quem retomar este projeto usando Codex (ou outro agente sem
o contexto de memória específico de Claude Code/Cowork). Este documento não
assume familiaridade com `.ai/memory/` ou com as convenções de skill usadas
nas sessões Claude — assume só acesso ao código e a este `docs/architecture/`.

## Leia primeiro

[PROJECT-STATUS.md](./PROJECT-STATUS.md) — resumo do estado real do projeto,
cruzado com o tracker declarado em `AGENTS.md`. O achado mais importante:
existem três implementações de servidor HTTP em `packages/api/src`, e só uma
(a mais simples, sem segurança) está de fato em execução. Ver
[SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md) para o detalhe completo
antes de escrever qualquer rota nova.

## Comandos reais (de `AGENTS.md`, não verificados nesta auditoria por falta de shell)

```
bun install
bun packages/api/src/index.ts     # dev, porta 3001, Sistema A
bun test packages/**/*.test.ts    # 8 + 17 casos, ver TEST-STRATEGY.md
bun build packages/api/src/index.ts
bun packages/db/seed.ts
bun packages/db/migrate.ts
```

Note: `packages/db/package.json` declara scripts `migrate:dev`/`seed`
apontando para um caminho (`scripts/`) que não existe — use os comandos
diretos acima, não `bun run migrate:dev`/`bun run seed`.

## Regras obrigatórias do projeto (de `AGENTS.md`, ainda válidas)

Ler antes de editar; nunca hardcode `organizacao_id` (só vem de JWT
verificado); validar isolamento de tenant em toda query/mutation; sem
segredos em `.env` ou commits; sem push/merge/deploy/alteração de produção;
testes verdes antes de avançar de fase; YAGNI; alterações mínimas e
reversíveis.

## Antes de escrever qualquer rota nova

1. Decidir qual sistema de servidor usar — ver
   [adr/0002-tres-sistemas-servidor-decisao-pendente.md](./adr/0002-tres-sistemas-servidor-decisao-pendente.md).
   Não escrever rota nova em `src/index.ts` (Sistema A) sem replicar
   manualmente tenant/RBAC — isso já existe pronto no Sistema B
   (`router.ts`/`http.ts`/`middleware/tenant.ts`/`middleware/permissoes.ts`).
2. Ler [SECURITY-AND-PERMISSIONS.md](./SECURITY-AND-PERMISSIONS.md) — a regra
   de isolamento de tenant (JWT-only, nunca aceitar `organizacao_id` de
   query/body/header/path) é a regra mais crítica do projeto e tem teste que
   comprova o comportamento esperado (`tenant.test.ts`).
3. Ler [DATA-MODEL.md](./DATA-MODEL.md) para o schema completo antes de criar
   qualquer tabela nova — o schema já cobre até a Fase 8 do roadmap, mesmo
   que a API não exponha isso ainda.

## Limitação desta auditoria

Todo o conteúdo de `docs/architecture/` foi produzido por leitura estática
de código, sem shell disponível — nenhum teste foi executado para confirmar
que passa, nenhuma dependência foi (re)instalada nesta sessão. Trate como
ponto de partida confiável para navegação, não como substituto de rodar
`bun test` você mesmo antes de confiar em qualquer claim de "testado".

## Git

Não há repositório Git neste projeto (`cav-crm`). Recomenda-se inicializar
antes de qualquer mudança de código, para viabilizar rollback real.
