# Bootstrap de Memória

**Fonte**: Vibe Coding Toolkit (adaptado)
**Objetivo**: Documentar decisões duráveis para futuras sessões

## Quando usar
- Fim de sessão
- Bloqueios resolvidos que afetam próximas fases
- Stack decisions, padrões confirmados
- Riscos conhecidos

## Estrutura
1. **Fato** (o que é verdade agora)
2. **Por quê** (contexto, constraint, decisão)
3. **Como aplica** (próxima sessão, quando usar este fato)

## Exemplo
- **Fato**: Login JWT com Bun nativo (sem Hono)
- **Por quê**: Hono body parsing falha em Bun dev server
- **Como aplica**: Próximos endpoints usam fetch handler direto, não rota Hono

## Localização
- `.ai/memory/MEMORY.md` — índice, máx 130 linhas
- `.ai/memory/topics/*.md` — detalhe por assunto
- Tudo versionado, sem segredos

## Consolidação
A cada 5-10 sessões, revisar e mesclar tópicos repetidos, remover stale facts, atualizar estado
