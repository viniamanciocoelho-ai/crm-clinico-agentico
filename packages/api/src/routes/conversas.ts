import { carregarOrg } from "../lib/org";
import { escalarHumano, detectarEscalada } from "../lib/agente";
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

const STATUS = ["com_ia", "aguardando_humano", "com_humano", "encerrada"] as const;
/** Momento em que o cliente pediu para falar com uma pessoa. */
const STATUS_QUE_PEDEM_HUMANO = ["aguardando_humano"] as const;

function mensagensDaConversa(sqlite: ContextoRota["sqlite"], org: string, conversa_id: string) {
  return sqlite
    .query(
      `SELECT id, remetente_tipo, remetente_id, conteudo, criado_em
       FROM mensagens WHERE organizacao_id = ? AND conversa_id = ? ORDER BY criado_em`,
    )
    .all(org, conversa_id);
}

export function registrarMensagem(
  sqlite: ContextoRota["sqlite"],
  org: string,
  conversa_id: string,
  remetente_tipo: string,
  conteudo: string,
  remetente_id: string | null = null,
) {
  const agora = Date.now();
  sqlite
    .query(
      `INSERT INTO mensagens (id, organizacao_id, conversa_id, remetente_tipo, remetente_id, conteudo)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(uuid(), org, conversa_id, remetente_tipo, remetente_id, conteudo);

  // `ultima_mensagem_em` é desnormalização deliberada: a fila humana ordena por
  // ela e um MAX() por linha em cada listagem sairia caro.
  sqlite
    .query(`UPDATE conversas SET ultima_mensagem_em = ? WHERE organizacao_id = ? AND id = ?`)
    .run(agora, org, conversa_id);
}

/**
 * Fila de atendimento humano. Só as conversas escaladas entram aqui — é o que
 * a recepção precisa ver, não o histórico inteiro do agente.
 */
const listarConversas: Rota = {
  metodo: "GET",
  caminho: "/conversas",
  permissao: "conversas:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const filtros = ["c.organizacao_id = ?"];
    const valores: unknown[] = [org];

    const status = url.searchParams.get("status");
    if (status) {
      if (!(STATUS as readonly string[]).includes(status)) {
        throw new BadRequestError(`Status inválido. Use um de: ${STATUS.join(", ")}`);
      }
      filtros.push("c.status = ?");
      valores.push(status);
    }
    if (url.searchParams.get("fila") === "1") {
      filtros.push(`c.status IN (${STATUS_QUE_PEDEM_HUMANO.map(() => "?").join(",")})`);
      valores.push(...STATUS_QUE_PEDEM_HUMANO);
    }

    const rows = sqlite
      .query(
        `SELECT c.id, c.canal, c.telefone, c.status, c.motivo_escalada, c.ultima_mensagem_em,
                c.criado_em, c.cliente_id, c.lead_id,
                cl.nome AS cliente_nome,
                (SELECT conteudo FROM mensagens m
                  WHERE m.organizacao_id = c.organizacao_id AND m.conversa_id = c.id
                  ORDER BY m.criado_em DESC LIMIT 1) AS ultima_mensagem,
                (SELECT COUNT(*) FROM mensagens m
                  WHERE m.organizacao_id = c.organizacao_id AND m.conversa_id = c.id) AS total_mensagens
         FROM conversas c
         LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.organizacao_id = c.organizacao_id
         WHERE ${filtros.join(" AND ")}
         ORDER BY c.ultima_mensagem_em DESC NULLS LAST, c.criado_em DESC
         LIMIT 300`,
      )
      .all(...(valores as never[]));
    return json({ conversas: rows });
  },
};

const obterConversa: Rota = {
  metodo: "GET",
  caminho: "/conversas/:id",
  permissao: "conversas:read",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const conversa = sqlite
      .query(`SELECT * FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as Record<string, unknown> | null;
    if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");

    const cliente = conversa.cliente_id
      ? sqlite
          .query(`SELECT id, nome, telefone FROM clientes WHERE organizacao_id = ? AND id = ?`)
          .get(org, conversa.cliente_id as string)
      : null;

    return json({ conversa, cliente, mensagens: mensagensDaConversa(sqlite, org, params.id) });
  },
};

