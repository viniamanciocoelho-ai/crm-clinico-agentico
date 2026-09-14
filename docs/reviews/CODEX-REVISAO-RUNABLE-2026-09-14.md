# Revisão Codex da integração Runable

Data: 2026-09-14

## Identificação

- Repositório: `viniamanciocoelho-ai/crm-clinico-agentico`
- Branch recebida e mantida: `feat/runable-ui-final-2026-09-14`
- Base recebida: `main` em `6d516ddc058129c1f1efdcc3bc5b300a5e3726b4`
- Commit recebido do Runable: `91237921f88245343a31b51f24ec52f4fe96a46b`
- Commit final de código da revisão: `dc7e878`
- URL da branch: `https://github.com/viniamanciocoelho-ai/crm-clinico-agentico/tree/feat/runable-ui-final-2026-09-14`
- `main` não foi alterada nem recebeu merge.

O ZIP anexado foi usado como fonte oficial. A pasta `.git` incluída foi
inspecionada com hooks desabilitados por `core.hooksPath=NUL`. Havia apenas
hooks de exemplo do Git. `git fsck --full --no-reflogs` não encontrou corrupção.

## Escopo e arquitetura

Foram lidos integralmente `AGENTS.md`, `CLAUDE.md`, `.ai/memory/`,
`docs/architecture/` e `docs/reviews/`.

A comparação `main...9123792` mostrou 69 arquivos alterados, concentrados na
nova interface web, dependências, evidências visuais, `.env.example` e um ajuste
de typecheck da API. Não foram criadas migrations, tabelas, permissões, papéis
ou endpoints de negócio. A interface continuou consumindo as rotas REST
existentes. O isolamento continua derivando a organização exclusivamente do
JWT e das cláusulas SQL com `organizacao_id`.

Compatibilidade confirmada com:

- Bun `1.4.2`, versão oficial declarada em `packageManager`;
- Drizzle ORM instalado `0.31.4`, compatível com o schema e o typecheck atuais;
- React `19`;
- Vite `5.4.21`.

## Problemas encontrados e evidências

### 1. Rotas de demonstração ativas fora do modo demo

Com `DEMO_MODE=false`, a API recebida ainda registrava `GET /demo`,
`POST /demo/reset` e as demais rotas públicas da demo. A reprodução retornou
HTTP `200` em `GET /demo`, apesar de `.env.example` e o relatório do Runable
afirmarem que a variável também controlava a API.

Risco: exposição das credenciais sintéticas e disponibilidade de um reset
público em ambiente real.

Correção: a API passou a registrar as cinco rotas somente quando
`DEMO_MODE=true`. Fora desse modo, `/demo` retorna `404` e `/health` não expõe
`organizacao_demo`.

Regressão adicionada em `packages/api/src/regressions.test.ts`.

### 2. Falha não JSON escapava do contrato de erro do frontend

Uma resposta HTML de proxy com HTTP `502` fazia `JSON.parse` lançar
`SyntaxError`, em vez de `ErroApi`. Isso impedia o tratamento uniforme de
falhas pela interface e podia produzir estados silenciosos ou mensagens
inconsistentes.

Correção: respostas não JSON agora são convertidas em `ErroApi`, tanto em
falhas HTTP quanto em respostas de sucesso inválidas.

Regressões adicionadas em `packages/web/src/lib/api.test.ts`.

### 3. Contratos manuais divergentes da API

Foram confirmadas as seguintes divergências:

- o hook de mensagem do cliente aceitava `ia` e `humano`, embora a API rejeite
  esses remetentes nessa rota;
- `RespostaConversa` declarava `assumido_por`, coluna inexistente no schema;
- `AcaoIa` declarava `cliente_id`, `entrada` e `saida`, enquanto a API devolve
  `autor_tipo`, `dados_entrada` e `dados_decisao`;
- movimentação de estoque declarava `motivo` anulável, mas a coluna é
  `NOT NULL`.

Correção: os tipos e o corpo enviado pelo frontend foram alinhados ao SQL e aos
handlers existentes, sem alterar o comportamento comercial.

## Validações funcionais

Todas as operações abaixo foram executadas contra uma API local e bancos
SQLite temporários, sem banco remoto, produção ou dados reais:

- login e validação de sessão em `/auth/eu`;
- cadastro de paciente com consentimento sintético;
- criação de lead e movimentação no funil;
- criação de procedimento, profissional, sala e insumo;
- vínculo de profissional, recurso e ficha técnica;
- movimentação de estoque;
- criação, confirmação, remarcação e cancelamento de agendamento;
- registro de atendimento concluído, pagamento e estorno;
- abertura de conversa, mensagem de cliente, escalada, resposta humana,
  devolução para IA e encerramento;
