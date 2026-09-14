import { confirmarAtendimento, EFEITOS, type StatusAtendimento } from "../lib/contabil";
import { apenasPropriosAtendimentos } from "../middleware/permissoes";
import { profissionalDoUsuario } from "../lib/org";
import {
  json,
  lerCorpo,
  exigirTexto,
  opcionalTexto,
  opcionalNumero,
  BadRequestError,
  NotFoundError,
} from "../http";
import type { Rota, ContextoRota } from "../router";

const STATUS_VALIDOS = Object.keys(EFEITOS) as StatusAtendimento[];

function hidratarAtendimentos(sqlite: ContextoRota["sqlite"], org: string, rows: Record<string, unknown>[]) {
  const cliente = sqlite.query(`SELECT id, nome, telefone FROM clientes WHERE organizacao_id = ? AND id = ?`);
  const profissional = sqlite.query(`SELECT id, nome, cor FROM profissionais WHERE organizacao_id = ? AND id = ?`);
  const procedimento = sqlite.query(`SELECT id, nome, duracao_min, preco FROM procedimentos WHERE organizacao_id = ? AND id = ?`);
  return rows.map((r) => ({
    ...r,
    cliente: cliente.get(org, r.cliente_id as string),
    profissional: profissional.get(org, r.profissional_id as string),
    procedimento: procedimento.get(org, r.procedimento_id as string),
    // O efeito contábil acompanha cada linha: o front não recalcula a regra.
    efeito: EFEITOS[r.status as StatusAtendimento],
  }));
}

/**
 * Registra o atendimento. Todo o efeito contábil (receita, baixa de estoque,
 * devolução, no-show) está em `confirmarAtendimento` — uma transação única.
 * Aqui só se valida entrada e se resolve a permissão.
 */
const registrarAtendimento: Rota = {
  metodo: "POST",
  caminho: "/atendimentos",
  permissao: "atendimentos:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;

    const cliente_id = exigirTexto(body, "cliente_id");
    const procedimento_id = exigirTexto(body, "procedimento_id");
    const status = exigirTexto(body, "status") as StatusAtendimento;
    if (!STATUS_VALIDOS.includes(status)) {
      throw new BadRequestError(`Status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}`);
    }

    const agendamento_id = opcionalTexto(body, "agendamento_id") ?? null;

    // Com agendamento, cliente/profissional/procedimento vêm dele — evita
    // registrar atendimento de um agendamento e outro procedimento.
    let profissional_id: string;
    let clienteFinal = cliente_id;
    let procedimentoFinal = procedimento_id;

    if (agendamento_id) {
      const ag = sqlite
        .query(
          `SELECT cliente_id, profissional_id, procedimento_id FROM agendamentos
           WHERE organizacao_id = ? AND id = ?`,
        )
        .get(org, agendamento_id) as
        | { cliente_id: string; profissional_id: string; procedimento_id: string }
        | null;
      if (!ag) throw new BadRequestError("Agendamento não encontrado nesta organização");
      clienteFinal = ag.cliente_id;
      profissional_id = ag.profissional_id;
      procedimentoFinal = ag.procedimento_id;
    } else {
      const cliente = sqlite
        .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND id = ?`)
        .get(org, cliente_id);
      if (!cliente) throw new BadRequestError("Cliente não encontrado nesta organização");

      const informado = opcionalTexto(body, "profissional_id");
      if (apenasPropriosAtendimentos(session.role)) {
        const proprio = profissionalDoUsuario(sqlite, org, session.usuario_id);
        if (!proprio) throw new BadRequestError("Usuário sem profissional vinculado");
        profissional_id = proprio;
      } else if (informado) {
        profissional_id = informado;
      } else {
        throw new BadRequestError("Informe profissional_id");
      }
      const prof = sqlite
        .query(`SELECT id FROM profissionais WHERE organizacao_id = ? AND id = ?`)
        .get(org, profissional_id);
      if (!prof) throw new BadRequestError("Profissional não encontrado nesta organização");
    }

    const proc = sqlite
      .query(`SELECT id, preco FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, procedimentoFinal) as { id: string; preco: number } | null;
    if (!proc) throw new BadRequestError("Procedimento não encontrado nesta organização");

    // Sem valor explícito, usa o preço do catálogo. Nunca inventa valor.
    const valor = opcionalNumero(body, "valor") ?? proc.preco;
    if (valor < 0) throw new BadRequestError("valor não pode ser negativo");

    const resultado = confirmarAtendimento(sqlite, {
      organizacao_id: org,
      agendamento_id,
      cliente_id: clienteFinal,
      profissional_id,
      procedimento_id: procedimentoFinal,
      status,
      valor,
      forma_pagamento: opcionalTexto(body, "forma_pagamento"),
      observacoes: opcionalTexto(body, "observacoes"),
    });

    const row = sqlite
      .query(`SELECT * FROM atendimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, resultado.id) as Record<string, unknown>;

    return json(
      { atendimento: hidratarAtendimentos(sqlite, org, [row])[0], efeito: EFEITOS[status] },
      201,
    );
  },
};

/**
 * Lista atendimentos. Quem só tem `atendimentos:read_own` enxerga apenas os
 * próprios — o vínculo vem do banco.
 */
const listarAtendimentos: Rota = {
  metodo: "GET",
  caminho: "/atendimentos",
  permissao: "atendimentos:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const filtros = ["organizacao_id = ?"];
    const valores: unknown[] = [org];

    if (apenasPropriosAtendimentos(session.role)) {
      const prof = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (!prof) return json({ atendimentos: [], aviso: "Usuário sem profissional vinculado" });
      filtros.push("profissional_id = ?");
      valores.push(prof);
    } else {
      const profissional_id = url.searchParams.get("profissional_id");
      if (profissional_id) {
        filtros.push("profissional_id = ?");
        valores.push(profissional_id);
      }
    }

    const cliente_id = url.searchParams.get("cliente_id");
    if (cliente_id) {
      filtros.push("cliente_id = ?");
      valores.push(cliente_id);
    }
    const status = url.searchParams.get("status");
    if (status) {
      if (!STATUS_VALIDOS.includes(status as StatusAtendimento)) {
        throw new BadRequestError(`Status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}`);
      }
      filtros.push("status = ?");
      valores.push(status);
    }
    const de = url.searchParams.get("de");
    if (de) {
      const ms = Date.parse(de);
      if (Number.isNaN(ms)) throw new BadRequestError("de deve ser um instante ISO 8601");
      filtros.push("criado_em >= ?");
      valores.push(ms);
    }
    const ate = url.searchParams.get("ate");
    if (ate) {
      const ms = Date.parse(ate);
      if (Number.isNaN(ms)) throw new BadRequestError("ate deve ser um instante ISO 8601");
      filtros.push("criado_em <= ?");
      valores.push(ms);
    }

    const rows = sqlite
      .query(`SELECT * FROM atendimentos WHERE ${filtros.join(" AND ")} ORDER BY criado_em DESC LIMIT 500`)
      .all(...(valores as never[])) as Record<string, unknown>[];

    return json({ atendimentos: hidratarAtendimentos(sqlite, org, rows) });
  },
};

const obterAtendimento: Rota = {
  metodo: "GET",
  caminho: "/atendimentos/:id",
  permissao: "atendimentos:read",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const row = sqlite
      .query(`SELECT * FROM atendimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as Record<string, unknown> | null;
    if (!row) throw new NotFoundError("Atendimento não encontrado nesta organização");

    if (apenasPropriosAtendimentos(session.role)) {
      const prof = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (row.profissional_id !== prof) {
        throw new NotFoundError("Atendimento não encontrado nesta organização");
      }
    }
    return json({ atendimento: hidratarAtendimentos(sqlite, org, [row])[0] });
  },
};