/**
 * Abre (ou reaproveita) a conversa de um telefone. A chave é telefone + canal:
 * o mesmo número não deve virar duas conversas em aberto.
 */
const abrirConversa: Rota = {
  metodo: "POST",
  caminho: "/conversas",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const telefone = exigirTexto(body, "telefone");
    const canal = opcionalTexto(body, "canal") ?? "whatsapp";

    const aberta = sqlite
      .query(
        `SELECT * FROM conversas WHERE organizacao_id = ? AND telefone = ? AND canal = ?
         AND status != 'encerrada' ORDER BY criado_em DESC LIMIT 1`,
      )
      .get(org, telefone, canal) as Record<string, unknown> | null;

    if (aberta) {
      return json({ conversa: aberta, reaproveitada: true });
    }

    const cliente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
      .get(org, telefone) as { id: string } | null;
    const lead_id = opcionalTexto(body, "lead_id") ?? null;
    if (lead_id) {
      const lead = sqlite
        .query(`SELECT id FROM leads WHERE organizacao_id = ? AND id = ?`)
        .get(org, lead_id);
      if (!lead) throw new BadRequestError("Lead não encontrado nesta organização");
    }

    const id = uuid();
    sqlite
      .query(
        `INSERT INTO conversas (id, organizacao_id, cliente_id, lead_id, canal, telefone, status, ultima_mensagem_em)
         VALUES (?, ?, ?, ?, ?, ?, 'com_ia', ?)`,
      )
      .run(
        id,
        org,
        cliente?.id ?? null,
        lead_id,
        canal,
        telefone,
        Date.now(),
      );

    const conversa = sqlite
      .query(`SELECT * FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, id);
    return json({ conversa, reaproveitada: false }, 201);
  },
};

/**
 * Registra a mensagem que o cliente enviou. Se ele pedir humano, ou se for
 * caso clínico/urgência/reclamação, a conversa é escalada na mesma chamada —
 * a detecção é do agente, não do atendente.
 */
const receberMensagemCliente: Rota = {
  metodo: "POST",
  caminho: "/conversas/:id/mensagens",
  permissao: "conversas:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conteudo = exigirTexto(body, "conteudo");
    const remetente_tipo = opcionalTexto(body, "remetente_tipo");
    if (remetente_tipo !== undefined && remetente_tipo !== "cliente") {
      throw new BadRequestError("Esta rota só registra mensagens do cliente");
    }

    const conversa = sqlite
      .query(`SELECT id, status, cliente_id FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as { id: string; status: string; cliente_id: string | null } | null;
    if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");
    if (conversa.status === "encerrada") {
      throw new BadRequestError("Conversa encerrada não aceita novas mensagens");
    }

    registrarMensagem(sqlite, org, params.id, "cliente", conteudo, null);

    const motivo = detectarEscalada(conteudo);
    // Só escala conversa que ainda está com a IA — quem já está na fila humana
    // não precisa ser escalado de novo.
    if (motivo && conversa.status === "com_ia") {
      const cfg = carregarOrg(sqlite, org);
      const resultado = escalarHumano(
        sqlite,
        { organizacao_id: org, timezone: cfg.timezone },
        params.id,
        motivo,
      );
      registrarMensagem(sqlite, org, params.id, "ia", resultado.resposta, null);
      return json({ registrada: true, status: "aguardando_humano", motivo_escalada: motivo, resposta_ia: resultado.resposta });
    }

    return json({ registrada: true, status: conversa.status, motivo_escalada: motivo ?? null });
  },
};

