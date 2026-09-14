import type { Database } from "bun:sqlite";
import { horariosLivres, validarAgendamento, ConflitoError } from "./agenda";
import { custoInsumos } from "./contabil";

/**
 * Agente de IA do WhatsApp.
 *
 * REGRA DURA: o agente só afirma o que existe no banco daquela organização.
 * Nenhum preço, duração, procedimento ou horário é inferido — se não está no
 * catálogo/agenda, a resposta é uma negativa explícita.
 *
 * Este módulo é determinístico de propósito: as funções são reais (consulta,
 * criação, remarcação, cancelamento, cadastro), e o texto é montado a partir
 * do que o banco devolveu. Não há chamada a LLM externa na Fase 7 — o ponto de
 * integração está isolado em `gerarResposta` para plugar o provedor depois.
 */

const min = 60_000;
const uuid = () => crypto.randomUUID();
const camposSensiveisLog = new Set([
  "conteudo",
  "cpf",
  "data_nascimento",
  "documento",
  "email",
  "endereco",
  "mensagem",
  "nome",
  "nome_cliente",
  "observacoes",
  "senha",
  "telefone",
  "token",
]);

function sanitizarParaLog(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(sanitizarParaLog);

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [
        chave,
        camposSensiveisLog.has(chave.toLowerCase()) ? "[REDACTED]" : sanitizarParaLog(item),
      ]),
    );
  }

  if (typeof valor === "string") {
    return valor
      .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
      .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[REDACTED_CPF]")
      .replace(/(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]?\d{4}(?!\d)/g, "[REDACTED_PHONE]");
  }

  return valor;
}

export type TipoAcaoIA =
  | "consultar_horarios"
  | "consultar_procedimentos"
  | "consultar_preco"
  | "criar_agendamento"
  | "remarcar_agendamento"
  | "cancelar_agendamento"
  | "cadastrar_cliente"
  | "escalar_humano";

export interface ResultadoAcao {
  resposta: string;
  acao: TipoAcaoIA;
  dados_entrada: unknown;
  dados_decisao: unknown;
  escalar?: string; // motivo da escalada
}

export interface ContextoIa {
  organizacao_id: string;
  timezone: string;
}

