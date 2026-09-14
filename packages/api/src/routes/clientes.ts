import {
  json,
  lerCorpo,
  exigirTexto,
  opcionalTexto,
  BadRequestError,
  NotFoundError,
} from "../http";
import type { Rota, ContextoRota } from "../router";

const uuid = () => crypto.randomUUID();

const ETAPAS = [
  "novo",
  "em_conversa",
  "qualificado",
  "agendado",
  "compareceu",
  "fechado",
  "perdido",
] as const;

const CANAIS = ["whatsapp", "indicacao", "instagram", "presencial", "telefone"] as const;

/** Só `concluido` conta como receita efetiva; `brinde` soma custo, não receita. */
const RECEITA = "concluido";

function escaparLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * Histórico unificado do cliente. A spec exige que seja VISÃO AGREGADA, não
 * tabela própria: junta agendamentos + atendimentos + conversas + reativações
 * numa linha do tempo. Nada aqui é persistido.
 */
function historicoUnificado(sqlite: ContextoRota["sqlite"], org: string, cliente_id: string) {
  const agendamentos = sqlite
    .query(
      `SELECT a.id, a.inicio, a.status, p.nome AS procedimento, pr.nome AS profissional
       FROM agendamentos a
       JOIN procedimentos p ON p.id = a.procedimento_id AND p.organizacao_id = a.organizacao_id
       JOIN profissionais pr ON pr.id = a.profissional_id AND pr.organizacao_id = a.organizacao_id
       WHERE a.organizacao_id = ? AND a.cliente_id = ?`,
    )
    .all(org, cliente_id) as { id: string; inicio: number; status: string; procedimento: string; profissional: string }[];

  const atendimentos = sqlite
    .query(
      `SELECT t.id, t.status, t.valor, t.custo_insumos, t.concluido_em, t.criado_em,
              p.nome AS procedimento, pr.nome AS profissional
       FROM atendimentos t
       JOIN procedimentos p ON p.id = t.procedimento_id AND p.organizacao_id = t.organizacao_id
       JOIN profissionais pr ON pr.id = t.profissional_id AND pr.organizacao_id = t.organizacao_id
       WHERE t.organizacao_id = ? AND t.cliente_id = ?`,
    )
    .all(org, cliente_id) as {
    id: string;
    status: string;
    valor: number;
    custo_insumos: number;
    concluido_em: number | null;
    criado_em: number;
    procedimento: string;
    profissional: string;
  }[];

  const conversas = sqlite
    .query(
      `SELECT c.id, c.status, c.canal, c.ultima_mensagem_em,
              (SELECT COUNT(*) FROM mensagens m WHERE m.organizacao_id = c.organizacao_id AND m.conversa_id = c.id) AS mensagens
       FROM conversas c WHERE c.organizacao_id = ? AND c.cliente_id = ?`,
    )
    .all(org, cliente_id) as { id: string; status: string; canal: string; ultima_mensagem_em: number | null; mensagens: number }[];

  const reativacoes = sqlite
    .query(`SELECT id, disparado_em, retornou, data_retorno FROM reativacoes_log WHERE organizacao_id = ? AND cliente_id = ?`)
    .all(org, cliente_id) as { id: string; disparado_em: number; retornou: number; data_retorno: number | null }[];

  const agora = Date.now();
  // As colunas de tempo já são epoch em milissegundos (schema.ts: ts()). Isto
  // aqui só normaliza o nulo, para o filtro e a ordenação não compararem null.
  const quando = (v: number | null | undefined) => (v ? v : null);

  const eventos: Record<string, unknown>[] = [
    ...agendamentos.map((a) => ({
      tipo: "agendamento",
      quando: a.inicio,
      status: a.status,
      descricao: `${a.procedimento} com ${a.profissional}`,
    })),
    ...atendimentos.map((t) => ({
      tipo: "atendimento",
      quando: quando(t.concluido_em) ?? quando(t.criado_em),
      status: t.status,
      // Receita só entra quando o efeito contábil diz que entrou.
      receita: t.status === RECEITA ? t.valor : 0,
      custo: t.custo_insumos,
      descricao: `${t.procedimento} com ${t.profissional}`,
    })),
    ...conversas.map((c) => ({
      tipo: "conversa",
      quando: quando(c.ultima_mensagem_em),
      status: c.status,
      descricao: `${c.mensagens} mensagem(ns) por ${c.canal}`,
    })),
    ...reativacoes.map((r) => ({
      tipo: "reativacao",
      quando: quando(r.disparado_em),
      status: r.retornou ? "retornou" : "sem_retorno",
      descricao: r.retornou ? "Cliente retornou após reativação" : "Reativação sem retorno",
    })),
  ]
    .filter((e) => e.quando != null)
    .sort((a, b) => (b.quando as number) - (a.quando as number));

  const totalReceita = atendimentos
    .filter((t) => t.status === RECEITA)
    .reduce((acc, t) => acc + t.valor, 0);
  const totalCusto = atendimentos
    .filter((t) => t.status === RECEITA || t.status === "brinde")
    .reduce((acc, t) => acc + t.custo_insumos, 0);
  const faltas = atendimentos.filter((t) => t.status === "falta").length;

  return {
    eventos,
    totais: {
      agendamentos: agendamentos.length,
      atendimentos: atendimentos.length,
      receita: totalReceita,
      custo_insumos: totalCusto,
      faltas,
      // Margem calculada, não cadastrada.
      margem: totalReceita - totalCusto,
    },
    ultima_atividade: eventos[0]?.quando ?? null,
    dias_sem_atividade: eventos[0]?.quando
      ? Math.floor((agora - (eventos[0].quando as number)) / 86_400_000)
      : null,
  };
}