- login dos quatro perfis;
- RBAC representativo:
  - proprietário: acesso integral;
  - gerente: agenda, clientes e painel em HTTP `200`;
  - profissional: agenda em `200`, clientes e painel em `403`;
  - recepção: agenda e clientes em `200`, painel em `403`;
- concorrência: duas criações simultâneas no mesmo horário resultaram em
  `201` e `409`, sem agendamento duplicado;
- segundo tenant: listagem retornou zero clientes próprios, acesso por ID a
  cliente da demo retornou `404` e tentativa de forjar `organizacao_id` na
  query retornou `403`;
- `DEMO_MODE=true`: cinco rotas demo, seed funcional, quatro acessos e dados
  sintéticos;
- `DEMO_MODE=false`: zero rotas demo, `/demo` em `404`, health sem tenant demo
  e bundle sem textos, credenciais ou controles de demonstração.

## Desktop, mobile e acessibilidade

As sete telas foram abertas contra a API real local em `1440x1000` e
`390x844`: painel, agenda, clientes, atendimentos, conversas, catálogo e
configurações.

Resultado:

- nenhum overflow horizontal de documento;
- nenhum alerta de carregamento;
- nenhum erro ou warning no console;
- navegação e restrições visuais coerentes com proprietário, gerente,
  profissional e recepção;
- alvo menor que 32 px detectado apenas no link de salto
  `Ir para o conteúdo`, visualmente oculto até receber foco;
- as capturas entregues pelo Runable também foram inspecionadas.

## Validações finais

Estado final após o commit de código:

| Validação | Resultado |
|---|---|
| `bun install --frozen-lockfile` | passou; 118 instalações verificadas, sem mudanças |
| `bun run typecheck` | passou em API, DB e web |
| `bun test ./packages` | 47 passaram, 0 falharam, 109 asserções |
| `bun run build` | passou em API e web |
| `git diff --check` | passou |
| `git fsck --full --no-reflogs` | passou |
| arquivos acima de 50 MB | nenhum |
| endpoints usados pelo frontend sem rota correspondente | nenhum |

O build web gerou JavaScript de `537,10 kB` (`148,60 kB` gzip) e emitiu o
warning padrão do Vite para chunks acima de 500 kB.

## Segurança e dados

- Não foram encontrados segredos de alta confiança no conteúdo atual ou no
  histórico Git.
- `gitleaks`, `trufflehog` e `detect-secrets` não estavam instalados; foi
  executado scan local por padrões de chaves privadas e tokens de GitHub,
  OpenAI, AWS, Google e Slack, no working tree e em `git log -p --all`.
- E-mails e telefones encontrados pertencem a fixtures de teste, placeholders
  ou ao tenant sintético `demo-org-001`.
- Não há `.env` real, banco, log, cache, `node_modules` ou build rastreado.
- `.env.example` é somente um modelo e não contém credenciais utilizáveis.
- Nenhuma migration remota, deploy ou acesso a produção foi executado.

## Arquivos alterados pela revisão

- `packages/api/src/config.ts`
- `packages/api/src/index.ts`
- `packages/api/src/regressions.test.ts`
- `packages/api/src/routes/demo.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/api.test.ts`
- `packages/web/src/pages/conversas.tsx`
- `packages/web/src/queries/conversas.ts`
- `packages/web/src/queries/tipos.ts`
- `packages/web/tsconfig.json`
- `docs/reviews/CODEX-REVISAO-RUNABLE-2026-09-14.md`

## Riscos e bloqueios restantes

- O bundle web monolítico está acima do limiar de 500 kB. Recomenda-se
  code-splitting por rota em refinamento posterior, sem bloquear a integração.
- O projeto ainda não possui suíte E2E persistida no repositório; os ciclos
  funcionais desta revisão foram executados por HTTP e navegador contra banco
  temporário.
- Limitações já documentadas da API permanecem: não há gestão de usuários,
  listagem independente de pagamentos ou edição genérica de atendimento.
  A interface não inventa essas capacidades.
- O scan de segredos foi determinístico por padrões, mas não contou com uma
  ferramenta especializada instalada.

Não há bloqueio técnico comprovado para esta entrega.

## Recomendação

**APROVADO para retornar ao Runable e seguir para a etapa final de integração,
sem merge automático e sem deploy por esta revisão.**

A branch pode ser consumida diretamente pelo Runable. A `main` permanece em
`6d516ddc058129c1f1efdcc3bc5b300a5e3726b4`.
