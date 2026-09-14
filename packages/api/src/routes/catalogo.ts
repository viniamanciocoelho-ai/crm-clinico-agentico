import { json, lerCorpo, exigirTexto, opcionalTexto, opcionalNumero, BadRequestError } from "../http";
import type { Rota, ContextoRota } from "../router";

const uuid = () => crypto.randomUUID();

/** Procedimentos da organização, com profissionais habilitados e recursos exigidos. */
function procedimentoCompleto(sqlite: ContextoRota["sqlite"], org: string, id: string) {
  const proc = sqlite
    .query(
      `SELECT id, nome, duracao_min, preco, ativo, descricao_publica
       FROM procedimentos WHERE organizacao_id = ? AND id = ?`,
    )
    .get(org, id) as Record<string, unknown> | null;
  if (!proc) return null;

  proc.profissionais = sqlite
    .query(
      `SELECT p.id, p.nome, p.especialidade, p.cor
       FROM procedimento_profissionais pp
       JOIN profissionais p ON p.id = pp.profissional_id AND p.organizacao_id = pp.organizacao_id
       WHERE pp.organizacao_id = ? AND pp.procedimento_id = ?`,
    )
    .all(org, id);

  proc.recursos = sqlite
    .query(
      `SELECT r.id, r.sala_id, r.tempo_preparo_min, r.tempo_limpeza_min, s.nome AS sala_nome, s.tipo
       FROM procedimento_recursos r
       JOIN salas s ON s.id = r.sala_id AND s.organizacao_id = r.organizacao_id
       WHERE r.organizacao_id = ? AND r.procedimento_id = ?`,
    )
    .all(org, id);

  proc.ficha_tecnica = sqlite
    .query(
      `SELECT f.id, f.insumo_id, f.quantidade, i.nome AS insumo_nome, i.unidade, i.custo_unitario
       FROM ficha_tecnica_itens f
       JOIN insumos i ON i.id = f.insumo_id AND i.organizacao_id = f.organizacao_id
       WHERE f.organizacao_id = ? AND f.procedimento_id = ?`,
    )
    .all(org, id);

  return proc;
}

const listarProcedimentos: Rota = {
  metodo: "GET",
  caminho: "/catalogo/procedimentos",
  permissao: "agenda:read",
  handler({ sqlite, session, url }) {
    // `ativos=1` filtra o que pode ser agendado; sem filtro, lista tudo do tenant.
    const apenasAtivos = url.searchParams.get("ativos") === "1";
    const rows = sqlite
      .query(
        `SELECT id, nome, duracao_min, preco, ativo, descricao_publica
         FROM procedimentos WHERE organizacao_id = ?
         ${apenasAtivos ? "AND ativo = 1" : ""}
         ORDER BY nome`,
      )
      .all(session.organizacao_id);
    return json({ procedimentos: rows });
  },
};

const obterProcedimento: Rota = {
  metodo: "GET",
  caminho: "/catalogo/procedimentos/:id",
  permissao: "agenda:read",
  handler({ sqlite, session, params }) {
    const proc = procedimentoCompleto(sqlite, session.organizacao_id, params.id);
    if (!proc) throw new BadRequestError("Procedimento não encontrado nesta organização");
    return json({ procedimento: proc });
  },
};

