# SYSTEM-ARCHITECTURE.md — CAV CRM

Atualizado em 2026-09-14.

## Componentes

- `packages/api`: servidor Bun e roteador HTTP próprio.
- `packages/db`: schema Drizzle, DDL SQLite e cliente local.
- `packages/shared`: sessão, roles, permissões e erros compartilhados.
- `packages/web`: aplicação React 19 + Vite.

## Fluxo HTTP

`src/index.ts` inicializa SQLite, garante o schema local, registra as famílias
de rota e entrega tudo a `criarHandler`.

O roteador:

1. responde preflight CORS;
2. limita por IP as rotas públicas configuradas;
3. resolve JWT e `organizacao_id` nas rotas autenticadas;
4. verifica permissões;
5. chama o handler da rota e centraliza o mapeamento de erros.

As rotas registradas incluem health, auth, catálogo, agenda, atendimentos,
clientes/leads, conversas, agente, painel e demo.

## Isolamento de dados

`organizacao_id` vem do JWT autenticado. Query string, corpo, header e path
não podem substituí-lo. Consultas de recursos vinculados, como lead e cliente,
também validam a organização antes de gravar relações.

## Persistência e jobs

SQLite usa WAL e foreign keys. Jobs locais são iniciados pelo entrypoint. Não há
integração remota de banco ou provedor de mensageria configurada neste código.

## Segurança operacional

`JWT_SECRET` e `PASSWORD_SALT` são obrigatórios quando `NODE_ENV=production`.
Os logs de ações da IA redigem campos pessoais conhecidos antes de persistir.
O limitador por IP reside na memória do processo e, portanto, não substitui um
controle distribuído em implantação horizontal.