function registrar(
  sqlite: Database,
  organizacao_id: string,
  conversa_id: string | null,
  acao: TipoAcaoIA,
  entrada: unknown,
  decisao: unknown,
  erro?: string,
) {
  sqlite.run(
    `INSERT INTO ia_acoes_log
      (id, organizacao_id, autor_tipo, tipo_acao, conversa_id, dados_entrada, dados_decisao, sucesso, erro)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    uuid(),
    organizacao_id,
    "ia",
    acao,
    conversa_id,
    JSON.stringify(sanitizarParaLog(entrada ?? {})),
    JSON.stringify(sanitizarParaLog(decisao ?? {})),
    erro ? 0 : 1,
    erro ?? null,
  );
}

function fmt(ts: number, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

/** Busca por nome tolerante a acento/caixa. Devolve null se nada bater. */
function acharProcedimento(sqlite: Database, organizacao_id: string, termo: string) {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const alvo = norm(termo);
  const todos = sqlite
    .query(`SELECT id, nome, duracao_min, preco FROM procedimentos WHERE organizacao_id = ? AND ativo = 1`)
    .all(organizacao_id) as { id: string; nome: string; duracao_min: number; preco: number }[];
  return (
    todos.find((p) => norm(p.nome) === alvo) ??
    todos.find((p) => norm(p.nome).includes(alvo) || alvo.includes(norm(p.nome))) ??
    null
  );
}

function configHorario(sqlite: Database, organizacao_id: string) {
  const row = sqlite
    .query(`SELECT horario_funcionamento, timezone FROM organizacoes WHERE organizacao_id = ?`)
    .get(organizacao_id) as { horario_funcionamento: string | null; timezone: string } | null;
  return {
    horario: row?.horario_funcionamento ? JSON.parse(row.horario_funcionamento) : null,
    timezone: row?.timezone ?? "America/Sao_Paulo",
  };
}

/** Recurso (sala) exigido pelo procedimento, com seus tempos de preparo/limpeza. */
function recursoDoProcedimento(sqlite: Database, organizacao_id: string, procedimento_id: string) {
  return sqlite
    .query(
      `SELECT sala_id, tempo_preparo_min, tempo_limpeza_min
       FROM procedimento_recursos WHERE organizacao_id = ? AND procedimento_id = ? LIMIT 1`,
    )
    .get(organizacao_id, procedimento_id) as
    | { sala_id: string; tempo_preparo_min: number; tempo_limpeza_min: number }
    | null;
}

// ─────────────────────────────────────────────────────────────
// AÇÕES
// ─────────────────────────────────────────────────────────────

export function consultarProcedimentos(sqlite: Database, ctx: ContextoIa, conversa_id: string | null): ResultadoAcao {
  const lista = sqlite
    .query(
      `SELECT nome, duracao_min, preco FROM procedimentos
       WHERE organizacao_id = ? AND ativo = 1 ORDER BY nome`,
    )
    .all(ctx.organizacao_id) as { nome: string; duracao_min: number; preco: number }[];

  if (lista.length === 0) {
    const resposta = "Ainda não há procedimentos cadastrados no sistema desta clínica. Vou passar para a equipe.";
    registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_procedimentos", {}, { total: 0 });
    return { resposta, acao: "consultar_procedimentos", dados_entrada: {}, dados_decisao: { total: 0 }, escalar: "catalogo_vazio" };
  }

  const resposta =
    "Temos estes procedimentos:\n" +
    lista.map((p) => `• ${p.nome} — ${p.duracao_min} min — R$ ${p.preco.toFixed(2)}`).join("\n") +
    "\n\nQual você gostaria de agendar?";

  registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_procedimentos", {}, { total: lista.length });
  return { resposta, acao: "consultar_procedimentos", dados_entrada: {}, dados_decisao: { total: lista.length } };
}

export function consultarPreco(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string | null,
  termo: string,
): ResultadoAcao {
  const proc = acharProcedimento(sqlite, ctx.organizacao_id, termo);
  if (!proc) {
    const resposta = `Não encontrei "${termo}" no catálogo desta clínica. Não vou informar valores que não estão cadastrados — quer que eu liste os procedimentos disponíveis?`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_preco", { termo }, { encontrado: false });
    return { resposta, acao: "consultar_preco", dados_entrada: { termo }, dados_decisao: { encontrado: false } };
  }
  const resposta = `${proc.nome}: R$ ${proc.preco.toFixed(2)}, duração de ${proc.duracao_min} minutos. Quer que eu veja os horários disponíveis?`;
  registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_preco", { termo }, { procedimento_id: proc.id });
  return { resposta, acao: "consultar_preco", dados_entrada: { termo }, dados_decisao: { procedimento_id: proc.id } };
}

export function consultarHorarios(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string | null,
  termoProcedimento: string,
  profissional_id?: string,
): ResultadoAcao {
  const proc = acharProcedimento(sqlite, ctx.organizacao_id, termoProcedimento);
  if (!proc) {
    const resposta = `Não encontrei "${termoProcedimento}" no catálogo desta clínica, então não consigo verificar horários para ele.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_horarios", { termoProcedimento }, { encontrado: false });
    return { resposta, acao: "consultar_horarios", dados_entrada: { termoProcedimento }, dados_decisao: { encontrado: false } };
  }

  const prof = profissional_id
    ? (sqlite
        .query(`SELECT id, nome FROM profissionais WHERE organizacao_id = ? AND id = ? AND ativo = 1`)
        .get(ctx.organizacao_id, profissional_id) as { id: string; nome: string } | null)
    : (sqlite
        .query(
          `SELECT p.id, p.nome FROM procedimento_profissionais pp
           JOIN profissionais p ON p.id = pp.profissional_id AND p.organizacao_id = pp.organizacao_id
           WHERE pp.organizacao_id = ? AND pp.procedimento_id = ? AND p.ativo = 1 LIMIT 1`,
        )
        .get(ctx.organizacao_id, proc.id) as { id: string; nome: string } | null);

  if (!prof) {
    const resposta = `Nenhum profissional habilitado para ${proc.nome} está ativo no momento. Vou encaminhar para a equipe.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_horarios", { proc: proc.id }, { profissional: null });
    return {
      resposta,
      acao: "consultar_horarios",
      dados_entrada: { procedimento_id: proc.id },
      dados_decisao: { profissional: null },
      escalar: "sem_profissional",
    };
  }

  const { horario, timezone } = configHorario(sqlite, ctx.organizacao_id);
  const rec = recursoDoProcedimento(sqlite, ctx.organizacao_id, proc.id);
  const agora = Date.now();
  const livres = horariosLivres(sqlite, horario, timezone, {
    organizacao_id: ctx.organizacao_id,
    profissional_id: prof.id,
    sala_id: rec?.sala_id ?? null,
    procedimento_id: proc.id,
    duracao_min: proc.duracao_min,
    tempo_preparo_min: rec?.tempo_preparo_min,
    tempo_limpeza_min: rec?.tempo_limpeza_min,
    de: agora,
    ate: agora + 14 * 24 * 60 * min,
    passo_min: 30,
  });

  if (livres.length === 0) {
    const resposta = `Não há horário livre para ${proc.nome} com ${prof.nome} nos próximos 14 dias. Posso passar para a equipe verificar encaixes.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "consultar_horarios", { procedimento_id: proc.id }, { livres: 0 });
    return { resposta, acao: "consultar_horarios", dados_entrada: { procedimento_id: proc.id }, dados_decisao: { livres: 0 } };
  }

  const amostra = livres.slice(0, 5);
  const resposta =
    `Horários realmente livres para ${proc.nome} com ${prof.nome}:\n` +
    amostra.map((t) => `• ${fmt(t, timezone)}`).join("\n") +
    "\n\nQual desses funciona para você? Se preferir outro período, eu verifico.";

  registrar(
    sqlite,
    ctx.organizacao_id,
    conversa_id,
    "consultar_horarios",
    { procedimento_id: proc.id, profissional_id: prof.id },
    { livres: livres.length, amostra },
  );
  return {
    resposta,
    acao: "consultar_horarios",
    dados_entrada: { procedimento_id: proc.id, profissional_id: prof.id },
    dados_decisao: { livres: livres.length, amostra },
  };
}

