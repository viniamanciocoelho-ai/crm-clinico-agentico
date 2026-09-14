# COSTS-AND-OPERATIONS.md — CAV CRM

Base: leitura de todo o repositório em busca de configuração de deploy/infra.
Nenhum `Dockerfile`, `docker-compose`, `fly.toml`, `vercel.json`,
`railway.json`, `Procfile` ou workflow de CI/CD foi encontrado em nenhum
nível de `cav-crm` (busca por padrão de arquivos, resultado vazio fora de
`node_modules`). Este documento descreve o que existe operacionalmente hoje,
não um plano de deploy — não há um plano de deploy documentado no
repositório.

## Estado de execução hoje

- **Ambiente**: local apenas. `bun run dev` roda `src/index.ts` na porta
  3001 (hardcoded no Sistema A) ou via `config.ts`'s `PORT`
  (`process.env.PORT || 3001`, usado só pelo Sistema B, que não está no ar).
- **Banco de dados**: SQLite de arquivo local (`dev.db`), via `bun:sqlite`.
  `node_modules` presente no disco confirma que `bun install` já foi
  executado nesta máquina em algum momento anterior a esta auditoria (esta
  sessão não teve acesso a shell para confirmar se o banco/dependências estão
  íntegros).
- **Turso**: declarado em `.env.example`
  (`TURSO_CONNECTION_URL`) mas vazio — sem conexão ativa, sem uso em produção
  configurado.
- **CI/CD**: nenhum encontrado.
- **Containerização**: nenhuma encontrada.
- **Variáveis de ambiente**: `.env.example` declara `DATABASE_URL`,
  `TURSO_CONNECTION_URL`, `API_PORT`, `NODE_ENV`. Não declara `JWT_SECRET`
  nem `PASSWORD_SALT` (usados com fallback hardcoded inseguro — ver
  [SECURITY-AND-PERMISSIONS.md](./SECURITY-AND-PERMISSIONS.md)). `README.md`
  menciona convenção `.env.local` (dev) e `.env.prod` (produção), mas nenhum
  desses arquivos foi encontrado versionado (esperado, já que conteriam
  segredos) nem há evidência de automação que os gere.

## Scripts declarados vs. reais (achado, não corrigido)

`packages/db/package.json` declara `migrate:dev: bun scripts/migrate-dev.ts`
e `seed: bun scripts/seed.ts`, mas os arquivos reais são
`packages/db/migrate.ts` e `packages/db/seed.ts`, direto na raiz do pacote,
sem pasta `scripts/`. Esses scripts provavelmente falham se executados via
`bun run migrate:dev`/`bun run seed` como declarados no `package.json` —
teria que ser confirmado com shell, o que esta sessão não teve.

## Custos

Não há como estimar custo de operação com informação real: sem definição de
onde o projeto seria hospedado, sem uso de Turso confirmado (que teria custo
por uso), sem qualquer serviço pago (ex.: API de IA para o agente, API de
WhatsApp/Meta Cloud) com chave ou SDK configurado no código. Qualquer
estimativa de custo neste momento seria invenção — não incluída aqui por
princípio (nenhuma alegação não verificada).

## Recomendações operacionais (não executadas, fora de escopo desta auditoria)

Antes de qualquer deploy: decidir qual dos três sistemas de servidor é a
base (ver ADR 0002), inicializar um repositório Git (hoje não existe nenhum
`.git` em `cav-crm`), definir `JWT_SECRET`/`PASSWORD_SALT` obrigatórios via
falha explícita em produção, decidir sobre Turso vs. SQLite de arquivo para
produção, e corrigir os scripts `migrate:dev`/`seed` do
`packages/db/package.json`.