/** Resposta do atendente humano. Assume a conversa para si. */
const responderComoHumano: Rota = {
  metodo: "POST",
  caminho: "/conversas/:id/responder",
  permissao: "conversas:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conteudo = exigirTexto(body, "conteudo");

    const conversa = sqlite
      .query(`SELECT id, status FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as { id: string; status: string } | null;
    if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");
    if (conversa.status === "encerrada") {
      throw new BadRequestError("Conversa encerrada não aceita novas mensagens");
    }

    registrarMensagem(sqlite, org, params.id, "humano", conteudo, session.usuario_id);
    // Responder assume a conversa: enquanto o humano estiver nela, a IA não responde.
    if (conversa.status !== "com_humano") {
      sqlite
        .query(`UPDATE conversas SET status = 'com_humano' WHERE organizacao_id = ? AND id = ?`)
        .run(org, params.id);
    }
    return json({ respondida: true, status: "com_humano" });
  },
};

/** Devolve a conversa ao agente após a equipe resolver o que precisava. */
const devolverParaIa: Rota = {
  metodo: "POST",
  caminho: "/conversas/:id/devolver-ia",
  permissao: "conversas:write",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const conversa = sqlite
      .query(`SELECT id FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");

    sqlite
      .query(
        `UPDATE conversas SET status = 'com_ia', motivo_escalada = NULL WHERE organizacao_id = ? AND id = ?`,
      )
      .run(org, params.id);
    return json({ status: "com_ia" });
  },
};

const encerrarConversa: Rota = {
  metodo: "POST",
  caminho: "/conversas/:id/encerrar",
  permissao: "conversas:write",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const conversa = sqlite
      .query(`SELECT id FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");

    sqlite
      .query(`UPDATE conversas SET status = 'encerrada' WHERE organizacao_id = ? AND id = ?`)
      .run(org, params.id);
    return json({ status: "encerrada" });
  },
};

/**
 * Vincula a conversa a um cliente (quando o lead deixa de ser anônimo).
 * Sem isso, o histórico do cliente ficaria órfão da conversa que o originou.
 */
const vincularClienteConversa: Rota = {
  metodo: "PATCH",
  caminho: "/conversas/:id/cliente",
  permissao: "conversas:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const cliente_id = exigirTexto(body, "cliente_id");

    const conversa = sqlite
      .query(`SELECT id FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");
    const cliente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND id = ?`)
      .get(org, cliente_id);
    if (!cliente) throw new BadRequestError("Cliente não encontrado nesta organização");

    sqlite
      .query(`UPDATE conversas SET cliente_id = ? WHERE organizacao_id = ? AND id = ?`)
      .run(cliente_id, org, params.id);
    return json({ conversa_id: params.id, cliente_id });
  },
};

/** Log de ações da IA — auditoria exigida pela spec (`autor_tipo = ia`). */
const listarAcoesIa: Rota = {
  metodo: "GET",
  caminho: "/conversas/ia/acoes",
  permissao: "conversas:read",
  handler({ sqlite, session, url }) {
    const filtros = ["organizacao_id = ?"];
    const valores: unknown[] = [session.organizacao_id];
    const conversa_id = url.searchParams.get("conversa_id");
    if (conversa_id) {
      filtros.push("conversa_id = ?");
      valores.push(conversa_id);
    }
    const rows = sqlite
      .query(
        `SELECT id, autor_tipo, tipo_acao, conversa_id, dados_entrada, dados_decisao, sucesso, erro, criado_em
         FROM ia_acoes_log WHERE ${filtros.join(" AND ")} ORDER BY criado_em DESC LIMIT 500`,
      )
      .all(...(valores as never[]));
    return json({ acoes: rows });
  },
};

export const rotasConversas: Rota[] = [
  listarConversas,
  listarAcoesIa,
  obterConversa,
  abrirConversa,
  receberMensagemCliente,
  responderComoHumano,
  devolverParaIa,
  encerrarConversa,
  vincularClienteConversa,
];
