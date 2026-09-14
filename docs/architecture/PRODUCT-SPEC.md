# PRODUCT-SPEC.md — CAV CRM

Fonte primária: descrição em `README.md`/`AGENTS.md` (uma frase, verbatim:
"SaaS CRM com agente de IA para clínicas odontológicas, consultórios médicos
e SPAs"). Não existe um documento de especificação de produto mais detalhado
no repositório — este arquivo complementa a frase original com inferências
extraídas do schema de dados e da lógica de negócio implementada, marcando
claramente o que é inferido vs. o que é declarado.

## Declarado (fonte: README/AGENTS.md)

Produto: SaaS multi-tenant de CRM com agente de inteligência artificial.
Público-alvo: clínicas odontológicas, consultórios médicos e SPAs/estética.

## Inferido a partir do schema e da lógica de negócio (`packages/db/schema.ts`, `packages/api/src/lib/`)

Como não há um documento de produto além da frase acima, as capacidades
abaixo são reconstruídas a partir do que o código realmente modela — não são
uma lista de features confirmadas como "vendáveis" ou "priorizadas", apenas o
que a estrutura de dados e as regras de negócio implicam como escopo
pretendido.

### Agendamento com controle de recursos

`agendamentos` + `procedimento_recursos` + `profissionais`/`salas` sugerem um
produto que agenda não só profissional, mas também sala/equipamento, com
tempo de preparo e limpeza contabilizado automaticamente
(`inicio_bloqueio`/`fim_bloqueio`). Isso é mais sofisticado que uma agenda
simples de consultório — modela cenários como uma sala que precisa de
intervalo entre procedimentos (compatível com estética/SPA, onde equipamento
ou sala tem tempo de setup).

### Controle de estoque por ficha técnica

`insumos` + `ficha_tecnica_itens` + `movimentacoes_estoque` implicam baixa
automática de estoque por procedimento realizado — cada procedimento tem uma
"receita" de insumos consumidos, e a conclusão de um atendimento
(`atendimentos.status = concluido`) deveria (via `lib/contabil.ts`) desencadear
a baixa correspondente. Ver
[regras-negocio-core.md](../../.ai/memory/topics/regras-negocio-core.md).

### CRM com funil de leads e IA no WhatsApp

`leads` (com `etapa`, `canal_entrada`, `atendido_por_tipo`), `conversas`,
`mensagens` e `ia_acoes_log` implicam um funil comercial onde um agente de IA
conversa com leads/clientes via WhatsApp, pode agendar/confirmar/remarcar
diretamente, e escala para humano quando necessário
(`conversas.status = aguardando_humano`, `motivo_escalada`). A regra
determinística "nunca inventar dado fora do banco" (`lib/agente.ts`) é
central ao design de confiabilidade do agente — ver
[regras-negocio-core.md](../../.ai/memory/topics/regras-negocio-core.md).
Nenhuma integração de canal (Meta Cloud API/WhatsApp Business) foi encontrada
implementada — `conversas`/`mensagens` são genéricas o bastante para suportar
múltiplos canais no futuro (`canal` é campo texto livre, default
`"whatsapp"`), mas hoje não há código de integração real, só o modelo de
dados e a lógica de decisão.

### Reativação de clientes inativos

`organizacoes.reativacao_dias` (default 90) + `reativacoes_log` implicam uma
rotina (provavelmente um job agendado — ver `jobs_execucoes`) que identifica
clientes sem atendimento concluído há N dias e dispara uma ação de
reativação, registrando se o cliente retornou. Nenhum job real foi encontrado
implementado — só a tabela de log que um job usaria.

### LGPD

`clientes.lgpd_consentimento`/`lgpd_data`/`lgpd_canal` implicam requisito de
conformidade com a LGPD (consentimento de uso de dados do cliente), mas não
há rota ou lógica de exportação/exclusão de dados (direito de acesso/
portabilidade) implementada ainda.

## O que não está no schema nem no código (ausência, não é uma decisão negativa confirmada)

Billing/cobrança do próprio SaaS (planos, limites por organização, cobrança
recorrente) — nenhuma tabela ou lógica relacionada foi encontrada. Se este é
um requisito do produto, ainda não tem representação no código.
Multi-idioma/i18n — nenhuma estrutura de tradução encontrada. Relatórios/
dashboards — não há rota nem tabela de agregação dedicada além de índices
que poderiam suportar queries analíticas simples.

## Nota metodológica

Este documento existe para dar contexto de produto a quem for planejar
próximas fases, mas não substitui uma conversa direta com quem define o
roadmap comercial do CAV CRM — as inferências acima vêm exclusivamente da
estrutura técnica, não de nenhuma fonte de requisitos de negócio explícita
encontrada no repositório.
