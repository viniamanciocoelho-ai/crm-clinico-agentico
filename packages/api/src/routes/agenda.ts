import { validarAgendamento, horariosLivres } from "../lib/agenda";
import { carregarOrg, profissionalDoUsuario } from "../lib/org";
import { apenasPropriaAgenda } from "../middleware/permissoes";
import {
  json,
  lerCorpo,
  exigirTexto,
  opcionalTexto,
  opcionalNumero,
  exigirInstante,
  BadRequestError,
  NotFoundError,
} from "../http";
import type { Rota, ContextoRota } from "../router";

const uuid = () => crypto.randomUUID();
const min = 60_000;

/** Os únicos status que ocupam slot. Cancelado/remarcado liberam a agenda. */
const OCUPAM = ["agendado", "confirmado"];

interface AgendamentoRow {
  id: string;
  organizacao_id: string;
  cliente_id: string;
  profissional_id: string;
  sala_id: string | null;
  procedimento_id: string;
  inicio: number;
  fim: number;
  inicio_bloqueio: number;
  fim_bloqueio: number;
  status: string;
  origem: string;
  observacoes: string | null;
  lembrete_enviado_24h: number;
  lembrete_enviado_2h: number;
  remarcado_de_id: string | null;
}

/**
 * Resolve procedimento + preparo/limpeza do recurso. Tudo vem do banco da
 * organização: procedimento de outro tenant simplesmente não existe aqui.
 */