function tagsDoCliente(sqlite: ContextoRota["sqlite"], org: string, cliente_id: string) {
  return sqlite
    .query(
      `SELECT t.id, t.nome, t.cor FROM cliente_tags ct
       JOIN tags t ON t.id = ct.tag_id AND t.organizacao_id = ct.organizacao_id
       WHERE ct.organizacao_id = ? AND ct.cliente_id = ?`,
    )
    .all(org, cliente_id);
}

const listarClientes: Rota = {
  metodo: "GET",
  caminho: "/clientes",
  permissao: "clientes:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const filtros = ["c.organizacao_id = ?"];
    const valores: unknown[] = [org];

    const busca = url.searchParams.get("busca");
    if (busca) {
      // Nome OU telefone: telefone é a chave de dedup do WhatsApp.
      filtros.push("(c.nome LIKE ? ESCAPE '\\' OR c.telefone LIKE ? ESCAPE '\\')");
      const like = `%${escaparLike(busca)}%`;
      valores.push(like, like);
    }
    if (url.searchParams.get("somente_ativos") === "1") filtros.push("c.ativo = 1");

    const tag_id = url.searchParams.get("tag_id");
    if (tag_id) {
      filtros.push(
        `EXISTS (SELECT 1 FROM cliente_tags ct WHERE ct.organizacao_id = c.organizacao_id
                 AND ct.cliente_id = c.id AND ct.tag_id = ?)`,
      );
      valores.push(tag_id);
    }

    const rows = sqlite
      .query(
        `SELECT c.id, c.nome, c.telefone, c.email, c.data_nascimento, c.origem_lead,
                c.lgpd_consentimento, c.lgpd_data, c.lgpd_canal, c.ativo, c.criado_em
         FROM clientes c WHERE ${filtros.join(" AND ")} ORDER BY c.nome LIMIT 500`,
      )
      .all(...(valores as never[])) as Record<string, unknown>[];

    return json({
      clientes: rows.map((c) => ({
        ...c,
        lgpd_consentimento: !!c.lgpd_consentimento,
        tags: tagsDoCliente(sqlite, org, c.id as string),
      })),
    });
  },
};

