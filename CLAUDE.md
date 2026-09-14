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
- Nenhuma ação de push, merge, deploy, banco de produção
