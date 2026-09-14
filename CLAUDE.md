@AGENTS.md

## Claude Code — Instruções Específicas

### Memória local
- `.ai/memory/MEMORY.md` (índice, máx 130 linhas)
- `.ai/memory/topics/` (detalhes por assunto)

### Superpowers (quando disponível)
- Skill `code-review` para auditoria
- Skill `run` para executar dev server
- Nenhuma redundância com plugins

### Isolamento de tenant
**Crítico**: Todo acesso ao banco passa por middleware que injeta `organizacao_id` de JWT verificado. Nenhum outro vetor (query, body, header, path) pode sobrescrever.

Testes obrigatórios:
- Query string override bloqueado
- Body override bloqueado
- Header override bloqueado
- Path traversal bloqueado

### Modo operacional
- Autônomo: execute tudo que for reversível e seguro
- Pare somente em: senha, token interativo, privilégio admin, ação irreversível

### Fluxo de git e GitHub

**Nunca faça push direto na `main`.** Nem `--force`, nem em cima de commit alheio.
Toda mudança entra por branch própria e PR. A `main` só avança por merge revisado.

- Push de branch de trabalho: autorizado
- Abrir PR de branch → `main`: autorizado
- Ligar acompanhamento de CI no PR: autorizado
- Corrigir falha de CI commitando na própria branch: autorizado

Fora do escopo, mesmo com credencial disponível:
- Merge (inclui auto-merge) — quem decide é o humano
- Settings, colaboradores, webhooks, permissões do repositório
- Force-push e reescrita de histórico em qualquer branch

Nunca faça deploy nem aponte nada para banco de produção.

### Segredos
- Token/PAT vive no credential store do SO ou em variável de sessão — **nunca** em
  arquivo versionado, log, script ou corpo de PR
- Nada de repetir o valor do token de volta em conversa
- Prefira token *fine-grained*, limitado ao repositório, com escopo mínimo
  (`contents`, `pull_requests`) e validade curta