/**
 * Ficha completa do cliente: cadastro + histórico unificado + tags.
 * O histórico é calculado na hora — não existe tabela `historico`.
 */
const obterCliente: Rota = {
  metodo: "GET",
  caminho: "/clientes/:id",
  permissao: "clientes:read",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const row = sqlite
      .query(
        `SELECT id, nome, telefone, email, data_nascimento, origem_lead, observacoes,
                lgpd_consentimento, lgpd_data, lgpd_canal, ativo, criado_em
         FROM clientes WHERE organizacao_id = ? AND id = ?`,
      )
      .get(org, params.id) as Record<string, unknown> | null;
    if (!row) throw new NotFoundError("Cliente não encontrado nesta organização");

    return json({
      cliente: {
        ...row,
        lgpd_consentimento: !!row.lgpd_consentimento,
        tags: tagsDoCliente(sqlite, org, params.id),
      },
      historico: historicoUnificado(sqlite, org, params.id),
    });
  },
};

const criarCliente: Rota = {
  metodo: "POST",
  caminho: "/clientes",
  permissao: "clientes:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const nome = exigirTexto(body, "nome");
    const telefone = exigirTexto(body, "telefone");

    // Telefone é único por organização (índice no banco). Devolve 400 claro em
    // vez de estourar a constraint como 500.
    const existente = sqlite
      .query(`SELECT id, nome FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
      .get(org, telefone) as { id: string; nome: string } | null;
    if (existente) {
      throw new BadRequestError(
        `Já existe cliente com este telefone nesta organização: "${existente.nome}" (${existente.id})`,
      );
    }

    const lgpd = body.lgpd_consentimento === true;
    const id = uuid();
    sqlite
      .query(
        `INSERT INTO clientes
           (id, organizacao_id, nome, telefone, email, data_nascimento, origem_lead,
            observacoes, lgpd_consentimento, lgpd_data, lgpd_canal, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        org,
        nome,
        telefone,
        opcionalTexto(body, "email") ?? null,
        opcionalTexto(body, "data_nascimento") ?? null,
        opcionalTexto(body, "origem_lead") ?? null,
        opcionalTexto(body, "observacoes") ?? null,
        lgpd ? 1 : 0,
        // Consentimento sem data e canal não é consentimento rastreável (LGPD).
        lgpd ? Date.now() : null,
        lgpd ? (opcionalTexto(body, "lgpd_canal") ?? "presencial") : null,
      );

    return json({ cliente: { id, nome, telefone } }, 201);
  },
};

const atualizarCliente: Rota = {
  metodo: "PATCH",
  caminho: "/clientes/:id",
  permissao: "clientes:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const existente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!existente) throw new NotFoundError("Cliente não encontrado nesta organização");

    const campos: string[] = [];
    const valores: unknown[] = [];
    if (body.nome !== undefined) {
      campos.push("nome = ?");
      valores.push(exigirTexto(body, "nome"));
    }
    for (const campo of ["email", "data_nascimento", "origem_lead", "observacoes"] as const) {
      if (body[campo] !== undefined) {
        campos.push(`${campo} = ?`);
        valores.push(opcionalTexto(body, campo) ?? null);
      }
    }
    if (body.ativo !== undefined) {
      if (typeof body.ativo !== "boolean") throw new BadRequestError("ativo deve ser booleano");
      campos.push("ativo = ?");
      valores.push(body.ativo ? 1 : 0);
    }

    // Revogar consentimento apaga data e canal: não se guarda prova de algo revogado.
    if (body.lgpd_consentimento !== undefined) {
      if (typeof body.lgpd_consentimento !== "boolean") {
        throw new BadRequestError("lgpd_consentimento deve ser booleano");
      }
      campos.push("lgpd_consentimento = ?");
      valores.push(body.lgpd_consentimento ? 1 : 0);
      campos.push("lgpd_data = ?");
      valores.push(body.lgpd_consentimento ? Date.now() : null);
      campos.push("lgpd_canal = ?");
      valores.push(body.lgpd_consentimento ? (opcionalTexto(body, "lgpd_canal") ?? "presencial") : null);
    }

    if (campos.length === 0) throw new BadRequestError("Nenhum campo válido para atualizar");
    valores.push(org, params.id);
    sqlite
      .query(`UPDATE clientes SET ${campos.join(", ")} WHERE organizacao_id = ? AND id = ?`)
      .run(...(valores as never[]));
    return json({ atualizado: true });
  },
};