const criarProcedimento: Rota = {
  metodo: "POST",
  caminho: "/catalogo/procedimentos",
  permissao: "agenda:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const nome = exigirTexto(body, "nome");
    const duracao = opcionalNumero(body, "duracao_min");
    const preco = opcionalNumero(body, "preco");
    if (duracao === undefined || duracao <= 0) {
      throw new BadRequestError("duracao_min é obrigatório e deve ser maior que zero");
    }
    if (preco === undefined || preco < 0) {
      throw new BadRequestError("preco é obrigatório e não pode ser negativo");
    }

    const id = uuid();
    sqlite
      .query(
        `INSERT INTO procedimentos
           (id, organizacao_id, nome, duracao_min, preco, ativo, descricao_publica)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, session.organizacao_id, nome, duracao, preco, opcionalTexto(body, "descricao_publica") ?? null);

    return json({ procedimento: procedimentoCompleto(sqlite, session.organizacao_id, id) }, 201);
  },
};

const atualizarProcedimento: Rota = {
  metodo: "PATCH",
  caminho: "/catalogo/procedimentos/:id",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const existente = sqlite
      .query(`SELECT id FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
      .get(session.organizacao_id, params.id);
    if (!existente) throw new BadRequestError("Procedimento não encontrado nesta organização");

    const campos: string[] = [];
    const valores: unknown[] = [];
    if (body.nome !== undefined) {
      campos.push("nome = ?");
      valores.push(exigirTexto(body, "nome"));
    }
    const duracao = opcionalNumero(body, "duracao_min");
    if (duracao !== undefined) {
      if (duracao <= 0) throw new BadRequestError("duracao_min deve ser maior que zero");
      campos.push("duracao_min = ?");
      valores.push(duracao);
    }
    const preco = opcionalNumero(body, "preco");
    if (preco !== undefined) {
      if (preco < 0) throw new BadRequestError("preco não pode ser negativo");
      campos.push("preco = ?");
      valores.push(preco);
    }
    if (body.ativo !== undefined) {
      if (typeof body.ativo !== "boolean") throw new BadRequestError("ativo deve ser booleano");
      campos.push("ativo = ?");
      valores.push(body.ativo ? 1 : 0);
    }
    if (body.descricao_publica !== undefined) {
      campos.push("descricao_publica = ?");
      valores.push(opcionalTexto(body, "descricao_publica") ?? null);
    }
    if (campos.length === 0) throw new BadRequestError("Nenhum campo válido para atualizar");

    valores.push(session.organizacao_id, params.id);
    sqlite
      .query(`UPDATE procedimentos SET ${campos.join(", ")} WHERE organizacao_id = ? AND id = ?`)
      .run(...(valores as never[]));

    return json({ procedimento: procedimentoCompleto(sqlite, session.organizacao_id, params.id) });
  },
};

/** Vincula profissional ao procedimento. Idempotente: revincular não duplica. */
const vincularProfissional: Rota = {
  metodo: "POST",
  caminho: "/catalogo/procedimentos/:id/profissionais",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const profissional_id = exigirTexto(body, "profissional_id");
    const org = session.organizacao_id;

    const proc = sqlite
      .query(`SELECT id FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!proc) throw new BadRequestError("Procedimento não encontrado nesta organização");
    const prof = sqlite
      .query(`SELECT id FROM profissionais WHERE organizacao_id = ? AND id = ?`)
      .get(org, profissional_id);
    if (!prof) throw new BadRequestError("Profissional não encontrado nesta organização");

    const jaExiste = sqlite
      .query(
        `SELECT id FROM procedimento_profissionais
         WHERE organizacao_id = ? AND procedimento_id = ? AND profissional_id = ?`,
      )
      .get(org, params.id, profissional_id);
    if (!jaExiste) {
      sqlite
        .query(
          `INSERT INTO procedimento_profissionais (id, organizacao_id, procedimento_id, profissional_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run(uuid(), org, params.id, profissional_id);
    }
    return json({ procedimento: procedimentoCompleto(sqlite, org, params.id) }, jaExiste ? 200 : 201);
  },
};

const desvincularProfissional: Rota = {
  metodo: "DELETE",
  caminho: "/catalogo/procedimentos/:id/profissionais/:profissionalId",
  permissao: "agenda:write",
  handler({ sqlite, session, params }) {
    sqlite
      .query(
        `DELETE FROM procedimento_profissionais
         WHERE organizacao_id = ? AND procedimento_id = ? AND profissional_id = ?`,
      )
      .run(session.organizacao_id, params.id, params.profissionalId);
    return json({ removido: true });
  },
};

