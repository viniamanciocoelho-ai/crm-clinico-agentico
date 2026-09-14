/**
 * Tipos das respostas da API real (`packages/api/src/routes/*`).
 *
 * Não há geração automática de tipos neste repositório: o contrato é REST puro,
 * então cada interface aqui é o espelho MANUAL do `json({...})` devolvido pela
 * rota correspondente. Toda propriedade foi conferida contra o handler e contra
 * `packages/db/ddl.ts` — nenhum campo foi inventado. Onde a API não devolve um
 * dado, ele simplesmente não existe aqui (o front calcula ou desabilita a ação).
 */

/* ───────────────────────── Domínio compartilhado ───────────────────────── */

/** Status de agendamento aceitos por `PATCH /agenda/:id/status` + `remarcado`. */
export type StatusAgendamento =
  | "agendado"
  | "confirmado"
  | "cancelado_pelo_cliente"
  | "cancelado_pela_clinica"
  | "remarcado";

/** `EFEITOS` em `packages/api/src/lib/contabil.ts`. */
export type StatusAtendimento = "concluido" | "brinde" | "reembolsado" | "cancelado" | "falta";

export type StatusConversa = "com_ia" | "aguardando_humano" | "com_humano" | "encerrada";

/** `ETAPAS` em `packages/api/src/routes/clientes.ts`. */
export type EtapaLead =
  | "novo"
  | "em_conversa"
  | "qualificado"
  | "agendado"
  | "compareceu"
  | "fechado"
  | "perdido";

/** `CANAIS` em `packages/api/src/routes/clientes.ts`. */
export type CanalEntrada = "whatsapp" | "indicacao" | "instagram" | "presencial" | "telefone";

export interface Referencia {
  id: string;
  nome: string;
}

export interface ClienteResumo extends Referencia {
  telefone: string;
}

export interface ProfissionalResumo extends Referencia {
  cor: string | null;
}

export interface ProcedimentoResumo extends Referencia {
  duracao_min: number;
  preco: number;
}

/* ──────────────────────────────── Agenda ──────────────────────────────── */

export interface Agendamento {
  id: string;
  organizacao_id: string;
  cliente_id: string;
  profissional_id: string;
  sala_id: string | null;
  procedimento_id: string;
  /** Epoch em ms — todo instante da API é `unixepoch() * 1000`. */
  inicio: number;
  fim: number;
  inicio_bloqueio: number;
  fim_bloqueio: number;
  status: StatusAgendamento;
  origem: string;
  observacoes: string | null;
  lembrete_enviado_24h: boolean;
  lembrete_enviado_2h: boolean;
  remarcado_de_id: string | null;
  cliente: ClienteResumo | null;
  profissional: ProfissionalResumo | null;
  procedimento: ProcedimentoResumo | null;
  sala: Referencia | null;
}

export interface RespostaAgenda {
  agendamentos: Agendamento[];
  /** Presente quando o usuário tem `agenda:read_own` sem profissional vinculado. */
  aviso?: string;
}

export interface RespostaHorariosLivres {
  procedimento: ProcedimentoResumo;
  profissional_id: string;
  sala_id: string | null;
  /**
   * INSTANTES de início (epoch ms), não objetos: `horariosLivres` em
   * `packages/api/src/lib/agenda.ts` faz `livres.push(t)` com o timestamp do
   * slot. A duração sai de `procedimento.duracao_min`.
   */
  horarios: number[];
  timezone: string;
  aviso?: string;
}

/* ────────────────────────────── Atendimentos ────────────────────────────── */

export interface Atendimento {
  id: string;
  organizacao_id: string;
  agendamento_id: string | null;
  cliente_id: string;
  profissional_id: string;
  procedimento_id: string;
  status: StatusAtendimento;
  valor: number;
  custo_insumos: number;
  concluido_em: number | null;
  observacoes: string | null;
  criado_em: number;
  cliente: ClienteResumo | null;
  profissional: ProfissionalResumo | null;
  procedimento: ProcedimentoResumo | null;
  /** O efeito contábil vem do servidor: o front não recalcula a regra. */
  efeito: { receita: boolean; estoque: 1 | -1 | 0 };
}

export interface RespostaAtendimentos {
  atendimentos: Atendimento[];
  aviso?: string;
}

export interface MovimentacaoEstoque {
  id: string;
  insumo_id: string;
  atendimento_id: string | null;
  tipo: "entrada" | "saida";
  quantidade: number;
  motivo: string;
  criado_em: number;
  insumo_nome: string;
  unidade: string;
}

