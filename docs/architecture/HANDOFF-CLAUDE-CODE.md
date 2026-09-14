# HANDOFF-CLAUDE-CODE.md — CAV CRM

Instruções para quem retomar este projeto usando Claude Code (CLI local, com
acesso a shell). Escrito ao final de uma auditoria feita via Claude Cowork,
que não teve acesso a shell durante toda a execução.

## Primeira coisa a fazer: o que esta auditoria não pôde verificar

Esta auditoria (Claude Cowork, 2026-09-13) leu todo o código-fonte relevante
mas não executou nada — sem `bun test`, sem `bun install`, sem `git`. Antes
de confiar em qualquer afirmação de "testado" ou "passa", rode:

```
bun install
bun test packages/**/*.test.ts
```

e confirme que os 8 casos de `auth.test.ts` e os 17 casos de
`tenant.test.ts` realmente passam como descrito em
[TEST-STRATEGY.md](./TEST-STRATEGY.md).

## Inconsistências de documentação do próprio projeto a corrigir

- `CLAUDE.md` referencia skills "Superpowers" (`code-review`, `run`) "quando
  disponível" — essas skills são específicas de ambiente Claude Code com
  plugin configurado; não estavam disponíveis nesta sessão Cowork. Confirmar
  se estão configuradas no seu ambiente Claude Code antes de assumir que vão
  funcionar.
- `AGENTS.md` (linha 4) e `README.md` (linha 15) descrevem a stack/o
  `packages/api` como usando Hono ("Servidor Hono"). Isso não reflete o
  código real — o servidor em execução (`src/index.ts`) é `Bun.serve` cru,
  sem Hono. Hono só aparece em `middleware/rbac.ts`, que está quebrado e não
  é usado. Recomenda-se atualizar essas duas linhas para refletir a
  realidade, ou formalizar a decisão de voltar a usar Hono se for esse o
  plano.
- `.ai-bootstrap/CLAUDE_BOOTSTRAP_REPORT.md` (sessão anterior, mesmo dia)
  afirma RBAC testado — não confirmado, ver
  [bootstrap-anterior-claude-code.md](../../.ai/memory/topics/bootstrap-anterior-claude-code.md).
  Tratar claims de "testado" em relatórios anteriores com cautela até
  verificação direta do arquivo de teste.

## Decisão que precisa ser tomada antes de escrever mais rotas

Ver [adr/0002-tres-sistemas-servidor-decisao-pendente.md](./adr/0002-tres-sistemas-servidor-decisao-pendente.md).
Esta auditoria não tomou essa decisão — só documentou a situação e recomenda
o Sistema B como base técnica.

## Incidente a conhecer antes de tocar em `.ai/memory/`

Durante esta auditoria, `.ai/memory/MEMORY.md` foi sobrescrito sem leitura
prévia (o arquivo já existia, criado por uma sessão Claude Code anterior no
mesmo dia). O conteúdo anterior não pôde ser recuperado (sem Git no
projeto). Detalhe completo em
[bootstrap-anterior-claude-code.md](../../.ai/memory/topics/bootstrap-anterior-claude-code.md).
Lição registrada para não se repetir: sempre `Read` antes de sobrescrever
qualquer arquivo de memória, mesmo em reorganização de índice.

## Recomendação imediata de maior valor

Inicializar Git neste projeto (`git init` + primeiro commit) antes de
qualquer mudança de código — hoje não há nenhum `.git` em `cav-crm`, o que
significa zero histórico e zero possibilidade real de rollback.

## Onde encontrar o resto

- Arquitetura completa: [SYSTEM-ARCHITECTURE.md](./SYSTEM-ARCHITECTURE.md)
- Modelo de dados: [DATA-MODEL.md](./DATA-MODEL.md)
- Segurança: [SECURITY-AND-PERMISSIONS.md](./SECURITY-AND-PERMISSIONS.md)
- Testes: [TEST-STRATEGY.md](./TEST-STRATEGY.md)
- Roadmap: [ROADMAP.md](./ROADMAP.md)
- Memória local por tópico: `.ai/memory/topics/` (convenção do próprio
  projeto, distinta desta pasta `docs/architecture/`)
