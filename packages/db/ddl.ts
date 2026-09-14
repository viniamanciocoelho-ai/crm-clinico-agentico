/**
 * DDL única do sistema. Fica fora do script de migração porque dois caminhos
 * precisam dela: o `migrate.ts` (execução manual) e o seed da demo pública,
 * que roda dentro do servidor e não pode depender de um script externo ter
 * sido chamado antes. Duplicar CREATE TABLE nos dois lugares garantiria que
 * eles divergissem.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS organizacoes (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  horario_funcionamento TEXT,
  config_agente_ia TEXT,
  reativacao_dias INTEGER DEFAULT 90 NOT NULL,
  timezone TEXT DEFAULT 'America/Sao_Paulo' NOT NULL,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  email TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  role TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS usuarios_org_idx ON usuarios(organizacao_id);
CREATE UNIQUE INDEX IF NOT EXISTS email_org_idx ON usuarios(email, organizacao_id) WHERE ativo = 1;

CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  organizacao_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expira_em INTEGER NOT NULL,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS sessoes_org_idx ON sessoes(organizacao_id);

CREATE TABLE IF NOT EXISTS profissionais (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  usuario_id TEXT,
  nome TEXT NOT NULL,
  especialidade TEXT,
  cor TEXT NOT NULL DEFAULT '#7c8f7a',
  ativo INTEGER NOT NULL DEFAULT 1,
  bloqueios_agenda TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS profissionais_org_idx ON profissionais(organizacao_id);

CREATE TABLE IF NOT EXISTS salas (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'sala',
  ativo INTEGER NOT NULL DEFAULT 1,
  bloqueios_agenda TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS salas_org_idx ON salas(organizacao_id);

CREATE TABLE IF NOT EXISTS procedimentos (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  duracao_min INTEGER NOT NULL,
  preco REAL NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  descricao_publica TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS procedimentos_org_idx ON procedimentos(organizacao_id);

CREATE TABLE IF NOT EXISTS procedimento_profissionais (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  procedimento_id TEXT NOT NULL,
  profissional_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proc_prof_org_idx ON procedimento_profissionais(organizacao_id);

CREATE TABLE IF NOT EXISTS procedimento_recursos (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  procedimento_id TEXT NOT NULL,
  sala_id TEXT NOT NULL,
  tempo_preparo_min INTEGER NOT NULL DEFAULT 0,
  tempo_limpeza_min INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS proc_rec_org_idx ON procedimento_recursos(organizacao_id);

CREATE TABLE IF NOT EXISTS insumos (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'un',
  custo_unitario REAL NOT NULL DEFAULT 0,
  estoque_atual REAL NOT NULL DEFAULT 0,
  estoque_minimo REAL NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS insumos_org_idx ON insumos(organizacao_id);

CREATE TABLE IF NOT EXISTS ficha_tecnica_itens (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  procedimento_id TEXT NOT NULL,
  insumo_id TEXT NOT NULL,
  quantidade REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ficha_org_idx ON ficha_tecnica_itens(organizacao_id);

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  email TEXT,
  data_nascimento TEXT,
  origem_lead TEXT,
  observacoes TEXT,
  lgpd_consentimento INTEGER NOT NULL DEFAULT 0,
  lgpd_data INTEGER,
  lgpd_canal TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS clientes_org_idx ON clientes(organizacao_id);
CREATE UNIQUE INDEX IF NOT EXISTS clientes_org_tel_idx ON clientes(organizacao_id, telefone);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  cor TEXT NOT NULL DEFAULT '#7c8f7a'
);
CREATE INDEX IF NOT EXISTS tags_org_idx ON tags(organizacao_id);

CREATE TABLE IF NOT EXISTS cliente_tags (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  tag_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cliente_tags_org_idx ON cliente_tags(organizacao_id);

CREATE TABLE IF NOT EXISTS motivos_perda (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  descricao TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS motivos_perda_org_idx ON motivos_perda(organizacao_id);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  cliente_id TEXT,
  nome TEXT,
  telefone TEXT NOT NULL,
  etapa TEXT NOT NULL,
  canal_entrada TEXT NOT NULL,
  atendido_por_tipo TEXT NOT NULL,
  motivo_perda_id TEXT,
  observacao_perda TEXT,
  primeira_resposta_em INTEGER,
  ultima_interacao_em INTEGER,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS leads_org_data_idx ON leads(organizacao_id, criado_em);

CREATE TABLE IF NOT EXISTS agendamentos (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  profissional_id TEXT NOT NULL,
  sala_id TEXT,
  procedimento_id TEXT NOT NULL,
  inicio INTEGER NOT NULL,
  fim INTEGER NOT NULL,
  inicio_bloqueio INTEGER NOT NULL,
  fim_bloqueio INTEGER NOT NULL,
  status TEXT NOT NULL,
  origem TEXT NOT NULL,
  observacoes TEXT,
  lembrete_enviado_24h INTEGER NOT NULL DEFAULT 0,
  lembrete_enviado_2h INTEGER NOT NULL DEFAULT 0,
  remarcado_de_id TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS agendamentos_org_data_idx ON agendamentos(organizacao_id, inicio);
CREATE INDEX IF NOT EXISTS agendamentos_prof_idx ON agendamentos(organizacao_id, profissional_id, inicio);
CREATE INDEX IF NOT EXISTS agendamentos_sala_idx ON agendamentos(organizacao_id, sala_id, inicio);

CREATE TABLE IF NOT EXISTS atendimentos (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  agendamento_id TEXT,
  cliente_id TEXT NOT NULL,
  profissional_id TEXT NOT NULL,
  procedimento_id TEXT NOT NULL,
  status TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  custo_insumos REAL NOT NULL DEFAULT 0,
  concluido_em INTEGER,
  observacoes TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS atendimentos_org_data_idx ON atendimentos(organizacao_id, criado_em);

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  insumo_id TEXT NOT NULL,
  atendimento_id TEXT,
  tipo TEXT NOT NULL,
  quantidade REAL NOT NULL,
  motivo TEXT NOT NULL,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS mov_estoque_org_idx ON movimentacoes_estoque(organizacao_id);

CREATE TABLE IF NOT EXISTS pagamentos (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  atendimento_id TEXT,
  cliente_id TEXT NOT NULL,
  valor REAL NOT NULL,
  forma TEXT NOT NULL,
  status TEXT NOT NULL,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS pagamentos_org_idx ON pagamentos(organizacao_id, criado_em);

CREATE TABLE IF NOT EXISTS conversas (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  cliente_id TEXT,
  lead_id TEXT,
  canal TEXT NOT NULL DEFAULT 'whatsapp',
  telefone TEXT NOT NULL,
  status TEXT NOT NULL,
  motivo_escalada TEXT,
  ultima_mensagem_em INTEGER,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS conversas_org_idx ON conversas(organizacao_id, criado_em);

CREATE TABLE IF NOT EXISTS mensagens (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  conversa_id TEXT NOT NULL,
  remetente_tipo TEXT NOT NULL,
  remetente_id TEXT,
  conteudo TEXT NOT NULL,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS mensagens_conversa_idx ON mensagens(organizacao_id, conversa_id, criado_em);

CREATE TABLE IF NOT EXISTS ia_acoes_log (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  autor_tipo TEXT NOT NULL DEFAULT 'ia',
  tipo_acao TEXT NOT NULL,
  conversa_id TEXT,
  dados_entrada TEXT,
  dados_decisao TEXT,
  sucesso INTEGER NOT NULL DEFAULT 1,
  erro TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS ia_log_org_idx ON ia_acoes_log(organizacao_id, criado_em);

CREATE TABLE IF NOT EXISTS reativacoes_log (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  cliente_id TEXT NOT NULL,
  disparado_em INTEGER NOT NULL,
  retornou INTEGER NOT NULL DEFAULT 0,
  data_retorno INTEGER,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS reativacoes_org_idx ON reativacoes_log(organizacao_id, disparado_em);

CREATE TABLE IF NOT EXISTS jobs_execucoes (
  id TEXT PRIMARY KEY,
  organizacao_id TEXT NOT NULL,
  job TEXT NOT NULL,
  resultado TEXT,
  duracao_ms INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  criado_em INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS jobs_org_idx ON jobs_execucoes(organizacao_id, criado_em);
`;

/**
 * Versão do schema. Suba este número SEMPRE que alterar a DDL abaixo.
 *
 * Sem isso, `CREATE TABLE IF NOT EXISTS` mente: num banco que já existe ele
 * não faz nada, então uma coluna nova simplesmente não aparece e o sistema
 * quebra na primeira consulta que a use — longe da causa real. O guard troca
 * esse erro tardio e confuso por uma falha imediata dizendo o que fazer.
 */
export const SCHEMA_VERSAO = 1;

/**
 * Aplica a DDL de forma idempotente. Num banco já existente com versão
 * diferente, falha alto em vez de seguir com schema inconsistente.
 */
export function garantirSchema(sqlite: import("bun:sqlite").Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      versao INTEGER NOT NULL
    );
  `);

  const meta = sqlite.query(`SELECT versao FROM schema_meta WHERE id = 1`).get() as
    | { versao: number }
    | null;

  if (meta && meta.versao !== SCHEMA_VERSAO) {
    throw new Error(
      `Schema do banco na versão ${meta.versao}, esperado ${SCHEMA_VERSAO}. ` +
        `Como este projeto ainda não usa migrations incrementais, recrie o banco de ` +
        `desenvolvimento: apague dev.db (e dev.db-wal / dev.db-shm) e rode novamente.`,
    );
  }

  sqlite.exec(DDL);
  sqlite.run(
    `INSERT INTO schema_meta (id, versao) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET versao = excluded.versao`,
    SCHEMA_VERSAO,
  );
}