export function criarAgendamento(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string | null,
  p: {
    telefone: string;
    nome_cliente?: string;
    termo_procedimento: string;
    inicio: number;
    profissional_id?: string;
  },
): ResultadoAcao {
  const proc = acharProcedimento(sqlite, ctx.organizacao_id, p.termo_procedimento);
  if (!proc) {
    const resposta = `Não posso agendar: "${p.termo_procedimento}" não existe no catálogo desta clínica.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "criar_agendamento", p, { erro: "procedimento_inexistente" }, "procedimento_inexistente");
    return {
      resposta,
      acao: "criar_agendamento",
      dados_entrada: p,
      dados_decisao: { erro: "procedimento_inexistente" },
    };
  }

  const prof = p.profissional_id
    ? (sqlite
        .query(`SELECT id, nome FROM profissionais WHERE organizacao_id = ? AND id = ? AND ativo = 1`)
        .get(ctx.organizacao_id, p.profissional_id) as { id: string; nome: string } | null)
    : (sqlite
        .query(
          `SELECT p.id, p.nome FROM procedimento_profissionais pp
           JOIN profissionais p ON p.id = pp.profissional_id AND p.organizacao_id = pp.organizacao_id
           WHERE pp.organizacao_id = ? AND pp.procedimento_id = ? AND p.ativo = 1 LIMIT 1`,
        )
        .get(ctx.organizacao_id, proc.id) as { id: string; nome: string } | null);

  if (!prof) {
    const resposta = `Não posso agendar ${proc.nome}: nenhum profissional habilitado está ativo. Vou encaminhar para a equipe.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "criar_agendamento", p, { erro: "sem_profissional" }, "sem_profissional");
    return { resposta, acao: "criar_agendamento", dados_entrada: p, dados_decisao: { erro: "sem_profissional" }, escalar: "sem_profissional" };
  }

  // cliente por telefone (dedup WhatsApp); cadastra se não existir
  let cliente = sqlite
    .query(`SELECT id, nome FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
    .get(ctx.organizacao_id, p.telefone) as { id: string; nome: string } | null;

  if (!cliente) {
    if (!p.nome_cliente) {
      const resposta = "Para agendar eu preciso do seu nome completo. Pode me informar?";
      registrar(sqlite, ctx.organizacao_id, conversa_id, "criar_agendamento", p, { erro: "nome_ausente" });
      return { resposta, acao: "criar_agendamento", dados_entrada: p, dados_decisao: { erro: "nome_ausente" } };
    }
    const id = uuid();
    sqlite.run(
      `INSERT INTO clientes (id, organizacao_id, nome, telefone, origem_lead, lgpd_consentimento, lgpd_data, lgpd_canal)
       VALUES (?,?,?,?,?,?,?,?)`,
      id,
      ctx.organizacao_id,
      p.nome_cliente,
      p.telefone,
      "whatsapp",
      1,
      Date.now(),
      "whatsapp",
    );
    cliente = { id, nome: p.nome_cliente };
  }

  const { horario, timezone } = configHorario(sqlite, ctx.organizacao_id);
  const rec = recursoDoProcedimento(sqlite, ctx.organizacao_id, proc.id);

  try {
    const bloco = validarAgendamento(sqlite, horario, timezone, {
      organizacao_id: ctx.organizacao_id,
      profissional_id: prof.id,
      sala_id: rec?.sala_id ?? null,
      procedimento_id: proc.id,
      inicio: p.inicio,
      duracao_min: proc.duracao_min,
      tempo_preparo_min: rec?.tempo_preparo_min,
      tempo_limpeza_min: rec?.tempo_limpeza_min,
    });

    const id = uuid();
    sqlite.run(
      `INSERT INTO agendamentos
        (id, organizacao_id, cliente_id, profissional_id, sala_id, procedimento_id,
         inicio, fim, inicio_bloqueio, fim_bloqueio, status, origem)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      ctx.organizacao_id,
      cliente.id,
      prof.id,
      rec?.sala_id ?? null,
      proc.id,
      p.inicio,
      p.inicio + proc.duracao_min * min,
      bloco.inicio,
      bloco.fim,
      "agendado",
      "ia",
    );

    // lead acompanha a conversão
    sqlite.run(
      `INSERT INTO leads
        (id, organizacao_id, cliente_id, nome, telefone, etapa, canal_entrada, atendido_por_tipo, ultima_interacao_em)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      uuid(),
      ctx.organizacao_id,
      cliente.id,
      cliente.nome,
      p.telefone,
      "agendado",
      "whatsapp",
      "ia",
      Date.now(),
    );

    const resposta = `Agendado: ${proc.nome} com ${prof.nome} em ${fmt(p.inicio, timezone)}. Vou te enviar um lembrete 24h antes — se precisar remarcar, é só responder por aqui.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "criar_agendamento", p, { agendamento_id: id, bloco });
    return { resposta, acao: "criar_agendamento", dados_entrada: p, dados_decisao: { agendamento_id: id } };
  } catch (e) {
    if (e instanceof ConflitoError) {
      registrar(sqlite, ctx.organizacao_id, conversa_id, "criar_agendamento", p, { erro: e.regra }, e.message);
      return {
        resposta: `Não consigo agendar nesse horário: ${e.message}. Quer que eu veja as opções livres?`,
        acao: "criar_agendamento",
        dados_entrada: p,
        dados_decisao: { erro: e.regra },
      };
    }
    throw e;
  }
}

