# TEST-STRATEGY.md — CAV CRM

Base: os dois únicos arquivos de teste do repositório, lidos na íntegra —
`packages/api/src/lib/auth.test.ts` (99 linhas, 8 casos) e
`packages/api/src/middleware/tenant.test.ts` (91 linhas, 17 casos). Confirmado
via `Glob **/*.test.ts` em `packages/` que não existe nenhum outro arquivo de
teste no projeto.

Esta seção não foi executada nesta auditoria (sem acesso a shell — ver
[PROJECT-STATUS.md](./PROJECT-STATUS.md)). Tudo abaixo é leitura estática do
código de teste, não confirmação de que os testes passam hoje. Recomenda-se
rodar `bun test packages/**/*.test.ts` assim que houver shell disponível.

## O que existe e o que genuinamente testa

### `auth.test.ts` — describe "Authentication" (4 casos)

- Hash e verificação de senha (round-trip correto/incorreto) — teste direto e
  sólido.
- Criação e verificação de JWT (round-trip completo) — teste direto e sólido.
- "should reject expired JWT" — **fraco**. Não chama `verifyJWT` sobre um
  token expirado; decodifica manualmente o payload e compara `exp < now`,
  com comentário explícito no código "Skip verification for this test since
  it's expired". O caminho de rejeição por expiração dentro da função real
  `verifyJWT` não tem cobertura.
- "should reject invalid JWT signature" — **sólido**. Adultera a assinatura
  de um token válido e chama `verifyJWT` de verdade, esperando `null`.

### `auth.test.ts` — describe "RBAC" (4 casos)

Verifica apenas o conteúdo estático do objeto `ROLE_PERMISSIONS` (um caso por
role: `PROPRIETARIO`, `GERENTE`, `PROFISSIONAL`, `RECEPCAO`). **Não exercita
nenhum middleware** — não chama `exigirPermissao`, não chama
`requireRole`/`requirePermission` de `rbac.ts`, não simula uma requisição com
role específica sendo aceita ou rejeitada. É um teste de "a constante tem os
valores que eu esperava", não um teste de comportamento de autorização.

### `tenant.test.ts` — 17 casos, o teste mais sólido do projeto

Cobre: injeção de sessão válida via Bearer; rejeição de `Authorization`
ausente; rejeição de token adulterado; 4 vetores de override
(query/body/header/path) todos rejeitados; 8 variantes de path traversal
rejeitadas (literal, no fim do path, percent-encoded, duplo-encoded, barra
invertida codificada, barra invertida crua, via query string, via query
string codificada); um teste de não-regressão que confirma que um path
legítimo com ponto não é falsamente bloqueado; um teste que demonstra
explicitamente por que a checagem precisa ler a URL bruta (`new URL()`
normaliza `../` antes que uma checagem pós-parsing pudesse vê-lo). Este é o
único conjunto de testes do projeto que testa comportamento real sob ataque,
não só estrutura de dados.

## O que não tem nenhum teste

- `middleware/rbac.ts` — sem teste (e está quebrado, ver
  [SECURITY-AND-PERMISSIONS.md](./SECURITY-AND-PERMISSIONS.md)).
- `middleware/permissoes.ts` (`exigirPermissao`, `permissaoConcedida`,
  `apenasPropriaAgenda`, `apenasPropriosAtendimentos`) — sem teste direto,
  apesar de ser o RBAC que efetivamente rodaria no Sistema B.
- `router.ts` (`criarHandler`) — sem teste de integração ponta a ponta (ex.:
  simular uma requisição HTTP completa passando pelo roteador). O que existe
  é teste unitário de `resolveContext` isoladamente.
- `lib/agenda.ts` (motor anti-conflito de 3 regras) — sem teste.
- `lib/contabil.ts` (5 efeitos contábeis fixos) — sem teste.
- `lib/agente.ts` (agente de IA determinístico) — sem teste.
- `lib/org.ts` (`carregarOrg`, `profissionalDoUsuario`) — sem teste.
- `src/index.ts` (Sistema A, o que roda de fato) — sem teste algum, apesar de
  ser o único código que atende requisições reais hoje.
- Qualquer coisa em `packages/web` ou `packages/db` (migração, seed) — sem
  teste.

## Discrepância com relatório anterior

`.ai-bootstrap/CLAUDE_BOOTSTRAP_REPORT.md` (sessão anterior de Claude Code,
mesmo dia) afirma "✅ RBAC (4 roles, permissões testadas)". Não há como essa
afirmação ser sustentada pelo estado de código encontrado nesta auditoria —
não existe arquivo de teste de RBAC, e o único teste com "RBAC" no nome
testa uma constante, não comportamento. Ver
[bootstrap-anterior-claude-code.md](../../.ai/memory/topics/bootstrap-anterior-claude-code.md).
Não foi possível determinar se a afirmação se refere a um teste manual não
persistido ou se está simplesmente incorreta — tratar como não confirmada.

## Recomendação de próximos testes (por ordem de risco coberto)

1. Teste de integração do Sistema B ponta a ponta (`criarHandler` recebendo
   uma `Request` completa) — hoje só existe teste unitário de peças
   isoladas.
2. Teste de comportamento de `exigirPermissao`/`permissaoConcedida` (RBAC de
   verdade, não só a constante).
3. Corrigir o teste de expiração de JWT para chamar `verifyJWT` de fato.
4. Teste de `lib/agenda.ts` — é a lógica de negócio com mais regras
   condicionais (3 regras de conflito) e zero cobertura hoje.
5. Teste de `lib/contabil.ts` — 5 efeitos fixos, transação atômica, zero
   cobertura.
