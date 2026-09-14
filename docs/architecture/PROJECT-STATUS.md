# PROJECT-STATUS.md — CAV CRM

Atualizado em 2026-09-14 após auditoria de código e execução da suíte.

## Estado operacional

- `packages/api/src/index.ts` é o entrypoint em execução e registra health,
  autenticação, catálogo, agenda, atendimento, CRM, conversas, agente, painel
  e demo no roteador próprio.
- O roteador resolve `organizacao_id` exclusivamente pelo JWT, aplica RBAC e
  converte erros de domínio em respostas HTTP.
- O banco local é SQLite via `bun:sqlite`; Drizzle define o schema tipado e a
  DDL é aplicada localmente pelo projeto. Não há migration remota nesta base.
- O frontend continua separado em `packages/web`.

## Cobertura verificada

- Isolamento de tenant, path traversal, autenticação e limitação pública.
- Regressões de contrato para lead entre organizações, identidade de mensagens,
  transição de lead, agendamento em conflito e reembolso.
- Testes, typecheck e builds devem ser executados antes de qualquer publicação.

## Limites conhecidos

- O limitador por IP é local ao processo e não é distribuído.
- Não existe integração real de canal externo de mensageria.
- O projeto não possui script de lint dedicado.

Os relatórios de auditoria datados de 2026-09-13 descrevem um estado anterior e
devem ser lidos como histórico.
