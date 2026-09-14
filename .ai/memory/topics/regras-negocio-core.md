# Regras de negócio já implementadas em packages/api/src/lib/

Confirmado por leitura direta. Qualidade de implementação é alta; o problema é
que nada disso está conectado a uma rota HTTP ainda (ver [[status-fases]]).

## Agendamento — `agenda.ts`

Três regras anti-conflito nesta ordem: expediente (respeita horário de
funcionamento por dia da semana + bloqueios de agenda de profissional/sala),
slot do profissional, slot da sala/recurso. O bloco reservado inclui tempo de
preparo e limpeza antes/depois do procedimento — não é só a duração do
atendimento. `horariosLivres()` gera os horários realmente livres testando
`validarAgendamento` por tentativa — usado pelo agente de IA para nunca
inventar um horário.

## Atendimento e efeitos contábeis — `contabil.ts`

5 status fixos com efeito determinístico, sem exceção:
`concluido` (receita + baixa de estoque pela ficha técnica),
`brinde` (sem receita, mas conta custo e baixa estoque),
`reembolsado` (estorna receita + devolve ao estoque),
`cancelado` e `falta` (nenhum movimento financeiro ou de estoque).
Custo de insumos vem sempre da ficha técnica real (`ficha_tecnica_itens` +
`insumos`) — "nunca inventa: se não há ficha, custo 0".

## Agente de IA — `agente.ts`

Regra dura documentada no próprio código: "o agente só afirma o que existe no
banco daquela organização". Sem chamada a LLM externa nesta fase — é
determinístico, monta texto a partir do que o banco devolveu. Ações:
consultar procedimentos/preço/horários, criar/remarcar/cancelar agendamento,
cadastrar cliente, escalar para humano.

Escalada automática por regex em 4 categorias: pedido explícito de humano,
reclamação, caso clínico/urgência (dor, sangramento, infecção, febre — nunca
tenta responder clinicamente), assunto fora do escopo (convênio/plano de
saúde). Toda ação da IA é logada em `ia_acoes_log` com `autor_tipo = "ia"`,
dados de entrada e decisão em JSON, sucesso/erro.

## O que falta para isso virar produto

Nenhuma rota HTTP chama essas funções ainda. Não há integração real com
WhatsApp/Meta Cloud API (o módulo é agnóstico de canal, recebe telefone como
string). O ponto de plugue para um LLM externo existe apenas como comentário
de intenção, não como código.
