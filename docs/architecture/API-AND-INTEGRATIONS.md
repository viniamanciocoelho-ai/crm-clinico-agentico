# API-AND-INTEGRATIONS.md — CAV CRM

Atualizado em 2026-09-14.

## Contrato comum

As rotas são registradas em `packages/api/src/index.ts` e usam a interface
`Rota` do roteador próprio. Rotas autenticadas recebem sessão derivada do JWT;
`organizacao_id` não é aceito como entrada, exceto no login.

| Classe | Status |
|---|---:|
| Credencial ausente ou inválida | 401 |
| Tentativa de forjar tenant ou permissão negada | 403 |
| Entrada inválida | 400 |
| Recurso ausente | 404 |
| Método não permitido | 405 |
| Conflito de agenda | 409 |
| Limite público excedido | 429 |

## Famílias de rota

| Área | Base |
|---|---|
| Health | `GET /health` |
| Autenticação | `/auth` |
| Catálogo | `/profissionais`, `/salas`, `/procedimentos`, `/insumos` |
| Agenda | `/agendamentos`, `/agenda` |
| Atendimento e estoque | `/atendimentos` |
| Clientes e leads | `/clientes`, `/leads` |
| Conversas | `/conversas` |
| Agente | `/agente` |
| Painel | `/painel` |
| Demo pública | `/demo` |

As rotas públicas têm limite por IP. `POST /auth/login` aceita somente a
organização necessária para autenticar e é limitada separadamente.

## Regras de integridade

- Relações por ID são verificadas dentro da organização da sessão.
- A rota de mensagens recebidas registra somente remetente `cliente`; respostas
  humanas e ações da IA usam fluxos próprios.
- Reembolso altera o atendimento original em transação, estorna pagamento,
  reverte as saídas de estoque efetivamente registradas e bloqueia repetição.

## Integrações externas

Não há webhook, cliente HTTP ou SDK de mensageria externo ativo. A persistência
atual é SQLite local; nenhuma migration remota é parte do fluxo da API.