/** `GET /atendimentos/indicadores/no-show`. */
export interface IndicadorNoShow {
  por_profissional: {
    profissional: { nome: string } | null;
    total: number;
    faltas: number;
    taxa: number;
  }[];
  por_cliente: {
    cliente: { nome: string; telefone: string } | null;
    total: number;
    faltas: number;
    taxa: number;
  }[];
}

export interface InsumoEmFalta {
  id: string;
  nome: string;
  unidade: string;
  estoque_atual: number;
  estoque_minimo: number;
}

/* ──────────────────────────────── Clientes ──────────────────────────────── */

export interface Tag {
  id: string;
  nome: string;
  cor: string;
}

export interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  data_nascimento: string | null;
  origem_lead: string | null;
  lgpd_consentimento: boolean;
  lgpd_data: number | null;
  lgpd_canal: string | null;
  ativo: number;
  criado_em: number;
  tags: Tag[];
}

export interface EventoHistorico {
  tipo: "agendamento" | "atendimento" | "conversa" | "reativacao";
  quando: number;
  status: string;
  descricao: string;
  receita?: number;
  custo?: number;
}

export interface HistoricoCliente {
  eventos: EventoHistorico[];
  totais: {
    agendamentos: number;
    atendimentos: number;
    receita: number;
    custo_insumos: number;
    faltas: number;
    margem: number;
  };
  ultima_atividade: number | null;
  dias_sem_atividade: number | null;
}

export interface RespostaCliente {
  cliente: Cliente & { observacoes: string | null };
  historico: HistoricoCliente;
}

/**
 * `GET /clientes/segmentos?segmento=...`. Cada segmento devolve colunas
 * diferentes — o que é comum vem sempre, o resto é opcional.
 */
export type SegmentoCliente = "inativos" | "aniversariantes" | "com_pacote";

export interface RespostaSegmento {
  segmento: SegmentoCliente;
  /** Só em `inativos`. */
  dias?: number;
  /** Só em `aniversariantes`. */
  mes?: number;
  clientes: {
    id: string;
    nome: string;
    telefone: string;
    ultima_atividade?: number;
    data_nascimento?: string | null;
    valor_pacote?: number;
    adquirido_em?: number;
  }[];
}

export interface MotivoPerda {
  id: string;
  descricao: string;
  ativo?: number;
}

export interface Lead {
  id: string;
  organizacao_id: string;
  cliente_id: string | null;
  nome: string | null;
  telefone: string;
  etapa: EtapaLead;
  canal_entrada: CanalEntrada;
  atendido_por_tipo: "ia" | "humano";
  motivo_perda_id: string | null;
  observacao_perda: string | null;
  primeira_resposta_em: number | null;
  ultima_interacao_em: number | null;
  criado_em: number;
  /** Vem do LEFT JOIN em `GET /leads`. */
  motivo_perda: string | null;
  cliente_nome: string | null;
}

/* ──────────────────────────────── Catálogo ──────────────────────────────── */

export interface Procedimento {
  id: string;
  nome: string;
  duracao_min: number;
  preco: number;
  ativo: number;
  descricao_publica: string | null;
}

export interface ProcedimentoCompleto extends Procedimento {
  profissionais: { id: string; nome: string; especialidade: string | null; cor: string | null }[];
  recursos: {
    id: string;
    sala_id: string;
    tempo_preparo_min: number;
    tempo_limpeza_min: number;
    sala_nome: string;
    tipo: string;
  }[];
  ficha_tecnica: {
    id: string;
    insumo_id: string;
    quantidade: number;
    insumo_nome: string;
    unidade: string;
    custo_unitario: number;
  }[];
}

export interface Bloqueio {
  inicio: number;
  fim: number;
  motivo: string;
}

export interface Profissional {
  id: string;
  nome: string;
  /** A tabela `profissionais` NÃO tem coluna de registro em conselho. */
  especialidade: string | null;
  cor: string | null;
  ativo: number;
  usuario_id: string | null;
  /** JSON cru, como gravado por `POST /agenda/bloqueios`. */
  bloqueios_agenda: string | null;
}

export interface Sala {
  id: string;
  nome: string;
  tipo: "sala" | "equipamento";
  ativo: number;
  bloqueios_agenda: string | null;
}

export interface Insumo {
  id: string;
  nome: string;
  unidade: string;
  custo_unitario: number;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: number;
}

/* ──────────────────────────────── Conversas ──────────────────────────────── */

export interface ConversaLista {
  id: string;
  canal: string;
  telefone: string;
  status: StatusConversa;
  motivo_escalada: string | null;
  ultima_mensagem_em: number | null;
  criado_em: number;
  cliente_id: string | null;
  lead_id: string | null;
  cliente_nome: string | null;
  ultima_mensagem: string | null;
  total_mensagens: number;
}

