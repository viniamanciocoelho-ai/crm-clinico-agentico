# Isolamento multi-tenant — regras confirmadas

Implementado em `packages/api/src/middleware/tenant.ts`, testado em
`tenant.test.ts`. Este é o núcleo de segurança do projeto e está bem feito.

## Regra central

`organizacao_id` só pode vir do JWT autenticado (`resolveContext`), nunca de:
query string, header customizado (`X-Organizacao-Id`), corpo da requisição
(`assertBodyHasNoTenant`), ou path (inclusive `organizacao_id=` literal
embutido num segmento de path).

## Path traversal — detalhe técnico que vale lembrar

`new URL()` do runtime colapsa `../` antes que o código consiga inspecionar —
ou seja, checar `url.pathname` sozinho NÃO pega traversal. A defesa real olha
a string crua da requisição (`urlBruta`, antes do parser) segmento por
segmento, decodificando até duas vezes (pega `%2e%2e` e `%252e%252e`
duplo-encoded), e também aceita variantes com barra invertida.

## Vetores cobertos em teste (não reinventar, só reusar)

Query string, corpo, header customizado, path traversal (literal, no fim,
percent-encoded, duplo-encoded, backslash-encoded, backslash cru, na query
string, na query string encoded), traversal que sobrevive à normalização do
runtime, organizacao_id embutido no path. Também há um teste de não-regressão
para rota legítima com pontos no nome (`/api/v1.2/medicoes.relatorio`), para
não gerar falso positivo.

## Implicação para qualquer código novo

Toda rota nova de API deve passar pelo `resolveContext` antes de tocar no
banco, e nunca aceitar `organizacao_id` como parâmetro explícito vindo do
cliente — sempre `session.organizacao_id` do contexto resolvido.