function contextoDoAgendamento(
  sqlite: ContextoRota["sqlite"],
  organizacao_id: string,
  procedimento_id: string,
) {
  const proc = sqlite
    .query(`SELECT id, nome, duracao_min, preco FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
    .get(organizacao_id, procedimento_id) as
    | { id: string; nome: string; duracao_min: number; preco: number }
    | null;
  if (!proc) throw new BadRequestError("Procedimento não encontrado nesta organização");

  const recursos = sqlite
    .query(
      `SELECT sala_id, tempo_preparo_min, tempo_limpeza_min
       FROM procedimento_recursos WHERE organizacao_id = ? AND procedimento_id = ?`,
    )
    .all(organizacao_id, procedimento_id) as {
    sala_id: string;
    tempo_preparo_min: number;
    tempo_limpeza_min: number;
  }[];

  return { proc, recursos };
}

/** O profissional precisa existir no tenant e estar habilitado ao procedimento. */
function validarProfissionalParaProcedimento(
  sqlite: ContextoRota["sqlite"],
  organizacao_id: string,
  profissional_id: string,
  procedimento_id: string,
): void {
  const prof = sqlite
    .query(`SELECT id FROM profissionais WHERE organizacao_id = ? AND id = ? AND ativo = 1`)
    .get(organizacao_id, profissional_id);
  if (!prof) throw new BadRequestError("Profissional não encontrado ou inativo nesta organização");

  const habilitado = sqlite
    .query(
      `SELECT id FROM procedimento_profissionais
       WHERE organizacao_id = ? AND procedimento_id = ? AND profissional_id = ?`,
    )
    .get(organizacao_id, procedimento_id, profissional_id);
  if (!habilitado) {
    throw new BadRequestError("Este profissional não está habilitado para o procedimento informado");
  }
}

function hidratar(sqlite: ContextoRota["sqlite"], org: string, rows: AgendamentoRow[]) {
  const cliente = sqlite.query(`SELECT id, nome, telefone FROM clientes WHERE organizacao_id = ? AND id = ?`);
  const profissional = sqlite.query(`SELECT id, nome, cor FROM profissionais WHERE organizacao_id = ? AND id = ?`);
  const procedimento = sqlite.query(`SELECT id, nome, duracao_min, preco FROM procedimentos WHERE organizacao_id = ? AND id = ?`);
  const sala = sqlite.query(`SELECT id, nome FROM salas WHERE organizacao_id = ? AND id = ?`);

  return rows.map((r) => ({
    ...r,
    lembrete_enviado_24h: !!r.lembrete_enviado_24h,
    lembrete_enviado_2h: !!r.lembrete_enviado_2h,
    cliente: cliente.get(org, r.cliente_id),
    profissional: profissional.get(org, r.profissional_id),
    procedimento: procedimento.get(org, r.procedimento_id),
    sala: r.sala_id ? sala.get(org, r.sala_id) : null,
  }));
}

/**
 * Lista a agenda por janela. Quem tem apenas `agenda:read_own` só enxerga a
 * própria coluna — e o vínculo usuário→profissional vem do banco, nunca do
 * request. Sem vínculo cadastrado, a resposta é vazia, não a agenda inteira.
 */
const listarAgenda: Rota = {
  metodo: "GET",
  caminho: "/agenda",
  permissao: "agenda:read",
  handler({ sqlite, session, url }) {
    const de = url.searchParams.get("de");
    const ate = url.searchParams.get("ate");
    if (!de || !ate) throw new BadRequestError("Informe o período em de=<ISO>&ate=<ISO>");
    const deMs = Date.parse(de);
    const ateMs = Date.parse(ate);
    if (Number.isNaN(deMs) || Number.isNaN(ateMs)) {
      throw new BadRequestError("de e ate devem ser instantes ISO 8601");
    }
    if (ateMs <= deMs) throw new BadRequestError("ate deve ser posterior a de");

    const org = session.organizacao_id;
    const filtros: string[] = ["organizacao_id = ?", "inicio < ?", "fim > ?"];
    const valores: unknown[] = [org, ateMs, deMs];

    if (apenasPropriaAgenda(session.role)) {
      const prof = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (!prof) return json({ agendamentos: [], aviso: "Usuário sem profissional vinculado" });
      filtros.push("profissional_id = ?");
      valores.push(prof);
    } else {
      const profissional_id = url.searchParams.get("profissional_id");
      if (profissional_id) {
        filtros.push("profissional_id = ?");
        valores.push(profissional_id);
      }
    }

    const status = url.searchParams.get("status");
    if (status) {
      filtros.push("status = ?");
      valores.push(status);
    } else {
      filtros.push(`status IN (${OCUPAM.map(() => "?").join(",")})`);
      valores.push(...OCUPAM);
    }

    const rows = sqlite
      .query(
        `SELECT * FROM agendamentos WHERE ${filtros.join(" AND ")} ORDER BY inicio`,
      )
      .all(...(valores as never[])) as AgendamentoRow[];

    return json({ agendamentos: hidratar(sqlite, org, rows) });
  },
};

/** Horários livres — alimenta tanto a recepção quanto o agente de IA. */
const horariosDisponiveis: Rota = {
  metodo: "GET",
  caminho: "/agenda/horarios-livres",
  permissao: "agenda:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const procedimento_id = url.searchParams.get("procedimento_id");
    if (!procedimento_id) throw new BadRequestError("Informe procedimento_id");
    const de = url.searchParams.get("de");
    const ate = url.searchParams.get("ate");
    if (!de || !ate) throw new BadRequestError("Informe o período em de=<ISO>&ate=<ISO>");
    const deMs = Date.parse(de);
    const ateMs = Date.parse(ate);
    if (Number.isNaN(deMs) || Number.isNaN(ateMs)) throw new BadRequestError("de e ate devem ser instantes ISO 8601");

    const { proc, recursos } = contextoDoAgendamento(sqlite, org, procedimento_id);
    const cfg = carregarOrg(sqlite, org);

    let profissional_id = url.searchParams.get("profissional_id");
    if (apenasPropriaAgenda(session.role)) {
      const proprio = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (!proprio) return json({ horarios: [], aviso: "Usuário sem profissional vinculado" });
      profissional_id = proprio;
    }
    if (!profissional_id) {
      // Sem profissional explícito, usa o primeiro habilitado do catálogo.
      const habilitado = sqlite
        .query(
          `SELECT profissional_id FROM procedimento_profissionais
           WHERE organizacao_id = ? AND procedimento_id = ? LIMIT 1`,
        )
        .get(org, procedimento_id) as { profissional_id: string } | null;
      if (!habilitado) {
        throw new BadRequestError("Nenhum profissional habilitado para este procedimento");
      }
      profissional_id = habilitado.profissional_id;
    }
    validarProfissionalParaProcedimento(sqlite, org, profissional_id, procedimento_id);

    const sala_id = url.searchParams.get("sala_id") ?? recursos[0]?.sala_id ?? null;
    const horarios = horariosLivres(sqlite, cfg.horario_funcionamento, cfg.timezone, {
      organizacao_id: org,
      profissional_id,
      sala_id,
      procedimento_id,
      duracao_min: proc.duracao_min,
      tempo_preparo_min: recursos[0]?.tempo_preparo_min ?? 0,
      tempo_limpeza_min: recursos[0]?.tempo_limpeza_min ?? 0,
      de: deMs,
      ate: ateMs,
      passo_min: opcionalNumeroQuery(url.searchParams.get("passo_min"), 30),
    });

    return json({
      procedimento: proc,
      profissional_id,
      sala_id,
      horarios,
      // O fuso importa: o cliente vê "09:00", mas o instante é UTC.
      timezone: cfg.timezone,
    });
  },
};

function opcionalNumeroQuery(valor: string | null, padrao: number): number {
  if (!valor) return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestError("passo_min deve ser um número positivo");
  return n;
}

const obterAgendamento: Rota = {
  metodo: "GET",
  caminho: "/agenda/:id",
  permissao: "agenda:read",
  handler({ sqlite, session, params }) {
    const org = session.organizacao_id;
    const row = sqlite
      .query(`SELECT * FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as AgendamentoRow | null;
    if (!row) throw new NotFoundError("Agendamento não encontrado nesta organização");

    if (apenasPropriaAgenda(session.role)) {
      const prof = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (row.profissional_id !== prof) {
        // Não revela que existe: para este usuário, não existe.
        throw new NotFoundError("Agendamento não encontrado nesta organização");
      }
    }
    return json({ agendamento: hidratar(sqlite, org, [row])[0] });
  },
};