/**
 * Segmentos: inativos há N dias, aniversariantes do mês, com pacote aberto.
 * A spec proíbe armazenar segmento — todos são consulta.
 */
const listarSegmentos: Rota = {
  metodo: "GET",
  caminho: "/clientes/segmentos",
  permissao: "clientes:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const segmento = url.searchParams.get("segmento");
    if (!segmento) {
      throw new BadRequestError("Informe segmento=inativos|aniversariantes|com_pacote");
    }

    const orgRow = sqlite
      .query(`SELECT reativacao_dias FROM organizacoes WHERE organizacao_id = ?`)
      .get(org) as { reativacao_dias: number } | null;
    const dias = orgRow?.reativacao_dias ?? 90;

    if (segmento === "inativos") {
      // Inativo = sem atendimento concluído nos últimos N dias. Quem nunca
      // veio conta pelo cadastro, senão o cliente mais frio ficaria de fora.
      const limite = Date.now() - dias * 86_400_000;
      const rows = sqlite
        .query(
          `SELECT c.id, c.nome, c.telefone,
                  COALESCE(MAX(t.criado_em), c.criado_em) AS ultima_atividade
           FROM clientes c
           LEFT JOIN atendimentos t
             ON t.organizacao_id = c.organizacao_id AND t.cliente_id = c.id AND t.status = ?
           WHERE c.organizacao_id = ? AND c.ativo = 1
           GROUP BY c.id
           HAVING ultima_atividade < ?
           ORDER BY ultima_atividade`,
        )
        .all(RECEITA, org, limite);
      return json({ segmento, dias, clientes: rows });
    }

    if (segmento === "aniversariantes") {
      // Mês corrente no fuso da organização, não do servidor.
      const tz = (
        sqlite.query(`SELECT timezone FROM organizacoes WHERE organizacao_id = ?`).get(org) as
          | { timezone: string }
          | null
      )?.timezone ?? "America/Sao_Paulo";
      const mes = Number(
        new Intl.DateTimeFormat("pt-BR", { timeZone: tz, month: "2-digit" }).format(new Date()),
      );
      const rows = sqlite
        .query(
          `SELECT id, nome, telefone, data_nascimento FROM clientes
           WHERE organizacao_id = ? AND ativo = 1 AND data_nascimento IS NOT NULL
             AND CAST(strftime('%m', data_nascimento) AS INTEGER) = ?
           ORDER BY CAST(strftime('%d', data_nascimento) AS INTEGER)`,
        )
        .all(org, mes);
      return json({ segmento, mes, clientes: rows });
    }

    if (segmento === "com_pacote") {
      // "Pacote aberto" = pagamento com forma 'pacote' ainda não estornado
      // e sem atendimento consumindo depois dele.
      const rows = sqlite
        .query(
          `SELECT c.id, c.nome, c.telefone, p.valor AS valor_pacote, p.criado_em AS adquirido_em
           FROM pagamentos p
           JOIN clientes c ON c.id = p.cliente_id AND c.organizacao_id = p.organizacao_id
           WHERE p.organizacao_id = ? AND p.forma = 'pacote' AND p.status = 'pago'
           ORDER BY p.criado_em`,
        )
        .all(org);
      return json({ segmento, clientes: rows });
    }

    throw new BadRequestError(`Segmento desconhecido: "${segmento}"`);
  },
};

