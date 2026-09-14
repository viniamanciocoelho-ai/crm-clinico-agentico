# TEST-STRATEGY.md — CAV CRM

Atualizado em 2026-09-14.

## Comandos

```bash
bun test ./packages
bun run typecheck
bun run build
```

O repositório não possui script de lint dedicado; o typecheck é a validação
estática disponível.

## Cobertura atual

- `tenant.test.ts`: JWT, isolamento de `organizacao_id` e path traversal.
- `auth.test.ts`: senha, assinatura, adulteração e expiração de JWT.
- `limite.test.ts`: janelas por IP, escopo de balde e proxy confiável.
- `agente.test.ts`: redação de PII em logs de ações da IA.
- `regressions.test.ts`: roteamento malformado, limite de login, RBAC aplicado,
  tenant de lead, identidade de mensagem, limpeza de perda, atomicidade de
  agendamento, configuração JSON e reembolso idempotente.

## Lacunas prioritárias

- Testes HTTP de todas as rotas, não apenas dos contratos de maior risco.
- Concorrência entre processos para criação de conversa e agendamento.
- Testes de integração do frontend.
- Testes de jobs com relógio controlado.
