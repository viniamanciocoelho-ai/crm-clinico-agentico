# Brainstorm + Plano

**Fonte**: Vibe Coding Toolkit (adaptado)
**Objetivo**: Explorar design antes de implementação

## Quando usar
- Feature nova sem especificação detalhada
- Decisão arquitetural com múltiplas opções
- Refactor sem direção clara

## Quando não usar
- Código já decidido e pronto
- Bug fix simples
- Tarefa já planejada em sprint

## Execução
1. **Brainstorm**: 3-5 abordagens diferentes, prós/contras
2. **Decisão**: Escolha + trade-offs explícitos
3. **Plano**: Step-by-step, riscos, critério de sucesso
4. **Validação**: Teste rápido se viável

## Exemplo
- Brainstorm: JWT vs session vs OAuth
- Decisão: JWT (simples, stateless, não precisa de infra)
- Plano: Implementar geração, verificação, refresh
- Validação: Login endpoint verde antes de Fase 2