const listarTags: Rota = {
  metodo: "GET",
  caminho: "/clientes/tags",
  permissao: "clientes:read",
  handler({ sqlite, session }) {
    return json({
      tags: sqlite
        .query(`SELECT id, nome, cor FROM tags WHERE organizacao_id = ? ORDER BY nome`)
        .all(session.organizacao_id),
    });
  },
};

const criarTag: Rota = {
  metodo: "POST",
  caminho: "/clientes/tags",
  permissao: "clientes:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const nome = exigirTexto(body, "nome");
    const id = uuid();
    sqlite
      .query(`INSERT INTO tags (id, organizacao_id, nome, cor) VALUES (?, ?, ?, ?)`)
      .run(id, session.organizacao_id, nome, opcionalTexto(body, "cor") ?? "#7c8f7a");
    return json({ tag: { id, nome } }, 201);
  },
};

/** Aplica tag ao cliente. Idempotente — aplicar duas vezes não duplica. */
const aplicarTag: Rota = {
  metodo: "POST",
  caminho: "/clientes/:id/tags",
  permissao: "clientes:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const tag_id = exigirTexto(body, "tag_id");

    const cliente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!cliente) throw new NotFoundError("Cliente não encontrado nesta organização");
    const tag = sqlite
      .query(`SELECT id FROM tags WHERE organizacao_id = ? AND id = ?`)
      .get(org, tag_id);
    if (!tag) throw new BadRequestError("Tag não encontrada nesta organização");

    const jaTem = sqlite
      .query(
        `SELECT id FROM cliente_tags WHERE organizacao_id = ? AND cliente_id = ? AND tag_id = ?`,
      )
      .get(org, params.id, tag_id);
    if (!jaTem) {
      sqlite
        .query(`INSERT INTO cliente_tags (id, organizacao_id, cliente_id, tag_id) VALUES (?, ?, ?, ?)`)
        .run(uuid(), org, params.id, tag_id);
    }
    return json({ tags: tagsDoCliente(sqlite, org, params.id) }, jaTem ? 200 : 201);
  },
};

const removerTag: Rota = {
  metodo: "DELETE",
  caminho: "/clientes/:id/tags/:tagId",
  permissao: "clientes:write",
  handler({ sqlite, session, params }) {
    sqlite
      .query(`DELETE FROM cliente_tags WHERE organizacao_id = ? AND cliente_id = ? AND tag_id = ?`)
      .run(session.organizacao_id, params.id, params.tagId);
    return json({ removido: true });
  },
};

const listarMotivosPerda: Rota = {
  metodo: "GET",
  caminho: "/clientes/motivos-perda",
  permissao: "clientes:read",
  handler({ sqlite, session }) {
    return json({
      motivos: sqlite
        .query(`SELECT id, descricao, ativo FROM motivos_perda WHERE organizacao_id = ? ORDER BY descricao`)
        .all(session.organizacao_id),
    });
  },
};

const criarMotivoPerda: Rota = {
  metodo: "POST",
  caminho: "/clientes/motivos-perda",
  permissao: "clientes:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const descricao = exigirTexto(body, "descricao");
    const org = session.organizacao_id;

    const duplicado = sqlite
      .query(`SELECT id FROM motivos_perda WHERE organizacao_id = ? AND descricao = ?`)
      .get(org, descricao);
    if (duplicado) throw new BadRequestError("Já existe um motivo de perda com esta descrição");

    const id = uuid();
    sqlite
      .query(`INSERT INTO motivos_perda (id, organizacao_id, descricao, ativo) VALUES (?, ?, ?, 1)`)
      .run(id, org, descricao);
    return json({ motivo: { id, descricao } }, 201);
  },
};