/**
 * Vincula sala/recurso ao procedimento, com tempo de preparo e limpeza.
 * Esses tempos entram no bloco de ocupação da regra 3 — são eles que fazem
 * o agendamento seguinte não colar no anterior.
 */
const vincularRecurso: Rota = {
  metodo: "POST",
  caminho: "/catalogo/procedimentos/:id/recursos",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const sala_id = exigirTexto(body, "sala_id");
    const preparo = opcionalNumero(body, "tempo_preparo_min") ?? 0;
    const limpeza = opcionalNumero(body, "tempo_limpeza_min") ?? 0;
    if (preparo < 0 || limpeza < 0) {
      throw new BadRequestError("Tempos de preparo e limpeza não podem ser negativos");
    }
    const org = session.organizacao_id;

    const proc = sqlite
      .query(`SELECT id FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!proc) throw new BadRequestError("Procedimento não encontrado nesta organização");
    const sala = sqlite
      .query(`SELECT id FROM salas WHERE organizacao_id = ? AND id = ?`)
      .get(org, sala_id);
    if (!sala) throw new BadRequestError("Sala/recurso não encontrado nesta organização");

    const jaExiste = sqlite
      .query(
        `SELECT id FROM procedimento_recursos
         WHERE organizacao_id = ? AND procedimento_id = ? AND sala_id = ?`,
      )
      .get(org, params.id, sala_id);

    if (jaExiste) {
      sqlite
        .query(
          `UPDATE procedimento_recursos SET tempo_preparo_min = ?, tempo_limpeza_min = ?
           WHERE organizacao_id = ? AND id = ?`,
        )
        .run(preparo, limpeza, org, (jaExiste as { id: string }).id);
    } else {
      sqlite
        .query(
          `INSERT INTO procedimento_recursos
             (id, organizacao_id, procedimento_id, sala_id, tempo_preparo_min, tempo_limpeza_min)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(uuid(), org, params.id, sala_id, preparo, limpeza);
    }
    return json({ procedimento: procedimentoCompleto(sqlite, org, params.id) }, 201);
  },
};

const desvincularRecurso: Rota = {
  metodo: "DELETE",
  caminho: "/catalogo/procedimentos/:id/recursos/:recursoId",
  permissao: "agenda:write",
  handler({ sqlite, session, params }) {
    sqlite
      .query(`DELETE FROM procedimento_recursos WHERE organizacao_id = ? AND id = ? AND procedimento_id = ?`)
      .run(session.organizacao_id, params.recursoId, params.id);
    return json({ removido: true });
  },
};

/** Ficha técnica: o que o procedimento consome de estoque. Base do custo real. */
const definirFichaTecnica: Rota = {
  metodo: "PUT",
  caminho: "/catalogo/procedimentos/:id/ficha-tecnica",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    if (!Array.isArray(body.itens)) {
      throw new BadRequestError("itens deve ser uma lista de { insumo_id, quantidade }");
    }
    const org = session.organizacao_id;
    const proc = sqlite
      .query(`SELECT id FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!proc) throw new BadRequestError("Procedimento não encontrado nesta organização");

    const itens = body.itens.map((bruto, i) => {
      const item = bruto as Record<string, unknown>;
      if (!item || typeof item !== "object") {
        throw new BadRequestError(`Item ${i} da ficha técnica não é um objeto`);
      }
      const insumo_id = exigirTexto(item, "insumo_id");
      const quantidade = opcionalNumero(item, "quantidade");
      if (quantidade === undefined || quantidade <= 0) {
        throw new BadRequestError(`Item ${i}: quantidade é obrigatória e deve ser maior que zero`);
      }
      const insumo = sqlite
        .query(`SELECT id FROM insumos WHERE organizacao_id = ? AND id = ?`)
        .get(org, insumo_id);
      if (!insumo) throw new BadRequestError(`Item ${i}: insumo não pertence a esta organização`);
      return { insumo_id, quantidade };
    });

    sqlite.transaction(() => {
      sqlite
        .query(`DELETE FROM ficha_tecnica_itens WHERE organizacao_id = ? AND procedimento_id = ?`)
        .run(org, params.id);
      for (const item of itens) {
        sqlite
          .query(
            `INSERT INTO ficha_tecnica_itens (id, organizacao_id, procedimento_id, insumo_id, quantidade)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(uuid(), org, params.id, item.insumo_id, item.quantidade);
      }
    })();

    return json({ procedimento: procedimentoCompleto(sqlite, org, params.id) });
  },
};

