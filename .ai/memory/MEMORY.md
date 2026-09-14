# Memória do projeto — CAV CRM (cav-crm)

Índice. Detalhes completos em `topics/`. Convenção: só registrar aqui o que foi
verificado por leitura direta de código, nunca intenção ou plano.

Auditoria completa mais recente: 2026-09-13 (Claude Cowork, execução autônoma
do prompt mestre de arquiteto). Ver `docs/architecture/` e `.ai-bootstrap/` na
raiz de `projetos/` para os entregáveis completos dessa auditoria.

## Tópicos

- [Stack e estrutura](topics/stack-e-estrutura.md) — Bun workspaces, 4 pacotes, Turso declarado mas não usado, scripts do db quebrados.
- [Status real por fase](topics/status-fases.md) — Fase 0 sólida e testada; Fase 1 tem roteador pronto e testado mas nunca ligado ao servidor real.
- [Isolamento multi-tenant](topics/isolamento-multi-tenant.md) — regra JWT-only, defesa contra path traversal, vetores de ataque já cobertos em teste.
- [Regras de negócio core](topics/regras-negocio-core.md) — agenda anti-conflito, efeitos contábeis fixos por status, agente de IA determinístico.
- [Bugs e inconsistências](topics/bugs-e-inconsistencias.md) — 3 sistemas de servidor paralelos (só 1 no ar, sem tenant/RBAC), 7 outros achados.
- [Bootstrap anterior (Claude Code)](topics/bootstrap-anterior-claude-code.md) — relatório de sessão prévia no mesmo dia, discrepância RBAC "testado" vs. sem teste encontrado, e nota de transparência sobre este MEMORY.md ter sido sobrescrito sem leitura prévia.

## Nota de transparência

Este arquivo já existia (bootstrap Claude Code anterior) e foi sobrescrito sem
leitura prévia nesta sessão — ver detalhe em [[bootstrap-anterior-claude-code]].
Conteúdo anterior não recuperável (sem Git no projeto).

## Regra de uso desta memória

Não misturar contexto de outros produtos (CAV CORE, CAV RESTAURANTE, CRM
Clínico Agêntico genérico, CAV Comanda Valhalla) aqui — esta pasta é exclusiva
do `cav-crm`. Antes de propor mudança de código, reler o tópico relevante,
porque código pode ter mudado desde a última verificação.