/**
 * Taxa de no-show por cliente e por profissional. Calculada por consulta
 * agregada — a spec proíbe tabela dedicada para isso.
 */
const taxaNoShow: Rota = {
  metodo: "GET",
  caminho: "/atendimentos/indicadores/no-show",
  permissao: "relatorios:read",
  handler({ sqlite, session }) {
    const org = session.organizacao_id;

    const porProfissional = sqlite
      .query(
        `SELECT profissional_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'falta' THEN 1 ELSE 0 END) AS faltas
         FROM atendimentos WHERE organizacao_id = ?
         GROUP BY profissional_id`,
      )
      .all(org) as { profissional_id: string; total: number; faltas: number }[];

    const porCliente = sqlite
      .query(
        `SELECT cliente_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'falta' THEN 1 ELSE 0 END) AS faltas
         FROM atendimentos WHERE organizacao_id = ?
         GROUP BY cliente_id
         HAVING faltas > 0
         ORDER BY faltas DESC, total DESC LIMIT 100`,
      )
      .all(org) as { cliente_id: string; total: number; faltas: number }[];

    const nome = sqlite.query(`SELECT nome FROM profissionais WHERE organizacao_id = ? AND id = ?`);
    const nomeCliente = sqlite.query(`SELECT nome, telefone FROM clientes WHERE organizacao_id = ? AND id = ?`);

    const taxa = (total: number, faltas: number) => (total === 0 ? 0 : faltas / total);

    return json({
      por_profissional: porProfissional.map((r) => ({
        profissional: nome.get(org, r.profissional_id),
        total: r.total,
        faltas: r.faltas,
        taxa: taxa(r.total, r.faltas),
      })),
      por_cliente: porCliente.map((r) => ({
        cliente: nomeCliente.get(org, r.cliente_id),
        total: r.total,
        faltas: r.faltas,
        taxa: taxa(r.total, r.faltas),
      })),
    });
  },
};

