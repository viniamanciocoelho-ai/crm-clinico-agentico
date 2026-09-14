import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const ts = (name: string) =>
  integer(name, { mode: "timestamp" }).default(sql`(unixepoch() * 1000)`).notNull();

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TENANTS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const organizacoes = sqliteTable("organizacoes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizacao_id: text("organizacao_id").unique().notNull(),
  nome: text("nome").notNull(),
  // Config de horÃ¡rio de funcionamento (JSON: { "1": [["08:00","18:00"]], ... })
  horario_funcionamento: text("horario_funcionamento"),
  // Config do agente IA (JSON)
  config_agente_ia: text("config_agente_ia"),
  // Regra de reativaÃ§Ã£o: N dias sem atendimento concluÃ­do
  reativacao_dias: integer("reativacao_dias").default(90).notNull(),
  timezone: text("timezone").default("America/Sao_Paulo").notNull(),
  criado_em: ts("criado_em"),
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// IDENTIDADE E RBAC
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const usuarios = sqliteTable(
  "usuarios",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    email: text("email").notNull(),
    senha_hash: text("senha_hash").notNull(),
    nome: text("nome").notNull(),
    role: text("role").notNull(),
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
    criado_em: ts("criado_em"),
  },
  (t) => ({ usuarios_org_idx: index("usuarios_org_idx").on(t.organizacao_id) }),
);

export const sessoes = sqliteTable(
  "sessoes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    usuario_id: text("usuario_id").notNull(),
    organizacao_id: text("organizacao_id").notNull(),
    token: text("token").unique().notNull(),
    expira_em: integer("expira_em", { mode: "timestamp" }).notNull(),
    criado_em: ts("criado_em"),
  },
  (t) => ({ sessoes_org_idx: index("sessoes_org_idx").on(t.organizacao_id) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CATÃLOGO E RECURSOS (Fase 2)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const profissionais = sqliteTable(
  "profissionais",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    usuario_id: text("usuario_id"), // nullable: profissional pode nÃ£o ter login
    nome: text("nome").notNull(),
    especialidade: text("especialidade"),
    cor: text("cor").default("#7c8f7a").notNull(),
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
    // Bloqueios de agenda (fÃ©rias, manutenÃ§Ã£o) â€” JSON: [{inicio, fim, motivo}]
    bloqueios_agenda: text("bloqueios_agenda"),
    criado_em: ts("criado_em"),
  },
  (t) => ({ profissionais_org_idx: index("profissionais_org_idx").on(t.organizacao_id) }),
);

export const salas = sqliteTable(
  "salas",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    nome: text("nome").notNull(),
    tipo: text("tipo").default("sala").notNull(), // sala | equipamento
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
    bloqueios_agenda: text("bloqueios_agenda"),
    criado_em: ts("criado_em"),
  },
  (t) => ({ salas_org_idx: index("salas_org_idx").on(t.organizacao_id) }),
);

export const procedimentos = sqliteTable(
  "procedimentos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    nome: text("nome").notNull(),
    duracao_min: integer("duracao_min").notNull(),
    preco: real("preco").notNull(),
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
    descricao_publica: text("descricao_publica"),
    criado_em: ts("criado_em"),
  },
  (t) => ({ procedimentos_org_idx: index("procedimentos_org_idx").on(t.organizacao_id) }),
);

export const procedimento_profissionais = sqliteTable(
  "procedimento_profissionais",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    procedimento_id: text("procedimento_id").notNull(),
    profissional_id: text("profissional_id").notNull(),
  },
  (t) => ({ proc_prof_org_idx: index("proc_prof_org_idx").on(t.organizacao_id) }),
);

export const procedimento_recursos = sqliteTable(
  "procedimento_recursos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    procedimento_id: text("procedimento_id").notNull(),
    sala_id: text("sala_id").notNull(),
    tempo_preparo_min: integer("tempo_preparo_min").default(0).notNull(),
    tempo_limpeza_min: integer("tempo_limpeza_min").default(0).notNull(),
  },
  (t) => ({ proc_rec_org_idx: index("proc_rec_org_idx").on(t.organizacao_id) }),
);

export const insumos = sqliteTable(
  "insumos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    nome: text("nome").notNull(),
    unidade: text("unidade").default("un").notNull(),
    custo_unitario: real("custo_unitario").default(0).notNull(),
    estoque_atual: real("estoque_atual").default(0).notNull(),
    estoque_minimo: real("estoque_minimo").default(0).notNull(),
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
    criado_em: ts("criado_em"),
  },
  (t) => ({ insumos_org_idx: index("insumos_org_idx").on(t.organizacao_id) }),
);