const listarLeads: Rota = {
  metodo: "GET",
  caminho: "/leads",
  permissao: "clientes:read",
  handler({ sqlite, session, url }) {
    const filtros = ["l.organizacao_id = ?"];
    const valores: unknown[] = [session.organizacao_id];

    const etapa = url.searchParams.get("etapa");
    if (etapa) {
      if (!(ETAPAS as readonly string[]).includes(etapa)) {
        throw new BadRequestError(`Etapa inválida. Use uma de: ${ETAPAS.join(", ")}`);
      }
      filtros.push("l.etapa = ?");
      valores.push(etapa);
    }
    const canal = url.searchParams.get("canal_entrada");
    if (canal) {
      filtros.push("l.canal_entrada = ?");
      valores.push(canal);
    }

    const rows = sqlite
      .query(
        `SELECT l.*, m.descricao AS motivo_perda, c.nome AS cliente_nome
         FROM leads l
         LEFT JOIN motivos_perda m ON m.id = l.motivo_perda_id AND m.organizacao_id = l.organizacao_id
         LEFT JOIN clientes c ON c.id = l.cliente_id AND c.organizacao_id = l.organizacao_id
         WHERE ${filtros.join(" AND ")}
         ORDER BY l.criado_em DESC LIMIT 500`,
      )
      .all(...(valores as never[]));
    return json({ leads: rows });
  },
};

