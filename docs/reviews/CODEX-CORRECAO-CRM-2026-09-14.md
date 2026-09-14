# CODEX-CORRECAO-CRM-2026-09-14

## Origem

- Baseline recebido: `main` em `ac3e9f3` (`chore: importar baseline auditada do CRM Clinico`).
- Branch recebida para revisao: `review/codex-crm-2026-09-14`, com
  `458546b` (`feat(api): limitar taxa das rotas publicas da demo`).
- Nao houve migration remota, deploy, merge em `main` ou force push.

## Problemas encontrados e evidencias

| Area | Evidencia reproduzida | Correcao |
|---|---|---|
| Router | `GET /recursos/%` lancava `URIError` antes de produzir resposta HTTP. | Decode de parametro agora falha como rota nao encontrada. |
| Limite publico | Login nao tinha limite; nome de balde desconhecido falhava aberto. | Balde tipado para login e nomes invalidos deixam de ser aceitos. |
| JWT | Assinatura declarada HS256 nao usava HMAC; segredos tinham fallback permissivo em producao. | HMAC-SHA256 com comparacao constante; segredos obrigatorios em producao. |
| Tenant | Conversa de uma organizacao aceitava `lead_id` de outra. | Lead e validado pelo `organizacao_id` da sessao. |
| Auditoria de conversa | Endpoint de mensagem do cliente aceitava remetente `ia` ou `humano`. | Endpoint aceita somente `cliente`; fluxos de IA e humano permanecem separados. |
| CRM | Lead perdido mantinha motivo e observacao ao voltar para outra etapa. | Limpeza ocorre sempre ao sair de `perdido`. |
| Agendamento | Conflito de horario criava cliente sem agendamento. | Cliente, agendamento e lead sao criados na mesma transacao apos validacao. |
| Configuracao | JSON invalido de horario era tratado como configuracao ausente. | Falha explicita de configuracao. |
| Financeiro | Reembolso criava novo atendimento, mantinha o original concluido e podia ser repetido. | Reembolso atomico altera o original, estorna pagamento, reverte as saidas registradas e bloqueia repeticao. |
| Testes e docs | Teste de JWT expirado nao chamava o verificador; docs descreviam runtime e rotas obsoletos. | Testes comportamentais e documentos canonicos atualizados. |

## Testes

- Antes: baseline registrado com 35 testes aprovados; o teste de JWT expirado
  era falso positivo.
- Depois: `bun test ./packages` aprovado, 44 testes e 103 expectativas.
- `bun run typecheck` aprovado para API, DB e web.
- `bun run build` aprovado para API e web.
- Bun usado: `1.4.2`, conforme `packageManager`.
- Drizzle instalado pelo lockfile: `drizzle-orm 0.31.4` e
  `drizzle-kit 0.22.8`; o typecheck do schema passou.

## Scan e diff

- Scan de segredos em arquivos versionaveis: nenhuma credencial candidata.
- Scan de PII: somente fixtures de teste e contas sinteticas da demo; nenhum
  dado de paciente identificado.
- `git diff --check`: sem erro de whitespace.
- `.gitignore` ja exclui ambientes, bancos locais, builds, caches, logs e
  diretorios de ferramenta.

## Arquivos alterados

- API: autenticacao, router, limitador, agente, configuracao da organizacao,
  atendimento, clientes/leads e conversas.
- Testes: auth, limitador e `packages/api/src/regressions.test.ts`.
- Operacao: `.env.example`, `README.md`, `AGENTS.md` e documentos de
  arquitetura.

## Riscos restantes e decisoes pendentes

- Limite de taxa e garantia de conversa aberta sao locais ao processo; antes
  de operacao horizontal precisam de coordenacao compartilhada.
- A mudanca para HMAC invalida tokens emitidos pelo formato anterior; usuarios
  precisam autenticar novamente apos uma futura implantacao.
- Senhas ainda usam SHA-256 com salt, sem hash adaptativo; migracao de hash
  exige decisao de compatibilidade.
- Nao ha script de lint dedicado nem testes de frontend completos.
- Integracao externa de mensageria e estrategia de migrations incrementais
  permanecem pendentes.

## Commits criados

- `fix(api): fortalecer autenticacao e rotas publicas`
- `fix(crm): preservar integridade de tenant e financeiro`
- `docs: atualizar arquitetura e relatorio de correcao`

## Publicacao

- Branch: `review/codex-crm-2026-09-14`
- URL: https://github.com/viniamanciocoelho-ai/crm-clinico-agentico/tree/review/codex-crm-2026-09-14
- Recomendacao: aprovar para retorno ao Claude e refinamento no Runable, com
  os riscos restantes registrados acima.