const listarProfissionais: Rota = {
  metodo: "GET",
  caminho: "/catalogo/profissionais",
  permissao: "agenda:read",
  handler({ sqlite, session, url }) {
    const apenasAtivos = url.searchParams.get("ativos") === "1";
    const rows = sqlite
      .query(
        `SELECT id, nome, especialidade, cor, ativo, usuario_id, bloqueios_agenda
         FROM profissionais WHERE organizacao_id = ?
         ${apenasAtivos ? "AND ativo = 1" : ""}
         ORDER BY nome`,
      )
      .all(session.organizacao_id);
    return json({ profissionais: rows });
  },
};

const criarProfissional: Rota = {
  metodo: "POST",
  caminho: "/catalogo/profissionais",
  permissao: "agenda:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const nome = exigirTexto(body, "nome");
    const id = uuid();
    sqlite
      .query(
        `INSERT INTO profissionais (id, organizacao_id, nome, especialidade, cor, ativo, usuario_id)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id,
        session.organizacao_id,
        nome,
        opcionalTexto(body, "especialidade") ?? null,
        opcionalTexto(body, "cor") ?? "#7c8f7a",
        opcionalTexto(body, "usuario_id") ?? null,
      );
    return json({ profissional: { id, nome } }, 201);
  },
};

const atualizarProfissional: Rota = {
  metodo: "PATCH",
  caminho: "/catalogo/profissionais/:id",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const existente = sqlite
      .query(`SELECT id FROM profissionais WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!existente) throw new BadRequestError("Profissional não encontrado nesta organização");

    const campos: string[] = [];
    const valores: unknown[] = [];
    if (body.nome !== undefined) {
      campos.push("nome = ?");
      valores.push(exigirTexto(body, "nome"));
    }
    if (body.especialidade !== undefined) {
      campos.push("especialidade = ?");
      valores.push(opcionalTexto(body, "especialidade") ?? null);
    }
    if (body.cor !== undefined) {
      campos.push("cor = ?");
      valores.push(exigirTexto(body, "cor"));
    }
    if (body.ativo !== undefined) {
      if (typeof body.ativo !== "boolean") throw new BadRequestError("ativo deve ser booleano");
      campos.push("ativo = ?");
      valores.push(body.ativo ? 1 : 0);
    }
    // Bloqueios (férias, manutenção) são lidos pela regra 3 da agenda.
    if (body.bloqueios_agenda !== undefined) {
      if (!Array.isArray(body.bloqueios_agenda)) {
        throw new BadRequestError("bloqueios_agenda deve ser uma lista de { inicio, fim, motivo }");
      }
      campos.push("bloqueios_agenda = ?");
      valores.push(JSON.stringify(body.bloqueios_agenda));
    }
    if (campos.length === 0) throw new BadRequestError("Nenhum campo válido para atualizar");

    valores.push(org, params.id);
    sqlite
      .query(`UPDATE profissionais SET ${campos.join(", ")} WHERE organizacao_id = ? AND id = ?`)
      .run(...(valores as never[]));
    return json({ atualizado: true });
  },
};