/**
 * Cria agendamento. As três regras anti-conflito são aplicadas por
 * `validarAgendamento` — e o profissional é SEMPRE resolvido como o dono da
 * agenda. Recepção/gerente/proprietário agendam para qualquer um; profissional
 * só agenda para si, mesmo que peça outro no corpo.
 */
const criarAgendamento: Rota = {
  metodo: "POST",
  caminho: "/agenda",
  permissao: "agenda:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;

    const cliente_id = exigirTexto(body, "cliente_id");
    const procedimento_id = exigirTexto(body, "procedimento_id");
    const inicio = exigirInstante(body, "inicio");

    const cliente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND id = ?`)
      .get(org, cliente_id);
    if (!cliente) throw new BadRequestError("Cliente não encontrado nesta organização");

    let profissional_id = opcionalTexto(body, "profissional_id");
    if (apenasPropriaAgenda(session.role)) {
      const proprio = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (!proprio) throw new BadRequestError("Usuário sem profissional vinculado");
      profissional_id = proprio;
    } else if (!profissional_id) {
      const habilitado = sqlite
        .query(
          `SELECT profissional_id FROM procedimento_profissionais
           WHERE organizacao_id = ? AND procedimento_id = ? LIMIT 1`,
        )
        .get(org, procedimento_id) as { profissional_id: string } | null;
      if (!habilitado) throw new BadRequestError("Nenhum profissional habilitado para este procedimento");
      profissional_id = habilitado.profissional_id;
    }
    validarProfissionalParaProcedimento(sqlite, org, profissional_id, procedimento_id);

    const { proc, recursos } = contextoDoAgendamento(sqlite, org, procedimento_id);
    const salaInformada = opcionalTexto(body, "sala_id");
    const sala_id = salaInformada ?? recursos[0]?.sala_id ?? null;
    if (sala_id && !recursos.some((r) => r.sala_id === sala_id)) {
      throw new BadRequestError("Este procedimento não consome a sala/recurso informado");
    }
    const recurso = recursos.find((r) => r.sala_id === sala_id);
    const preparo = recurso?.tempo_preparo_min ?? 0;
    const limpeza = recurso?.tempo_limpeza_min ?? 0;

    const cfg = carregarOrg(sqlite, org);
    const janela = validarAgendamento(sqlite, cfg.horario_funcionamento, cfg.timezone, {
      organizacao_id: org,
      profissional_id,
      sala_id,
      procedimento_id,
      inicio,
      duracao_min: proc.duracao_min,
      tempo_preparo_min: preparo,
      tempo_limpeza_min: limpeza,
    });

    const id = uuid();
    sqlite
      .query(
        `INSERT INTO agendamentos
           (id, organizacao_id, cliente_id, profissional_id, sala_id, procedimento_id,
            inicio, fim, inicio_bloqueio, fim_bloqueio, status, origem, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agendado', ?, ?)`,
      )
      .run(
        id,
        org,
        cliente_id,
        profissional_id,
        sala_id,
        procedimento_id,
        inicio,
        inicio + proc.duracao_min * min,
        janela.inicio,
        janela.fim,
        opcionalTexto(body, "origem") ?? "recepcao",
        opcionalTexto(body, "observacoes") ?? null,
      );

    const row = sqlite
      .query(`SELECT * FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, id) as AgendamentoRow;
    return json({ agendamento: hidratar(sqlite, org, [row])[0] }, 201);
  },
};

/**
 * Remarcar NÃO altera o agendamento original: cria um novo apontando para ele
 * e marca o antigo como `remarcado`. Isso preserva o histórico — quem remarcou
 * demais continua visível nos relatórios.
 */
const remarcarAgendamento: Rota = {
  metodo: "POST",
  caminho: "/agenda/:id/remarcar",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const novoInicio = exigirInstante(body, "inicio");

    const original = sqlite
      .query(`SELECT * FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as AgendamentoRow | null;
    if (!original) throw new NotFoundError("Agendamento não encontrado nesta organização");
    if (!OCUPAM.includes(original.status)) {
      throw new BadRequestError(`Não é possível remarcar um agendamento com status "${original.status}"`);
    }
    if (apenasPropriaAgenda(session.role)) {
      const prof = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (original.profissional_id !== prof) {
        throw new NotFoundError("Agendamento não encontrado nesta organização");
      }
    }

    // Preparo/limpeza do recurso do agendamento ORIGINAL — remarcar não troca sala.
    const recurso = original.sala_id
      ? (sqlite
          .query(
            `SELECT tempo_preparo_min, tempo_limpeza_min FROM procedimento_recursos
             WHERE organizacao_id = ? AND procedimento_id = ? AND sala_id = ? LIMIT 1`,
          )
          .get(org, original.procedimento_id, original.sala_id) as
          | { tempo_preparo_min: number; tempo_limpeza_min: number }
          | null)
      : null;

    const proc = sqlite
      .query(`SELECT duracao_min FROM procedimentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, original.procedimento_id) as { duracao_min: number } | null;
    if (!proc) throw new BadRequestError("Procedimento do agendamento não existe mais nesta organização");

    const cfg = carregarOrg(sqlite, org);
    const janela = validarAgendamento(sqlite, cfg.horario_funcionamento, cfg.timezone, {
      organizacao_id: org,
      profissional_id: original.profissional_id,
      sala_id: original.sala_id,
      procedimento_id: original.procedimento_id,
      inicio: novoInicio,
      duracao_min: proc.duracao_min,
      tempo_preparo_min: recurso?.tempo_preparo_min ?? 0,
      tempo_limpeza_min: recurso?.tempo_limpeza_min ?? 0,
      // O próprio original seria um conflito consigo mesmo se não fosse ignorado.
      ignorarAgendamentoId: original.id,
    });

    const novoId = uuid();
    sqlite.transaction(() => {
      sqlite
        .query(
          `INSERT INTO agendamentos
             (id, organizacao_id, cliente_id, profissional_id, sala_id, procedimento_id,
              inicio, fim, inicio_bloqueio, fim_bloqueio, status, origem, observacoes, remarcado_de_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agendado', ?, ?, ?)`,
        )
        .run(
          novoId,
          org,
          original.cliente_id,
          original.profissional_id,
          original.sala_id,
          original.procedimento_id,
          novoInicio,
          novoInicio + proc.duracao_min * min,
          janela.inicio,
          janela.fim,
          original.origem,
          opcionalTexto(body, "observacoes") ?? original.observacoes,
          original.id,
        );
      sqlite
        .query(`UPDATE agendamentos SET status = 'remarcado' WHERE organizacao_id = ? AND id = ?`)
        .run(org, original.id);
    })();

    const row = sqlite
      .query(`SELECT * FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, novoId) as AgendamentoRow;
    return json({ agendamento: hidratar(sqlite, org, [row])[0], remarcado_de: original.id }, 201);
  },
};

/**
 * Muda o status do agendamento. `cancelado_pelo_cliente` e `cancelado_pela_clinica`
 * são distinguidos porque só o primeiro conta como insatisfação do cliente nos
 * relatórios. `remarcado` só nasce via /remarcar.
 */
const alterarStatusAgendamento: Rota = {
  metodo: "PATCH",
  caminho: "/agenda/:id/status",
  permissao: "agenda:write",
  async handler({ req, sqlite, session, params }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const status = exigirTexto(body, "status");
    const permitidos = [
      "agendado",
      "confirmado",
      "cancelado_pelo_cliente",
      "cancelado_pela_clinica",
    ];
    if (!permitidos.includes(status)) {
      throw new BadRequestError(
        `Status inválido. Use um de: ${permitidos.join(", ")}. "remarcado" só é atribuído por /remarcar.`,
      );
    }

    const atual = sqlite
      .query(`SELECT * FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
      .get(org, params.id) as AgendamentoRow | null;
    if (!atual) throw new NotFoundError("Agendamento não encontrado nesta organização");
    if (atual.status === "remarcado") {
      throw new BadRequestError("Agendamento já remarcado não muda de status: altere o agendamento novo");
    }
    if (apenasPropriaAgenda(session.role)) {
      const prof = profissionalDoUsuario(sqlite, org, session.usuario_id);
      if (atual.profissional_id !== prof) {
        throw new NotFoundError("Agendamento não encontrado nesta organização");
      }
    }

    sqlite
      .query(`UPDATE agendamentos SET status = ? WHERE organizacao_id = ? AND id = ?`)
      .run(status, org, params.id);
    return json({ id: params.id, status });
  },
};