const criarLead: Rota = {
  metodo: "POST",
  caminho: "/leads",
  permissao: "clientes:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const telefone = exigirTexto(body, "telefone");
    const canal = opcionalTexto(body, "canal_entrada") ?? "whatsapp";
    if (!(CANAIS as readonly string[]).includes(canal)) {
      throw new BadRequestError(`canal_entrada inválido. Use um de: ${CANAIS.join(", ")}`);
    }
    const atendido = opcionalTexto(body, "atendido_por_tipo") ?? "humano";
    if (atendido !== "ia" && atendido !== "humano") {
      throw new BadRequestError('atendido_por_tipo deve ser "ia" ou "humano"');
    }

    // Lead pode já estar vinculado a um cliente conhecido (por telefone).
    const cliente = sqlite
      .query(`SELECT id, nome FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
      .get(org, telefone) as { id: string; nome: string } | null;

    const id = uuid();
    const agora = Date.now();
    sqlite
      .query(
        `INSERT INTO leads
           (id, organizacao_id, cliente_id, nome, telefone, etapa, canal_entrada,
            atendido_por_tipo, primeira_resposta_em, ultima_interacao_em)
         VALUES (?, ?, ?, ?, ?, 'novo', ?, ?, ?, ?)`,
      )
      .run(
        id,
        org,
        cliente?.id ?? null,
        opcionalTexto(body, "nome") ?? cliente?.nome ?? null,
        telefone,
        canal,
        atendido,
        // Sem primeira_resposta_em: o lead acabou de nascer, ninguém respondeu.
        null,
        agora,
      );

    return json({ lead: { id, telefone, etapa: "novo", cliente_id: cliente?.id ?? null } }, 201);
  },
};

/**
 * Move o lead de etapa. Duas regras da spec:
 *  - `perdido` EXIGE motivo da lista configurada + observação livre;
 *  - a qualificação automática de cliente acontece na transição (cliente_id
 *    passa a apontar para o cliente criado/vinculado).
 */
const moverLead: Rota = {
  metodo: "PATCH",
  caminho: "/leads/:id/etapa",
  permissao: "clientes:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const etapa = exigirTexto(body, "etapa");
    if (!(ETAPAS as readonly string[]).includes(etapa)) {
      throw new BadRequestError(`Etapa inválida. Use uma de: ${ETAPAS.join(", ")}`);
    }

    const lead = sqlite
      .query(`SELECT * FROM leads WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as
      | { id: string; telefone: string; cliente_id: string | null; nome: string | null; etapa: string }
      | null;
    if (!lead) throw new NotFoundError("Lead não encontrado nesta organização");

    // `ultima_interacao_em` grava em milissegundos, como todo ts() do schema.
    const agora = Date.now();
    const campos: string[] = ["etapa = ?", "ultima_interacao_em = ?"];
    const valores: unknown[] = [etapa, agora];

    if (etapa === "perdido") {
      const motivo_perda_id = exigirTexto(body, "motivo_perda_id");
      const motivo = sqlite
        .query(`SELECT id FROM motivos_perda WHERE organizacao_id = ? AND id = ?`)
        .get(org, motivo_perda_id);
      if (!motivo) throw new BadRequestError("Motivo de perda não encontrado nesta organização");

      campos.push("motivo_perda_id = ?");
      valores.push(motivo_perda_id);
      campos.push("observacao_perda = ?");
      valores.push(opcionalTexto(body, "observacao_perda") ?? null);
    } else if (body.motivo_perda_id !== undefined) {
      // Motivo só faz sentido em "perdido" — limpa ao sair de lá.
      campos.push("motivo_perda_id = NULL", "observacao_perda = NULL");
    }

    let cliente_id = lead.cliente_id;
    // Conversão lead → cliente no momento em que entra em "qualificado".
    if (etapa === "qualificado" && !cliente_id) {
      const existente = sqlite
        .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
        .get(org, lead.telefone) as { id: string } | null;
      if (existente) {
        cliente_id = existente.id;
      } else {
        cliente_id = uuid();
        const lgpd = body.lgpd_consentimento === true;
        sqlite
          .query(
            `INSERT INTO clientes
               (id, organizacao_id, nome, telefone, origem_lead, lgpd_consentimento, lgpd_data, lgpd_canal, ativo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(
            cliente_id,
            org,
            lead.nome ?? opcionalTexto(body, "nome") ?? lead.telefone,
            lead.telefone,
            opcionalTexto(body, "origem_lead") ?? "lead",
            lgpd ? 1 : 0,
            lgpd ? agora : null,
            lgpd ? (opcionalTexto(body, "lgpd_canal") ?? "whatsapp") : null,
          );
      }
      campos.push("cliente_id = ?");
      valores.push(cliente_id);
    }

    valores.push(org, params.id);
    sqlite
      .query(`UPDATE leads SET ${campos.join(", ")} WHERE organizacao_id = ? AND id = ?`)
      .run(...(valores as never[]));

    return json({ id: params.id, etapa, cliente_id });
  },
};

/**
 * Reativação disparada manualmente pela recepção. O job automático (Fase 8)
 * grava no mesmo log, para o retorno ser medido por um único denominador.
 */
const registrarReativacao: Rota = {
  metodo: "POST",
  caminho: "/clientes/:id/reativacoes",
  permissao: "clientes:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const cliente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!cliente) throw new NotFoundError("Cliente não encontrado nesta organização");

    const id = uuid();
    sqlite
      .query(
        `INSERT INTO reativacoes_log (id, organizacao_id, cliente_id, disparado_em, retornou)
         VALUES (?, ?, ?, ?, 0)`,
      )
      .run(id, org, params.id, Date.now());

    return json(
      {
        reativacao: { id, cliente_id: params.id },
        canal: opcionalTexto(body, "canal") ?? "whatsapp",
      },
      201,
    );
  },
};

/** Marca que o cliente retornou depois da reativação — fecha a métrica. */
const marcarRetorno: Rota = {
  metodo: "PATCH",
  caminho: "/clientes/reativacoes/:id/retorno",
  permissao: "clientes:write",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const existente = sqlite
      .query(`SELECT id FROM reativacoes_log WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!existente) throw new NotFoundError("Reativação não encontrada nesta organização");

    sqlite
      .query(`UPDATE reativacoes_log SET retornou = 1, data_retorno = ? WHERE organizacao_id = ? AND id = ?`)
      .run(Date.now(), org, params.id);
    return json({ id: params.id, retornou: true });
  },
};

export const rotasClientes: Rota[] = [
  listarClientes,
  listarSegmentos,
  listarTags,
  criarTag,
  listarMotivosPerda,
  criarMotivoPerda,
  obterCliente,
  criarCliente,
  atualizarCliente,
  aplicarTag,
  removerTag,
  listarLeads,
  criarLead,
  moverLead,
  registrarReativacao,
  marcarRetorno,
];