const listarSalas: Rota = {
  metodo: "GET",
  caminho: "/catalogo/salas",
  permissao: "agenda:read",
  handler({ sqlite, session, url }) {
    const apenasAtivos = url.searchParams.get("ativos") === "1";
    const rows = sqlite
      .query(
        `SELECT id, nome, tipo, ativo, bloqueios_agenda FROM salas
         WHERE organizacao_id = ? ${apenasAtivos ? "AND ativo = 1" : ""} ORDER BY nome`,
      )
      .all(session.organizacao_id);
    return json({ salas: rows });
  },
};

const criarSala: Rota = {
  metodo: "POST",
  caminho: "/catalogo/salas",
  permissao: "agenda:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const nome = exigirTexto(body, "nome");
    const tipo = opcionalTexto(body, "tipo") ?? "sala";
    if (tipo !== "sala" && tipo !== "equipamento") {
      throw new BadRequestError('tipo deve ser "sala" ou "equipamento"');
    }
    const id = uuid();
    sqlite
      .query(`INSERT INTO salas (id, organizacao_id, nome, tipo, ativo) VALUES (?, ?, ?, ?, 1)`)
      .run(id, session.organizacao_id, nome, tipo);
    return json({ sala: { id, nome, tipo } }, 201);
  },
};

const atualizarSala: Rota = {
  metodo: "PATCH",
  caminho: "/catalogo/salas/:id",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const existente = sqlite
      .query(`SELECT id FROM salas WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!existente) throw new BadRequestError("Sala/recurso não encontrado nesta organização");

    const campos: string[] = [];
    const valores: unknown[] = [];
    if (body.nome !== undefined) {
      campos.push("nome = ?");
      valores.push(exigirTexto(body, "nome"));
    }
    if (body.ativo !== undefined) {
      if (typeof body.ativo !== "boolean") throw new BadRequestError("ativo deve ser booleano");
      campos.push("ativo = ?");
      valores.push(body.ativo ? 1 : 0);
    }
    if (body.bloqueios_agenda !== undefined) {
      if (!Array.isArray(body.bloqueios_agenda)) {
        throw new BadRequestError("bloqueios_agenda deve ser uma lista de { inicio, fim, motivo }");
      }
      campos.push("bloqueios_agenda = ?");
      valores.push(JSON.stringify(body.bloqueios_agenda));
    }
    if (campos.length === 0) throw new BadRequestError("Nenhum campo válido para atualizar");

    valores.push(org, params.id);
    sqlite
      .query(`UPDATE salas SET ${campos.join(", ")} WHERE organizacao_id = ? AND id = ?`)
      .run(...(valores as never[]));
    return json({ atualizado: true });
  },
};

const listarInsumos: Rota = {
  metodo: "GET",
  caminho: "/catalogo/insumos",
  permissao: "agenda:read",
  handler({ sqlite, session, url }) {
    const apenasAtivos = url.searchParams.get("ativos") === "1";
    const rows = sqlite
      .query(
        `SELECT id, nome, unidade, custo_unitario, estoque_atual, estoque_minimo, ativo
         FROM insumos WHERE organizacao_id = ? ${apenasAtivos ? "AND ativo = 1" : ""} ORDER BY nome`,
      )
      .all(session.organizacao_id);
    return json({ insumos: rows });
  },
};

const criarInsumo: Rota = {
  metodo: "POST",
  caminho: "/catalogo/insumos",
  permissao: "agenda:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const nome = exigirTexto(body, "nome");
    const id = uuid();
    sqlite
      .query(
        `INSERT INTO insumos (id, organizacao_id, nome, unidade, custo_unitario, estoque_atual, estoque_minimo, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        session.organizacao_id,
        nome,
        opcionalTexto(body, "unidade") ?? "un",
        opcionalNumero(body, "custo_unitario") ?? 0,
        opcionalNumero(body, "estoque_atual") ?? 0,
        opcionalNumero(body, "estoque_minimo") ?? 0,
      );
    return json({ insumo: { id, nome } }, 201);
  },
};