/** Estorna um atendimento concluído ou brinde, devolvendo o estoque. */
const reembolsarAtendimento: Rota = {
  metodo: "POST",
  caminho: "/atendimentos/:id/reembolsar",
  permissao: "financeiro:read",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const observacoes = opcionalTexto(body, "observacoes");
    let row: Record<string, unknown> | null = null;

    const tx = sqlite.transaction(() => {
      const original = sqlite
        .query(`SELECT * FROM atendimentos WHERE organizacao_id = ? AND id = ?`)
        .get(org, params.id) as Record<string, unknown> | null;
      if (!original) throw new NotFoundError("Atendimento não encontrado nesta organização");

      const statusOriginal = original.status as StatusAtendimento;
      if (statusOriginal === "reembolsado") {
        throw new BadRequestError("Este atendimento já foi reembolsado");
      }
      if (statusOriginal !== "concluido" && statusOriginal !== "brinde") {
        throw new BadRequestError(
          `Só é possível reembolsar atendimento com status "concluido" ou "brinde" (atual: "${statusOriginal}")`,
        );
      }

      // Inverte os movimentos efetivamente gerados pelo atendimento. Recalcular
      // pela ficha atual poderia devolver uma quantidade diferente da consumida.
      const saidas = sqlite
        .query(
          `SELECT insumo_id, SUM(quantidade) AS quantidade
           FROM movimentacoes_estoque
           WHERE organizacao_id = ? AND atendimento_id = ? AND tipo = 'saida'
           GROUP BY insumo_id`,
        )
        .all(org, params.id) as { insumo_id: string; quantidade: number }[];
      for (const saida of saidas) {
        sqlite
          .query(
            `INSERT INTO movimentacoes_estoque
              (id, organizacao_id, insumo_id, atendimento_id, tipo, quantidade, motivo)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .run(crypto.randomUUID(), org, saida.insumo_id, params.id, "entrada", saida.quantidade, "devolucao:reembolso");
        sqlite
          .query(`UPDATE insumos SET estoque_atual = estoque_atual + ? WHERE organizacao_id = ? AND id = ?`)
          .run(saida.quantidade, org, saida.insumo_id);
      }

      if (statusOriginal === "concluido" && (original.valor as number) > 0) {
        sqlite
          .query(
            `UPDATE pagamentos SET status = 'estornado'
             WHERE organizacao_id = ? AND atendimento_id = ? AND status = 'pago'`,
          )
          .run(org, params.id);
      }

      sqlite
        .query(
          `UPDATE atendimentos
           SET status = 'reembolsado',
               observacoes = CASE
                 WHEN ? IS NULL THEN observacoes
                 WHEN observacoes IS NULL OR observacoes = '' THEN ?
                 ELSE observacoes || '\n\n[Reembolso] ' || ?
               END
           WHERE organizacao_id = ? AND id = ? AND status IN ('concluido', 'brinde')`,
        )
        .run(observacoes ?? null, observacoes ?? null, observacoes ?? null, org, params.id);
      row = sqlite
        .query(`SELECT * FROM atendimentos WHERE organizacao_id = ? AND id = ?`)
        .get(org, params.id) as Record<string, unknown>;
    });
    tx();

    return json(
      { atendimento: hidratarAtendimentos(sqlite, org, [row!])[0], reembolsado_de: params.id },
      201,
    );
  },
};

/** Movimentações de estoque — rastreio de por que o saldo mudou. */
const listarMovimentacoes: Rota = {
  metodo: "GET",
  caminho: "/atendimentos/estoque/movimentacoes",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const filtros = ["m.organizacao_id = ?"];
    const valores: unknown[] = [session.organizacao_id];
    const insumo_id = url.searchParams.get("insumo_id");
    if (insumo_id) {
      filtros.push("m.insumo_id = ?");
      valores.push(insumo_id);
    }
    const rows = sqlite
      .query(
        `SELECT m.*, i.nome AS insumo_nome, i.unidade
         FROM movimentacoes_estoque m
         JOIN insumos i ON i.id = m.insumo_id AND i.organizacao_id = m.organizacao_id
         WHERE ${filtros.join(" AND ")}
         ORDER BY m.criado_em DESC LIMIT 500`,
      )
      .all(...(valores as never[]));
    return json({ movimentacoes: rows });
  },
};

/** Insumos abaixo do mínimo — sinal de reposição, calculado, não cadastrado. */
const insumosEmFalta: Rota = {
  metodo: "GET",
  caminho: "/atendimentos/estoque/abaixo-do-minimo",
  permissao: "relatorios:read",
  handler({ sqlite, session }) {
    const rows = sqlite
      .query(
        `SELECT id, nome, unidade, estoque_atual, estoque_minimo
         FROM insumos WHERE organizacao_id = ? AND ativo = 1 AND estoque_atual < estoque_minimo
         ORDER BY (estoque_minimo - estoque_atual) DESC`,
      )
      .all(session.organizacao_id);
    return json({ insumos: rows });
  },
};

export const rotasAtendimentos: Rota[] = [
  listarAtendimentos,
  taxaNoShow,
  listarMovimentacoes,
  insumosEmFalta,
  obterAtendimento,
  registrarAtendimento,
  reembolsarAtendimento,
];