/**
 * Bloqueio de agenda (férias, manutenção) do profissional ou da sala.
 * Fica em JSON na própria entidade — não é tabela nova porque a regra 3 já
 * o lê de lá, e duplicar criaria duas verdades.
 */
const criarBloqueio: Rota = {
  metodo: "POST",
  caminho: "/agenda/bloqueios",
  permissao: "agenda:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const alvo = exigirTexto(body, "alvo");
    if (alvo !== "profissional" && alvo !== "sala") {
      throw new BadRequestError('alvo deve ser "profissional" ou "sala"');
    }
    const alvo_id = exigirTexto(body, "alvo_id");
    const inicio = exigirInstante(body, "inicio");
    const fim = exigirInstante(body, "fim");
    if (fim <= inicio) throw new BadRequestError("fim deve ser posterior a inicio");
    const motivo = opcionalTexto(body, "motivo") ?? (alvo === "sala" ? "manutenção" : "indisponibilidade");

    const tabela = alvo === "profissional" ? "profissionais" : "salas";
    const entidade = sqlite
      .query(`SELECT id, bloqueios_agenda FROM ${tabela} WHERE organizacao_id = ? AND id = ?`)
      .get(org, alvo_id) as { id: string; bloqueios_agenda: string | null } | null;
    if (!entidade) throw new BadRequestError(`${alvo} não encontrado nesta organização`);

    let lista: { inicio: number; fim: number; motivo: string }[] = [];
    if (entidade.bloqueios_agenda) {
      try {
        const parsed = JSON.parse(entidade.bloqueios_agenda);
        if (Array.isArray(parsed)) lista = parsed;
      } catch {
        // JSON corrompido não deve derrubar a criação de um bloqueio novo.
        lista = [];
      }
    }
    lista.push({ inicio, fim, motivo });

    sqlite
      .query(`UPDATE ${tabela} SET bloqueios_agenda = ? WHERE organizacao_id = ? AND id = ?`)
      .run(JSON.stringify(lista), org, alvo_id);

    return json({ alvo, alvo_id, bloqueios: lista }, 201);
  },
};

export const rotasAgenda: Rota[] = [
  listarAgenda,
  horariosDisponiveis,
  criarBloqueio,
  obterAgendamento,
  criarAgendamento,
  remarcarAgendamento,
  alterarStatusAgendamento,
];
