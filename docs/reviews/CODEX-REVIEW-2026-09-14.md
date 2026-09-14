# Auditoria tecnica - 2026-09-14

## Escopo

- Revisao de `packages/db/schema.ts`.
- Revisao de `packages/api/src/lib/agente.ts`.
- Compatibilidade de Bun, Drizzle ORM e Drizzle Kit.
- Testes, typecheck, builds e varredura de segredos/dados pessoais.
- Protecao dos artefatos locais antes da publicacao.

## Correcoes aplicadas

- Reparados 21 callbacks de indices SQLite que impediam o schema de compilar.
- Preservado o indice por `organizacao_id` em todas as tabelas afetadas.
- Sanitizados os payloads persistidos em `ia_acoes_log`, com redacao de campos pessoais e credenciais.
- Adicionado teste em SQLite em memoria para impedir regressao do log de PII.
- Atualizado `drizzle-kit` de 0.20.18 para 0.22.8, compativel com `drizzle-orm` 0.31.4.
- Declarado Bun 1.4.2 como gerenciador oficial do projeto.
- Adicionados tipos React 19 para o typecheck do frontend.
- Separados typecheck e build da API para manter artefatos fora de `src/`.
- Reforcado o `.gitignore` para ambientes, bancos, logs, builds, ferramentas e diagnosticos locais.

## Validacoes

- `bun test ./packages`: aprovado.
- `bun run typecheck`: aprovado.
- `bun run build`: aprovado.
- Drizzle generate em diretorio temporario: aprovado, 24 tabelas.
- Scan de chaves privadas, tokens GitHub, chaves AWS, JWTs e atribuicoes de segredo: sem ocorrencias candidatas.
- Scan de PII: sem CPF; ocorrencias de e-mail/telefone restritas a testes e dados explicitamente ficticios de demo.

## Observacao

O projeto nao possui configuracao ou script de lint dedicado. O controle estatico disponivel foi executado por TypeScript em todos os pacotes.