const atualizarInsumo: Rota = {
  metodo: "PATCH",
  caminho: "/catalogo/insumos/:id",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const existente = sqlite
      .query(`SELECT id FROM insumos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!existente) throw new BadRequestError("Insumo não encontrado nesta organização");

    const campos: string[] = [];
    const valores: unknown[] = [];
    if (body.nome !== undefined) {
      campos.push("nome = ?");
      valores.push(exigirTexto(body, "nome"));
    }
    if (body.unidade !== undefined) {
      campos.push("unidade = ?");
      valores.push(exigirTexto(body, "unidade"));
    }
    for (const campo of ["custo_unitario", "estoque_minimo"] as const) {
      const valor = opcionalNumero(body, campo);
      if (valor !== undefined) {
        if (valor < 0) throw new BadRequestError(`${campo} não pode ser negativo`);
        campos.push(`${campo} = ?`);
        valores.push(valor);
      }
    }
    if (body.ativo !== undefined) {
      if (typeof body.ativo !== "boolean") throw new BadRequestError("ativo deve ser booleano");
      campos.push("ativo = ?");
      valores.push(body.ativo ? 1 : 0);
    }
    if (campos.length === 0) throw new BadRequestError("Nenhum campo válido para atualizar");

    valores.push(org, params.id);
    sqlite
      .query(`UPDATE insumos SET ${campos.join(", ")} WHERE organizacao_id = ? AND id = ?`)
      .run(...(valores as never[]));
    return json({ atualizado: true });
  },
};

/**
 * Entrada de estoque manual. `estoque_atual` nunca é escrito direto — toda
 * alteração passa por movimentação, senão o histórico deixa de bater com o saldo.
 */
const movimentarEstoque: Rota = {
  metodo: "POST",
  caminho: "/catalogo/insumos/:id/movimentacoes",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const tipo = exigirTexto(body, "tipo");
    if (tipo !== "entrada" && tipo !== "saida") {
      throw new BadRequestError('tipo deve ser "entrada" ou "saida"');
    }
    const quantidade = opcionalNumero(body, "quantidade");
    if (quantidade === undefined || quantidade <= 0) {
      throw new BadRequestError("quantidade é obrigatória e deve ser maior que zero");
    }
    const org = session.organizacao_id;
    const insumo = sqlite
      .query(`SELECT id FROM insumos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    if (!insumo) throw new BadRequestError("Insumo não encontrado nesta organização");

    const delta = tipo === "entrada" ? quantidade : -quantidade;
    sqlite.transaction(() => {
      sqlite
        .query(
          `INSERT INTO movimentacoes_estoque
             (id, organizacao_id, insumo_id, atendimento_id, tipo, quantidade, motivo)
           VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(uuid(), org, params.id, tipo, quantidade, opcionalTexto(body, "motivo") ?? "ajuste manual");
      sqlite
        .query(`UPDATE insumos SET estoque_atual = estoque_atual + ? WHERE organizacao_id = ? AND id = ?`)
        .run(delta, org, params.id);
    })();

    const atual = sqlite
      .query(`SELECT estoque_atual FROM insumos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id);
    return json({ insumo_id: params.id, estoque_atual: (atual as { estoque_atual: number }).estoque_atual }, 201);
  },
};

export const rotasCatalogo: Rota[] = [
  listarProcedimentos,
  obterProcedimento,
  criarProcedimento,
  atualizarProcedimento,
  vincularProfissional,
  desvincularProfissional,
  vincularRecurso,
  desvincularRecurso,
  definirFichaTecnica,
  listarProfissionais,
  criarProfissional,
  atualizarProfissional,
  listarSalas,
  criarSala,
  atualizarSala,
  listarInsumos,
  criarInsumo,
  atualizarInsumo,
  movimentarEstoque,
];
