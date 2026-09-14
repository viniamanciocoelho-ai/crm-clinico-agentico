# DATA-MODEL.md — CAV CRM

Fonte: `packages/db/schema.ts` (409 linhas, lido na íntegra em 2026-09-13).
Drizzle ORM sobre `bun:sqlite`. 24 tabelas, todas multi-tenant via
`organizacao_id: text().notNull()`.

## Convenções do schema

- Todas as tabelas têm `id: text().primaryKey()` gerado por
  `crypto.randomUUID()` (client-side, não autoincrement do SQLite).
- Todas as tabelas de negócio têm `organizacao_id` e pelo menos um índice que
  o inclui — isolamento de tenant reforçado também no nível de índice, não só
  de query.
- `criado_em` via helper `ts()`: `integer(mode: "timestamp")`, default
  `unixepoch() * 1000` (milissegundos), sempre `notNull()`.
- Campos JSON são armazenados como `text()` cru (ex.: `horario_funcionamento`,
  `config_agente_ia`, `bloqueios_agenda`) — sem validação de schema JSON no
  nível do banco, validação (se houver) fica a cargo da aplicação.
- Comentários no schema original marcam a "fase" de produto a que cada grupo
  de tabelas pertence (Fase 2 a Fase 8) — sinal de que o schema foi desenhado
  para todo o roadmap de uma vez, mesmo que a API ainda não exponha a maior
  parte dele. Ver [ROADMAP.md](./ROADMAP.md).

## Tabelas por domínio

### Tenant e identidade

- **`organizacoes`** — a própria organização/tenant. `organizacao_id` é único
  e é o valor usado como chave de particionamento em todas as outras tabelas
  (não é o `id` primário desta tabela — são campos distintos). Guarda
  `horario_funcionamento` (JSON), `config_agente_ia` (JSON),
  `reativacao_dias` (default 90), `timezone` (default
  `America/Sao_Paulo`).
- **`usuarios`** — login. `role` é texto livre (validado contra o enum
  `RoleType` só na aplicação, não via `CHECK` no schema). `senha_hash` via
  SHA-256 (ver [SECURITY-AND-PERMISSIONS.md](./SECURITY-AND-PERMISSIONS.md)).
- **`sessoes`** — declarada no schema, mas a autenticação real via JWT
  (`lib/auth.ts`) é stateless — não foi confirmado nenhum código que escreva
  nesta tabela. Possível tabela desenhada para uma estratégia de sessão
  server-side ainda não implementada, ou vestígio de uma decisão anterior.
  Vale confirmar com o time antes de assumir que está em uso.

### Catálogo e recursos (comentário original: "Fase 2")

`profissionais` (com `bloqueios_agenda` JSON para férias/manutenção),
`salas` (tipo `sala|equipamento`, também com `bloqueios_agenda`),
`procedimentos` (duração + preço), `procedimento_profissionais` (M:N),
`procedimento_recursos` (liga procedimento a sala, com
`tempo_preparo_min`/`tempo_limpeza_min` — insumo direto do motor anti-conflito
de agenda), `insumos` (estoque com `estoque_atual`/`estoque_minimo`),
`ficha_tecnica_itens` (M:N procedimento↔insumo com quantidade — base da baixa
automática de estoque).

### CRM de clientes e leads ("Fase 5")

- **`clientes`** — índice único composto `(organizacao_id, telefone)`, chave
  de deduplicação para o canal WhatsApp. Campos LGPD dedicados
  (`lgpd_consentimento`, `lgpd_data`, `lgpd_canal`).
- **`tags`**, **`cliente_tags`** (M:N), **`motivos_perda`**.
- **`leads`** — `etapa` é texto livre com valores esperados documentados em
  comentário (`novo|em_conversa|qualificado|agendado|compareceu|fechado|perdido`),
  `atendido_por_tipo` (`ia|humano`), `canal_entrada`. `cliente_id` nullable —
  um lead pode existir antes de virar cliente.

### Agenda ("Fase 3")

**`agendamentos`** — além de `inicio`/`fim`, tem `inicio_bloqueio`/
`fim_bloqueio` que já incorporam tempo de preparo/limpeza do recurso
(`procedimento_recursos`). Três índices dedicados a conflito
(`agendamentos_org_data_idx`, `agendamentos_prof_idx`,
`agendamentos_sala_idx`), alinhados com as três regras do motor em
`lib/agenda.ts` (ver
[regras-negocio-core.md](../../.ai/memory/topics/regras-negocio-core.md)).
`status` é texto livre
(`agendado|confirmado|cancelado_pelo_cliente|cancelado_pela_clinica|remarcado`).
`remarcado_de_id` permite rastrear cadeia de remarcações.

### Atendimento e contábil ("Fase 4")

- **`atendimentos`** — `status` (`concluido|brinde|reembolsado|cancelado|falta`)
  é o gatilho dos 5 efeitos contábeis fixos em `lib/contabil.ts`. Guarda
  `valor` e `custo_insumos` separadamente (margem calculável por atendimento).
  `agendamento_id` nullable — um atendimento pode não ter vindo de um
  agendamento formal.
- **`movimentacoes_estoque`** — `tipo` (`saida|entrada`), ligada
  opcionalmente a `atendimento_id`.
- **`pagamentos`** — `forma` (`dinheiro|pix|credito|debito|pacote`), `status`
  (`pago|estornado|pendente`), ligado opcionalmente a `atendimento_id`.

### Conversas e IA ("Fase 6" e "Fase 7")

- **`conversas`** — `status` (`com_ia|aguardando_humano|com_humano|encerrada`),
  `motivo_escalada`, pode referenciar `cliente_id` ou `lead_id` (nullable —
  conversa pode começar antes de virar lead qualificado).
- **`mensagens`** — `remetente_tipo` (`cliente|ia|humano`).
- **`ia_acoes_log`** — registra toda decisão do agente de IA
  (`dados_entrada`, `dados_decisao`, `sucesso`, `erro`), consistente com a
  regra "toda ação do agente é logada" documentada em
  [regras-negocio-core.md](../../.ai/memory/topics/regras-negocio-core.md).

### Reativação e jobs ("Fase 8")

`reativacoes_log` (dispara após `reativacao_dias` sem atendimento concluído,
rastreia se o cliente retornou), `jobs_execucoes` (log genérico de execução
de job agendado, com duração e erro).

## O que o schema não cobre (ausência confirmada, não inferida)

Não há tabela de auditoria genérica (além de `ia_acoes_log`, que é específica
do agente de IA) para ações humanas via painel — se houver requisito de
trilha de auditoria para usuários humanos, não está neste schema. Não há
tabela de configuração de planos/billing do próprio SaaS (cobrança da clínica
pelo uso do CAV CRM) — consistente com o produto ainda não ter camada de
billing, ver [PRODUCT-SPEC.md](./PRODUCT-SPEC.md).

## Migração

`migrate.ts` aplica DDL bruto idempotente (`CREATE TABLE IF NOT EXISTS`) via
`bun:sqlite`, **não** usa o fluxo `drizzle-kit generate`/`migrate` apesar de
`drizzle.config.ts` declarar `out: "./migrations"`. Não foi possível
confirmar nesta sessão (sem shell) se `./migrations` já contém algum arquivo
gerado historicamente. Risco prático: se o DDL manual em `migrate.ts` divergir
do `schema.ts` do Drizzle, os tipos TypeScript e o schema real do banco podem
dessincronizar silenciosamente — vale um script de verificação futuro que
compare os dois.
