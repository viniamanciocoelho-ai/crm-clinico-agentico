# Bootstrap anterior (Claude Code, mesma data) — claims vs. realidade verificada

Antes desta auditoria (Cowork), uma sessão anterior de Claude Code já rodou um
bootstrap semelhante no mesmo dia (2026-09-13), registrado em
`.ai-bootstrap/CLAUDE_BOOTSTRAP_REPORT.md`, `DECISIONS.md`, `ROLLBACK.md`,
`SOURCES.md`, `MANIFEST.sha256` (sem prefixo `COWORK_` — arquivos desta
auditoria usam prefixo `COWORK_` para não colidir com esses).

## O que aquele relatório explica

A decisão de `src/index.ts` ser um `Bun.serve` cru em vez de usar Hono não foi
acidente: `DECISIONS.md` registra "Hono rejeitado por bug de body parsing com
Bun dev server", com pivô deliberado para "Bun nativo fetch handler". Isso
explica a origem do Sistema A descrito em [[bugs-e-inconsistencias]]. O que o
relatório não registra é que essa decisão deixou para trás dois sistemas
órfãos: o roteador próprio completo (`router.ts` e afins, nunca ligado) e
`middleware/rbac.ts` (ainda em Hono, nunca removido).

## Discrepância confirmada entre o relatório e o código real

`CLAUDE_BOOTSTRAP_REPORT.md` afirma "✅ RBAC (4 roles, permissões testadas)" e
lista testes específicos de RBAC passando. Verificação direta nesta auditoria
não encontrou nenhum arquivo de teste de RBAC (`Glob` por `**/*.test.ts` em
`packages/` retorna apenas `lib/auth.test.ts` e `middleware/tenant.test.ts`).
Não há como esse teste ter passado como descrito — a afirmação não está
sustentada pelo estado atual do código. Pode ter havido teste manual único,
não persistido, ou a afirmação está incorreta. Tratar qualquer claim futuro de
"testado" com a mesma cautela: verificar o arquivo de teste antes de aceitar.

## Erro cometido nesta própria auditoria (transparência)

Ao criar o índice `.ai/memory/MEMORY.md` desta auditoria, o arquivo já
existia (criado pelo bootstrap anterior, hash registrado em
`.ai-bootstrap/MANIFEST.sha256`) e foi sobrescrito sem leitura prévia — violação
do próprio limite de segurança de "não sobrescrever documentação existente".
Não há Git neste projeto, então o conteúdo anterior não pôde ser recuperado.
O novo índice segue a mesma convenção descrita em `AGENTS.md` (≤130 linhas),
mas o conteúdo específico do índice anterior foi perdido. Fica registrado aqui
para não se repetir: sempre ler um arquivo de memória existente antes de
regravá-lo, mesmo quando a intenção é só reorganizar o índice.