export interface Mensagem {
  id: string;
  remetente_tipo: "cliente" | "ia" | "humano";
  remetente_id: string | null;
  conteudo: string;
  criado_em: number;
}

export interface RespostaConversa {
  conversa: {
    id: string;
    organizacao_id: string;
    cliente_id: string | null;
    lead_id: string | null;
    canal: string;
    telefone: string;
    status: StatusConversa;
    motivo_escalada: string | null;
    ultima_mensagem_em: number | null;
    criado_em: number;
  };
  cliente: ClienteResumo | null;
  mensagens: Mensagem[];
}

export interface AcaoIa {
  id: string;
  autor_tipo: "ia";
  conversa_id: string | null;
  tipo_acao: string;
  dados_entrada: string | null;
  dados_decisao: string | null;
  sucesso: number;
  erro: string | null;
  criado_em: number;
}

/* ───────────────────────── Painel (só agregados) ───────────────────────── */

export interface Periodo {
  de: number;
  ate: number;
}

export interface PainelResumo {
  periodo: Periodo;
  atendimentos: {
    total: number;
    por_status: Record<string, { status: string; quantidade: number; valor: number; custo: number }>;
  };
  financeiro: { receita: number; custo_insumos: number; margem: number; ticket_medio: number };
  agendamentos: {
    total: number;
    por_status: Record<string, number>;
    cancelados: number;
    taxa_cancelamento: number;
    taxa_no_show: number;
  };
  conversas: { total: number; aguardando_humano: number };
  agente_ia: { tipo_acao: string; quantidade: number }[];
}

export interface PainelFunil {
  periodo: Periodo;
  por_etapa: Partial<Record<EtapaLead, number>>;
  motivos_perda: { id: string; descricao: string; quantidade: number }[];
  por_canal: { canal_entrada: string | null; quantidade: number }[];
  por_atendido_por_tipo: { atendido_por_tipo: "ia" | "humano"; quantidade: number }[];
  clientes_por_origem: { origem_lead: string; quantidade: number }[];
}

export interface PainelClientes {
  periodo: Periodo;
  novos: number;
  recorrentes: number;
  inativos: number;
  dias_para_inatividade: number;
  top_clientes: {
    id: string;
    nome: string;
    telefone: string;
    atendimentos: number;
    receita: number;
    ultimo_atendimento: number | null;
  }[];
  reativacoes: { disparadas: number; retornaram: number; taxa_retorno: number };
}

export interface PainelProcedimentos {
  periodo: Periodo;
  procedimentos: {
    id: string;
    nome: string;
    preco_catalogo: number;
    quantidade: number;
    receita: number;
    custo: number;
    faltas: number;
  }[];
}

export interface PainelProfissionais {
  periodo: Periodo;
  profissionais: {
    id: string;
    nome: string;
    especialidade: string | null;
    cor: string | null;
    atendimentos: number;
    concluidos: number;
    faltas: number;
    receita: number;
    custo: number;
    margem: number;
    taxa_no_show: number;
  }[];
}

export interface PainelOcupacao {
  periodo: Periodo;
  profissionais: {
    id: string;
    nome: string;
    agendamentos: number;
    /** Soma de `fim - inicio` em MILISSEGUNDOS, apesar do nome da coluna. */
    minutos_ocupados: number;
    cancelados: number;
    remarcados: number;
  }[];
}

/* ─────────────────────── Configuração do agente/org ─────────────────────── */

/**
 * `config_agente_ia` é um blob JSON opaco para a API: `PUT /agente/config` só
 * valida que é objeto ou null, nunca os subcampos. O shape abaixo é a convenção
 * que ESTE front grava e lê — não é validado pelo servidor.
 */
export interface ConfigAgenteIa {
  ativo?: boolean;
  nome_exibicao?: string;
  canal?: string;
  tom?: string;
  pode_agendar?: boolean;
  pode_remarcar?: boolean;
  pode_cancelar?: boolean;
  escalar_apos_mensagens?: number;
  horario_atendimento_ia?: string;
}

/** Faixas por dia da semana: `{ "1": [["08:00","18:00"]] }`, 0=domingo. */
export type HorarioFuncionamento = Record<string, [string, string][]>;

export interface RespostaConfigAgente {
  organizacao_id: string;
  nome: string;
  timezone: string;
  reativacao_dias: number;
  config_agente_ia: ConfigAgenteIa | null;
  horario_funcionamento: HorarioFuncionamento | null;
}