export const ficha_tecnica_itens = sqliteTable(
  "ficha_tecnica_itens",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    procedimento_id: text("procedimento_id").notNull(),
    insumo_id: text("insumo_id").notNull(),
    quantidade: real("quantidade").notNull(),
  },
  (t) => ({ ficha_org_idx: index("ficha_org_idx").on(t.organizacao_id) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CLIENTES / CRM (Fase 5)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const clientes = sqliteTable(
  "clientes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    nome: text("nome").notNull(),
    telefone: text("telefone").notNull(), // chave de dedup WhatsApp
    email: text("email"),
    data_nascimento: text("data_nascimento"), // YYYY-MM-DD
    origem_lead: text("origem_lead"),
    observacoes: text("observacoes"),
    // LGPD
    lgpd_consentimento: integer("lgpd_consentimento", { mode: "boolean" }).default(false).notNull(),
    lgpd_data: integer("lgpd_data", { mode: "timestamp" }),
    lgpd_canal: text("lgpd_canal"),
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
    criado_em: ts("criado_em"),
  },
  (t) => ({
    clientes_org_idx: index("clientes_org_idx").on(t.organizacao_id),
    clientes_org_tel_idx: uniqueIndex("clientes_org_tel_idx").on(t.organizacao_id, t.telefone),
  })
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    nome: text("nome").notNull(),
    cor: text("cor").default("#7c8f7a").notNull(),
  },
  (t) => ({ tags_org_idx: index("tags_org_idx").on(t.organizacao_id) }),
);

export const cliente_tags = sqliteTable(
  "cliente_tags",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    cliente_id: text("cliente_id").notNull(),
    tag_id: text("tag_id").notNull(),
  },
  (t) => ({ cliente_tags_org_idx: index("cliente_tags_org_idx").on(t.organizacao_id) }),
);

export const motivos_perda = sqliteTable(
  "motivos_perda",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    descricao: text("descricao").notNull(),
    ativo: integer("ativo", { mode: "boolean" }).default(true).notNull(),
  },
  (t) => ({ motivos_perda_org_idx: index("motivos_perda_org_idx").on(t.organizacao_id) }),
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    cliente_id: text("cliente_id"), // nullable â€” lead pode nÃ£o ser cliente ainda
    nome: text("nome"),
    telefone: text("telefone").notNull(),
    etapa: text("etapa").notNull(), // novo|em_conversa|qualificado|agendado|compareceu|fechado|perdido
    canal_entrada: text("canal_entrada").notNull(), // whatsapp|indicacao|instagram|presencial|telefone
    atendido_por_tipo: text("atendido_por_tipo").notNull(), // ia|humano
    motivo_perda_id: text("motivo_perda_id"),
    observacao_perda: text("observacao_perda"),
    primeira_resposta_em: integer("primeira_resposta_em", { mode: "timestamp" }),
    ultima_interacao_em: integer("ultima_interacao_em", { mode: "timestamp" }),
    criado_em: ts("criado_em"),
  },
  (t) => ({ leads_org_data_idx: index("leads_org_data_idx").on(t.organizacao_id, t.criado_em) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CATÃLOGO DE AGENDA (Fase 3)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const agendamentos = sqliteTable(
  "agendamentos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    cliente_id: text("cliente_id").notNull(),
    profissional_id: text("profissional_id").notNull(),
    sala_id: text("sala_id"),
    procedimento_id: text("procedimento_id").notNull(),
    inicio: integer("inicio", { mode: "timestamp" }).notNull(),
    fim: integer("fim", { mode: "timestamp" }).notNull(),
    // bloco ocupado incluindo preparo/limpeza
    inicio_bloqueio: integer("inicio_bloqueio", { mode: "timestamp" }).notNull(),
    fim_bloqueio: integer("fim_bloqueio", { mode: "timestamp" }).notNull(),
    status: text("status").notNull(), // agendado|confirmado|cancelado_pelo_cliente|cancelado_pela_clinica|remarcado
    origem: text("origem").notNull(), // ia|recepcao|indicacao|presencial|telefone
    observacoes: text("observacoes"),
    lembrete_enviado_24h: integer("lembrete_enviado_24h", { mode: "boolean" }).default(false).notNull(),
    lembrete_enviado_2h: integer("lembrete_enviado_2h", { mode: "boolean" }).default(false).notNull(),
    remarcado_de_id: text("remarcado_de_id"),
    criado_em: ts("criado_em"),
  },
  (t) => ({
    agendamentos_org_data_idx: index("agendamentos_org_data_idx").on(t.organizacao_id, t.inicio),
    agendamentos_prof_idx: index("agendamentos_prof_idx").on(t.organizacao_id, t.profissional_id, t.inicio),
    agendamentos_sala_idx: index("agendamentos_sala_idx").on(t.organizacao_id, t.sala_id, t.inicio),
  })
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ATENDIMENTO E REGRA CONTÃBIL (Fase 4)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const atendimentos = sqliteTable(
  "atendimentos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    agendamento_id: text("agendamento_id"),
    cliente_id: text("cliente_id").notNull(),
    profissional_id: text("profissional_id").notNull(),
    procedimento_id: text("procedimento_id").notNull(),
    // status: concluido|brinde|reembolsado|cancelado|falta
    status: text("status").notNull(),
    valor: real("valor").default(0).notNull(), // valor cobrado lÃ­quido
    custo_insumos: real("custo_insumos").default(0).notNull(),
    concluido_em: integer("concluido_em", { mode: "timestamp" }),
    observacoes: text("observacoes"),
    criado_em: ts("criado_em"),
  },
  (t) => ({ atendimentos_org_data_idx: index("atendimentos_org_data_idx").on(t.organizacao_id, t.criado_em) }),
);

export const movimentacoes_estoque = sqliteTable(
  "movimentacoes_estoque",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    insumo_id: text("insumo_id").notNull(),
    atendimento_id: text("atendimento_id"),
    tipo: text("tipo").notNull(), // saida|entrada
    quantidade: real("quantidade").notNull(),
    motivo: text("motivo").notNull(),
    criado_em: ts("criado_em"),
  },
  (t) => ({ mov_estoque_org_idx: index("mov_estoque_org_idx").on(t.organizacao_id) }),
);