export function remarcarAgendamento(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string | null,
  p: { agendamento_id: string; novo_inicio: number },
): ResultadoAcao {
  const ag = sqlite
    .query(
      `SELECT a.*, pr.duracao_min AS duracao, pr.nome AS proc_nome
       FROM agendamentos a
       JOIN procedimentos pr ON pr.id = a.procedimento_id AND pr.organizacao_id = a.organizacao_id
       WHERE a.organizacao_id = ? AND a.id = ?`,
    )
    .get(ctx.organizacao_id, p.agendamento_id) as any;

  if (!ag) {
    const resposta = "Não encontrei esse agendamento nesta clínica.";
    registrar(sqlite, ctx.organizacao_id, conversa_id, "remarcar_agendamento", p, { erro: "nao_encontrado" });
    return { resposta, acao: "remarcar_agendamento", dados_entrada: p, dados_decisao: { erro: "nao_encontrado" } };
  }

  const { horario, timezone } = configHorario(sqlite, ctx.organizacao_id);
  const rec = recursoDoProcedimento(sqlite, ctx.organizacao_id, ag.procedimento_id);

  try {
    const bloco = validarAgendamento(sqlite, horario, timezone, {
      organizacao_id: ctx.organizacao_id,
      profissional_id: ag.profissional_id,
      sala_id: ag.sala_id,
      procedimento_id: ag.procedimento_id,
      inicio: p.novo_inicio,
      duracao_min: ag.duracao,
      tempo_preparo_min: rec?.tempo_preparo_min,
      tempo_limpeza_min: rec?.tempo_limpeza_min,
      ignorarAgendamentoId: ag.id,
    });

    const novoId = uuid();
    const tx = sqlite.transaction(() => {
      sqlite.run(`UPDATE agendamentos SET status = 'remarcado' WHERE organizacao_id = ? AND id = ?`, ctx.organizacao_id, ag.id);
      sqlite.run(
        `INSERT INTO agendamentos
          (id, organizacao_id, cliente_id, profissional_id, sala_id, procedimento_id,
           inicio, fim, inicio_bloqueio, fim_bloqueio, status, origem, remarcado_de_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        novoId,
        ctx.organizacao_id,
        ag.cliente_id,
        ag.profissional_id,
        ag.sala_id,
        ag.procedimento_id,
        p.novo_inicio,
        p.novo_inicio + ag.duracao * min,
        bloco.inicio,
        bloco.fim,
        "agendado",
        "ia",
        ag.id,
      );
    });
    tx();

    const resposta = `Remarcado: ${ag.proc_nome} agora em ${fmt(p.novo_inicio, timezone)}.`;
    registrar(sqlite, ctx.organizacao_id, conversa_id, "remarcar_agendamento", p, { novo_id: novoId });
    return { resposta, acao: "remarcar_agendamento", dados_entrada: p, dados_decisao: { novo_id: novoId } };
  } catch (e) {
    if (e instanceof ConflitoError) {
      registrar(sqlite, ctx.organizacao_id, conversa_id, "remarcar_agendamento", p, { erro: e.regra }, e.message);
      return {
        resposta: `Não consigo remarcar para esse horário: ${e.message}.`,
        acao: "remarcar_agendamento",
        dados_entrada: p,
        dados_decisao: { erro: e.regra },
      };
    }
    throw e;
  }
}

export function cancelarAgendamento(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string | null,
  p: { agendamento_id: string; por: "cliente" | "clinica" },
): ResultadoAcao {
  const status = p.por === "cliente" ? "cancelado_pelo_cliente" : "cancelado_pela_clinica";
  const ag = sqlite
    .query(`SELECT id, inicio FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
    .get(ctx.organizacao_id, p.agendamento_id) as { id: string; inicio: number } | null;

  if (!ag) {
    registrar(sqlite, ctx.organizacao_id, conversa_id, "cancelar_agendamento", p, { erro: "nao_encontrado" });
    return {
      resposta: "Não encontrei esse agendamento nesta clínica.",
      acao: "cancelar_agendamento",
      dados_entrada: p,
      dados_decisao: { erro: "nao_encontrado" },
    };
  }

  sqlite.run(`UPDATE agendamentos SET status = ? WHERE organizacao_id = ? AND id = ?`, status, ctx.organizacao_id, ag.id);
  registrar(sqlite, ctx.organizacao_id, conversa_id, "cancelar_agendamento", p, { status });
  return {
    resposta: "Cancelado. Se quiser marcar de novo, é só me chamar por aqui.",
    acao: "cancelar_agendamento",
    dados_entrada: p,
    dados_decisao: { status },
  };
}

export function cadastrarCliente(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string | null,
  p: {
    telefone: string;
    nome: string;
    email?: string;
    data_nascimento?: string;
    origem_lead?: string;
    lgpd_canal?: string;
    observacoes?: string;
  },
): ResultadoAcao {
  const existente = sqlite
    .query(`SELECT id, nome FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
    .get(ctx.organizacao_id, p.telefone) as { id: string; nome: string } | null;

  if (existente) {
    sqlite.run(
      `UPDATE clientes SET nome = ?, email = COALESCE(?, email), data_nascimento = COALESCE(?, data_nascimento),
        origem_lead = COALESCE(?, origem_lead), observacoes = COALESCE(?, observacoes)
       WHERE organizacao_id = ? AND id = ?`,
      p.nome,
      p.email ?? null,
      p.data_nascimento ?? null,
      p.origem_lead ?? null,
      p.observacoes ?? null,
      ctx.organizacao_id,
      existente.id,
    );
    registrar(sqlite, ctx.organizacao_id, conversa_id, "cadastrar_cliente", p, { atualizado: existente.id });
    return {
      resposta: `Atualizei seu cadastro, ${p.nome}.`,
      acao: "cadastrar_cliente",
      dados_entrada: p,
      dados_decisao: { cliente_id: existente.id, atualizado: true },
    };
  }

  const id = uuid();
  sqlite.run(
    `INSERT INTO clientes
      (id, organizacao_id, nome, telefone, email, data_nascimento, origem_lead, observacoes,
       lgpd_consentimento, lgpd_data, lgpd_canal)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    ctx.organizacao_id,
    p.nome,
    p.telefone,
    p.email ?? null,
    p.data_nascimento ?? null,
    p.origem_lead ?? "whatsapp",
    p.observacoes ?? null,
    1,
    Date.now(),
    p.lgpd_canal ?? "whatsapp",
  );

  registrar(sqlite, ctx.organizacao_id, conversa_id, "cadastrar_cliente", p, { cliente_id: id });
  return {
    resposta: `Cadastro feito, ${p.nome}. Quer que eu veja horários disponíveis?`,
    acao: "cadastrar_cliente",
    dados_entrada: p,
    dados_decisao: { cliente_id: id, atualizado: false },
  };
}

// ─────────────────────────────────────────────────────────────
// ESCALADA PARA HUMANO
// ─────────────────────────────────────────────────────────────

const GATILHOS_ESCALADA: { padrao: RegExp; motivo: string }[] = [
  { padrao: /\b(falar|quero falar|atendente|humano|pessoa|recepcao|recepcionista)\b/i, motivo: "pedido_explicito" },
  { padrao: /\b(reclama|reclamaç|insatisfeit|péssimo|pessimo|absurdo|processo|procon|advogad)\w*/i, motivo: "reclamacao" },
  { padrao: /\b(dor|sangra|sangramento|inflamad|infecç|infec|febre|urgente|emergência|emergencia|pus|abscesso)\w*/i, motivo: "caso_clinico_ou_urgencia" },
  { padrao: /\b(convênio|convenio|plano de saúde|plano de saude|reembolso do plano)\b/i, motivo: "assunto_fora_do_escopo" },
];

export function detectarEscalada(texto: string): string | null {
  for (const g of GATILHOS_ESCALADA) {
    if (g.padrao.test(texto)) return g.motivo;
  }
  return null;
}

export function escalarHumano(
  sqlite: Database,
  ctx: ContextoIa,
  conversa_id: string,
  motivo: string,
): ResultadoAcao {
  sqlite.run(
    `UPDATE conversas SET status = 'aguardando_humano', motivo_escalada = ? WHERE organizacao_id = ? AND id = ?`,
    motivo,
    ctx.organizacao_id,
    conversa_id,
  );
  registrar(sqlite, ctx.organizacao_id, conversa_id, "escalar_humano", { motivo }, { status: "aguardando_humano" });

  const mensagens: Record<string, string> = {
    pedido_explicito: "Claro — vou chamar alguém da equipe para continuar com você por aqui.",
    reclamacao: "Sinto muito por isso. Vou passar sua mensagem para a equipe responsável agora mesmo.",
    caso_clinico_ou_urgencia:
      "Isso é uma questão clínica e precisa de avaliação humana. Vou chamar a equipe agora — se for urgente, procure atendimento presencial.",
    assunto_fora_do_escopo:
      "Esse assunto precisa da equipe. Vou encaminhar sua conversa para um atendente humano.",
    falha_compreensao: "Não consegui entender com segurança. Vou chamar uma pessoa da equipe para te ajudar.",
  };

  return {
    resposta: mensagens[motivo] ?? mensagens.pedido_explicito,
    acao: "escalar_humano",
    dados_entrada: { motivo },
    dados_decisao: { status: "aguardando_humano" },
  };
}

/** Custo de insumos de um procedimento, exposto para o agente informar quando perguntado. */
export function custoDoProcedimento(sqlite: Database, organizacao_id: string, termo: string): number | null {
  const proc = acharProcedimento(sqlite, organizacao_id, termo);
  if (!proc) return null;
  return custoInsumos(sqlite, organizacao_id, proc.id);
}
