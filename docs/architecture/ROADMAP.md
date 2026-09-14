# ROADMAP.md — CAV CRM

Atualizado em 2026-09-14.

## Implementado na API

- Isolamento de tenant, autenticação e RBAC.
- Catálogo, agenda, atendimento/estoque, CRM, conversas, agente, jobs, painel
  e rotas de demo registrados no servidor.
- Controles de erro, logs sanitizados de ações da IA e limite de taxa para
  endpoints públicos.

## Próximos itens técnicos

1. Adicionar garantias de concorrência distribuída para conversa aberta e
   disponibilidade de agenda, caso a API passe a operar em múltiplos processos.
2. Substituir o controle de limite em memória por armazenamento compartilhado
   antes de escalar horizontalmente.
3. Cobrir as rotas restantes com testes HTTP e acrescentar testes do frontend.
4. Definir e implementar a integração de mensageria externa somente após
   contrato e requisitos de privacidade aprovados.
5. Definir uma estratégia de migration incremental antes de qualquer evolução
   que altere o banco persistente.
