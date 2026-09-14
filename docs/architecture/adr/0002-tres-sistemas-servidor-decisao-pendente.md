# ADR 0002 — Três sistemas de servidor paralelos: decisão pendente

> **Superada em 2026-09-14.** `packages/api/src/index.ts` registra todas as
> famílias de rota no roteador próprio. Este ADR permanece apenas como contexto
> histórico.

**Status**: Proposto / decisão em aberto. Esta auditoria (Claude Cowork,
2026-09-13) documenta a situação e recomenda uma direção, mas explicitamente
**não toma** a decisão nem migra código — está fora do escopo de uma
auditoria de documentação, e é uma decisão de arquitetura que cabe ao
time/próxima sessão de código.

## Contexto

`packages/api/src` contém três implementações de servidor HTTP que não se
comunicam entre si — ver detalhe completo em
[SYSTEM-ARCHITECTURE.md](../SYSTEM-ARCHITECTURE.md):

- **Sistema A** (`src/index.ts`): `Bun.serve` cru, é o que efetivamente
  atende requisições hoje (`bun run dev`). Simples, mas sem isolamento de
  tenant e sem RBAC em nenhuma rota.
- **Sistema B** (`router.ts` + arquivos relacionados): roteador próprio
  completo, com tenant e RBAC prontos e testados, mas `criarHandler()` nunca
  é chamado por nenhum arquivo do projeto — não está no ar.
- **Sistema C** (`middleware/rbac.ts`): Hono, quebrado (`getSession` não
  existe em `tenant.ts`), órfão, não usado por A nem B.

Segundo `.ai-bootstrap/DECISIONS.md` (sessão Claude Code anterior, mesmo
dia), o Hono foi rejeitado deliberadamente por um bug de parsing de corpo
com o dev server do Bun, com pivô para `Bun.serve` nativo — o que explica a
origem do Sistema A. Essa decisão não explica, e provavelmente não pretendia
causar, o abandono do Sistema B (que não depende de Hono).

## Opções

**Opção 1 — Adotar o Sistema B como base.** Criar um `server.ts` que chama
`criarHandler(rotasAuth, sqlite)` e o serve via `Bun.serve`, substituindo
`index.ts` como entrypoint de `dev`/`build`. Ganha isolamento de tenant e
RBAC testados imediatamente, sem reescrever essa lógica. Custo: migrar as
duas rotas hoje hardcoded em `index.ts` (`/health`, `/auth/login`) para o
formato `Rota` do Sistema B (baixo esforço — `routes/auth.ts` já cobre
`/auth/login` de forma equivalente e mais completa).

**Opção 2 — Manter o Sistema A e portar tenant/RBAC para ele.** Reescrever a
lógica de `resolveContext`/`exigirPermissao` diretamente dentro de
`index.ts` ou de um middleware compatível com `Bun.serve` cru. Custo:
duplica trabalho já feito e testado no Sistema B; risco de introduzir
divergência sutil em relação ao comportamento já validado por
`tenant.test.ts`.

**Opção 3 — Reavaliar Hono.** Investigar se o bug de parsing de corpo citado
em `DECISIONS.md` ainda ocorre (pode ter sido corrigido em versão mais
recente de Bun/Hono desde a decisão original) e, se resolvido, considerar
migrar para Hono formalmente — aproveitando que `middleware/rbac.ts` já foi
escrito nessa direção, embora quebrado. Custo: maior — exigiria validar a
causa raiz original antes de reverter a decisão anterior.

## Recomendação desta auditoria (não uma decisão tomada)

Opção 1. É o caminho de menor esforço e menor risco: aproveita código já
escrito, testado e alinhado com a regra crítica de isolamento de tenant
(ADR 0001), sem reabrir a investigação sobre Hono. Remover
`middleware/rbac.ts` (Sistema C) e a dependência `hono` do `package.json` do
pacote `api` como parte da mesma mudança, já que nada mais o usa.

## Consequências de não decidir

Enquanto esta decisão não for tomada, qualquer rota nova escrita seguindo o
padrão atual de `index.ts` (Sistema A) nasce sem isolamento de tenant e sem
RBAC — risco que cresce a cada rota adicionada nesse padrão. Ver
[ROADMAP.md](../ROADMAP.md) para o impacto disso nas Fases 2-8.