export const pagamentos = sqliteTable(
  "pagamentos",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    atendimento_id: text("atendimento_id"),
    cliente_id: text("cliente_id").notNull(),
    valor: real("valor").notNull(),
    forma: text("forma").notNull(), // dinheiro|pix|credito|debito|pacote
    status: text("status").notNull(), // pago|estornado|pendente
    criado_em: ts("criado_em"),
  },
  (t) => ({ pagamentos_org_idx: index("pagamentos_org_idx").on(t.organizacao_id, t.criado_em) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CONVERSAS (Fase 6)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const conversas = sqliteTable(
  "conversas",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    cliente_id: text("cliente_id"), // nullable â€” lead ainda nÃ£o Ã© cliente
    lead_id: text("lead_id"),
    canal: text("canal").default("whatsapp").notNull(),
    telefone: text("telefone").notNull(),
    // com_ia|aguardando_humano|com_humano|encerrada
    status: text("status").notNull(),
    motivo_escalada: text("motivo_escalada"),
    ultima_mensagem_em: integer("ultima_mensagem_em", { mode: "timestamp" }),
    criado_em: ts("criado_em"),
  },
  (t) => ({ conversas_org_idx: index("conversas_org_idx").on(t.organizacao_id, t.criado_em) }),
);

export const mensagens = sqliteTable(
  "mensagens",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    conversa_id: text("conversa_id").notNull(),
    remetente_tipo: text("remetente_tipo").notNull(), // cliente|ia|humano
    remetente_id: text("remetente_id"),
    conteudo: text("conteudo").notNull(),
    criado_em: ts("criado_em"),
  },
  (t) => ({ mensagens_conversa_idx: index("mensagens_conversa_idx").on(t.organizacao_id, t.conversa_id, t.criado_em) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LOG DE AÃ‡Ã•ES DA IA (Fase 7)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ia_acoes_log = sqliteTable(
  "ia_acoes_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    autor_tipo: text("autor_tipo").default("ia").notNull(), // ia|humano|sistema
    tipo_acao: text("tipo_acao").notNull(),
    conversa_id: text("conversa_id"),
    dados_entrada: text("dados_entrada"),
    dados_decisao: text("dados_decisao"),
    sucesso: integer("sucesso", { mode: "boolean" }).default(true).notNull(),
    erro: text("erro"),
    criado_em: ts("criado_em"),
  },
  (t) => ({ ia_log_org_idx: index("ia_log_org_idx").on(t.organizacao_id, t.criado_em) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// REATIVAÃ‡ÃƒO (Fase 8)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const reativacoes_log = sqliteTable(
  "reativacoes_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    cliente_id: text("cliente_id").notNull(),
    disparado_em: integer("disparado_em", { mode: "timestamp" }).notNull(),
    retornou: integer("retornou", { mode: "boolean" }).default(false).notNull(),
    data_retorno: integer("data_retorno", { mode: "timestamp" }),
    criado_em: ts("criado_em"),
  },
  (t) => ({ reativacoes_org_idx: index("reativacoes_org_idx").on(t.organizacao_id, t.disparado_em) }),
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// JOBS (Fase 8)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const jobs_execucoes = sqliteTable(
  "jobs_execucoes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizacao_id: text("organizacao_id").notNull(),
    job: text("job").notNull(),
    resultado: text("resultado"),
    duracao_ms: integer("duracao_ms").default(0).notNull(),
    erro: text("erro"),
    criado_em: ts("criado_em"),
  },
  (t) => ({ jobs_org_idx: index("jobs_org_idx").on(t.organizacao_id, t.criado_em) }),
);
