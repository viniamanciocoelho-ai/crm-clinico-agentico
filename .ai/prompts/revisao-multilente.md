# Revisão Multilente

**Fonte**: Vibe Coding Toolkit (adaptado)
**Objetivo**: Examinar mudanças por múltiplas dimensões (bugs, performance, teste, segurança) em paralelo

## Quando usar
- Depois de implementar feature complexa
- Antes de Merge Request
- Quando mudanças afetam múltiplos layers

## Quando não usar
- Typo fixes, 1-liner changes
- Draft PRs sem teste verde

## Execução
1. Divida mudanças em dimensões: correctness, security, performance, tests, architecture
2. Lance agente por dimensão (paralelo)
3. Agregue findings, priorize por severidade
4. Reporte com contexto (arquivo, linha, cenário)

## Limite: Segurança
- Nunca exponha secrets, tokens, URLs autenticadas
- Toda mudança em autenticação merece revisão aprofundada
