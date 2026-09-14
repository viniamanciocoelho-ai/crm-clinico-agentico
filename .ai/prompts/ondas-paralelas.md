# Ondas Paralelas

**Fonte**: Vibe Coding Toolkit (adaptado)
**Objetivo**: Paralelizar tarefas independentes para economizar tempo

## Quando usar
- Múltiplos agentes trabalhando em arquivos diferentes
- Tasks sem dependência entre elas
- Feature grande com componentes isolados

## Quando não usar
- Tarefas que compartilham estado
- Mudanças que precisam ser serializadas (DB migrations)
- Quando token budget é crítico (melhor serial)

## Padrão
1. Identifique conjuntos disjuntos de arquivos
2. Resolva dependências entre waves
3. Lance wave 1 (paralelo)
4. Espere conclusão, valide
5. Lance wave 2, etc

## Exemplo CAV CRM
- **Wave 1**: Schema + seed (paralelo: usuarios, procedimentos, insumos)
- **Wave 2**: Endpoints de read (paralelo: GET /procedimentos, GET /profissionais)
- **Wave 3**: Validação integrada (serial, depende de wave 2)

## Limite
- Máx 3-4 agentes por wave
- Sempre integração centralizada depois
- Fallback para serial se bloqueado
