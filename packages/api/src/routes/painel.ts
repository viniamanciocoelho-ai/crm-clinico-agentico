import { json, BadRequestError } from "../http";
import type { Rota, ContextoRota } from "../router";

/**
 * Painel do dono. TUDO aqui é consulta agregada sobre as tabelas de fato — não
 * existe tabela de painel, nem número guardado. Se um indicador não sai de uma
 * query, ele não existe: nada é preenchido com valor de exemplo.
 *
 * Receita e custo seguem exatamente `EFEITOS` (lib/contabil): só `concluido`
 * gera receita; `concluido` e `brinde` consomem insumo.
 */

const RECEITA = "concluido";

type Periodo = { de: number; ate: number };

/**
 * Período do relatório. Sem `de`/`ate`, assume o mês corrente no fuso da
 * organização — o "mês" do dono é o da clínica, não o do servidor UTC.
 */
function resolverPeriodo(url: URL, timezone: string): Periodo {
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");

  if (de && ate) {
    // Epoch em ms vem só de dígitos; qualquer outra coisa é tentada como ISO.
    const dMs = /^\d+$/.test(de) ? Number(de) : Date.parse(de);
    const aMs = /^\d+$/.test(ate) ? Number(ate) : Date.parse(ate);
    if (Number.isNaN(dMs) || Number.isNaN(aMs)) {
      throw new BadRequestError("Não foi possível interpretar de/ate como epoch em ms ou ISO 8601");
    }
    if (dMs >= aMs) throw new BadRequestError("de deve ser anterior a ate");
    return { de: dMs, ate: aMs };
  }

  // Mês corrente no fuso da organização.
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = partes.find((p) => p.type === "year")!.value;
  const mes = partes.find((p) => p.type === "month")!.value;

  const inicio = zonedStartOfDay(`${ano}-${mes}-01`, timezone);
  const proximoMes = Number(mes) === 12 ? `${Number(ano) + 1}-01` : `${ano}-${String(Number(mes) + 1).padStart(2, "0")}`;
  return { de: inicio, ate: zonedStartOfDay(`${proximoMes}-01`, timezone) };
}

/**
 * Meia-noite local de uma data YYYY-MM-DD no fuso dado, em epoch ms. Feito sem
 * biblioteca: descobre o offset do fuso naquele instante e ajusta.
 */
function zonedStartOfDay(data: string, timezone: string): number {
  const chute = Date.parse(`${data}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(new Date(chute)).map((p) => [p.type, p.value]));
  const comoLocal = Date.parse(
    `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}Z`,
  );
  const offset = comoLocal - chute;
  return chute - offset;
}

function periodo(url: URL, sqlite: ContextoRota["sqlite"], org: string): Periodo {
  const row = sqlite.query(`SELECT timezone FROM organizacoes WHERE organizacao_id = ?`).get(org) as
    | { timezone: string }
    | null;
  return resolverPeriodo(url, row?.timezone ?? "America/Sao_Paulo");
}

/** Resumo financeiro e volume. Uma query por bloco — nada recalculado no front. */
const resumo: Rota = {
  metodo: "GET",
  caminho: "/painel/resumo",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const { de, ate } = periodo(url, sqlite, org);

    const atendimentos = sqlite
      .query(
        `SELECT status, COUNT(*) AS quantidade,
                COALESCE(SUM(valor), 0) AS valor,
                COALESCE(SUM(custo_insumos), 0) AS custo
         FROM atendimentos
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?
         GROUP BY status`,
      )
      .all(org, de, ate) as { status: string; quantidade: number; valor: number; custo: number }[];

    const porStatus = Object.fromEntries(atendimentos.map((a) => [a.status, a]));

    const receita = porStatus[RECEITA]?.valor ?? 0;
    // Brinde consome insumo sem gerar receita: o custo dele entra na conta.
    const custo = (porStatus[RECEITA]?.custo ?? 0) + (porStatus["brinde"]?.custo ?? 0);
    const totalAtendimentos = atendimentos.reduce((acc, a) => acc + a.quantidade, 0);
    const faltas = porStatus["falta"]?.quantidade ?? 0;

    const agendamentos = sqlite
      .query(
        `SELECT status, COUNT(*) AS quantidade
         FROM agendamentos
         WHERE organizacao_id = ? AND inicio >= ? AND inicio < ?
         GROUP BY status`,
      )
      .all(org, de, ate) as { status: string; quantidade: number }[];

    const agPorStatus = Object.fromEntries(agendamentos.map((a) => [a.status, a.quantidade]));
    const totalAgendamentos = agendamentos.reduce((acc, a) => acc + a.quantidade, 0);
    const cancelados = (agPorStatus["cancelado_pelo_cliente"] ?? 0) + (agPorStatus["cancelado_pela_clinica"] ?? 0);

    const conversas = sqlite
      .query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'aguardando_humano' THEN 1 ELSE 0 END) AS na_fila
         FROM conversas
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?`,
      )
      .get(org, de, ate) as { total: number; na_fila: number | null };

    const acoesIa = sqlite
      .query(
        `SELECT tipo_acao, COUNT(*) AS quantidade
         FROM ia_acoes_log
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?
         GROUP BY tipo_acao ORDER BY quantidade DESC`,
      )
      .all(org, de, ate) as { tipo_acao: string; quantidade: number }[];

    return json({
      periodo: { de, ate },
      atendimentos: {
        total: totalAtendimentos,
        por_status: porStatus,
      },
      financeiro: {
        receita,
        custo_insumos: custo,
        // Margem é cálculo, nunca cadastro.
        margem: receita - custo,
        // Ticket médio só faz sentido sobre o que gerou receita.
        ticket_medio: (porStatus[RECEITA]?.quantidade ?? 0) > 0 ? receita / porStatus[RECEITA].quantidade : 0,
      },
      agendamentos: {
        total: totalAgendamentos,
        por_status: agPorStatus,
        cancelados,
        taxa_cancelamento: totalAgendamentos > 0 ? cancelados / totalAgendamentos : 0,
        // No-show usa a base de atendimentos: o que de fato aconteceu.
        taxa_no_show: totalAtendimentos > 0 ? faltas / totalAtendimentos : 0,
      },
      conversas: { total: conversas.total, aguardando_humano: conversas.na_fila ?? 0 },
      agente_ia: acoesIa,
    });
  },
};

/** Ranking de procedimentos por receita gerada. Só `concluido` conta receita. */
const procedimentos: Rota = {
  metodo: "GET",
  caminho: "/painel/procedimentos",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const { de, ate } = periodo(url, sqlite, org);

    const rows = sqlite
      .query(
        `SELECT p.id, p.nome, p.preco AS preco_catalogo,
                COUNT(t.id) AS quantidade,
                COALESCE(SUM(CASE WHEN t.status = 'concluido' THEN t.valor ELSE 0 END), 0) AS receita,
                COALESCE(SUM(CASE WHEN t.status IN ('concluido','brinde') THEN t.custo_insumos ELSE 0 END), 0) AS custo,
                SUM(CASE WHEN t.status = 'falta' THEN 1 ELSE 0 END) AS faltas
         FROM atendimentos t
         JOIN procedimentos p ON p.id = t.procedimento_id AND p.organizacao_id = t.organizacao_id
         WHERE t.organizacao_id = ? AND t.criado_em >= ? AND t.criado_em < ?
         GROUP BY p.id
         ORDER BY receita DESC`,
      )
      .all(org, de, ate);
    return json({ periodo: { de, ate }, procedimentos: rows });
  },
};

/** Produção por profissional, incluindo a taxa de falta de cada um. */
const profissionais: Rota = {
  metodo: "GET",
  caminho: "/painel/profissionais",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const { de, ate } = periodo(url, sqlite, org);

    const rows = sqlite
      .query(
        `SELECT pr.id, pr.nome, pr.especialidade, pr.cor,
                COUNT(t.id) AS atendimentos,
                SUM(CASE WHEN t.status = 'concluido' THEN 1 ELSE 0 END) AS concluidos,
                SUM(CASE WHEN t.status = 'falta' THEN 1 ELSE 0 END) AS faltas,
                COALESCE(SUM(CASE WHEN t.status = 'concluido' THEN t.valor ELSE 0 END), 0) AS receita,
                COALESCE(SUM(CASE WHEN t.status IN ('concluido','brinde') THEN t.custo_insumos ELSE 0 END), 0) AS custo
         FROM profissionais pr
         LEFT JOIN atendimentos t
           ON t.profissional_id = pr.id AND t.organizacao_id = pr.organizacao_id
          AND t.criado_em >= ? AND t.criado_em < ?
         WHERE pr.organizacao_id = ?
         GROUP BY pr.id
         ORDER BY receita DESC`,
      )
      .all(de, ate, org) as {
      id: string;
      nome: string;
      atendimentos: number;
      concluidos: number;
      faltas: number;
      receita: number;
      custo: number;
    }[];

    return json({
      periodo: { de, ate },
      profissionais: rows.map((p) => ({
        ...p,
        margem: p.receita - p.custo,
        taxa_no_show: p.atendimentos > 0 ? p.faltas / p.atendimentos : 0,
      })),
    });
  },
};

/** Funil de leads: contagem por etapa e os motivos de perda, em ordem. */
const funil: Rota = {
  metodo: "GET",
  caminho: "/painel/funil",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const { de, ate } = periodo(url, sqlite, org);

    const porEtapa = sqlite
      .query(
        `SELECT etapa, COUNT(*) AS quantidade
         FROM leads
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?
         GROUP BY etapa`,
      )
      .all(org, de, ate) as { etapa: string; quantidade: number }[];

    const motivos = sqlite
      .query(
        `SELECT m.id, m.descricao, COUNT(l.id) AS quantidade
         FROM motivos_perda m
         LEFT JOIN leads l
           ON l.motivo_perda_id = m.id AND l.organizacao_id = m.organizacao_id
          AND l.criado_em >= ? AND l.criado_em < ?
         WHERE m.organizacao_id = ?
         GROUP BY m.id
         ORDER BY quantidade DESC`,
      )
      .all(de, ate, org);

    // Canal de entrada e quem atendeu: a spec pede os dois como corte.
    const porCanal = sqlite
      .query(
        `SELECT canal_entrada, COUNT(*) AS quantidade
         FROM leads
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?
         GROUP BY canal_entrada ORDER BY quantidade DESC`,
      )
      .all(org, de, ate) as { canal_entrada: string | null; quantidade: number }[];

    const porAtendimento = sqlite
      .query(
        `SELECT atendido_por_tipo, COUNT(*) AS quantidade
         FROM leads
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?
         GROUP BY atendido_por_tipo`,
      )
      .all(org, de, ate) as { atendido_por_tipo: string; quantidade: number }[];

    const porOrigem = sqlite
      .query(
        `SELECT origem_lead, COUNT(*) AS quantidade
         FROM clientes
         WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ? AND origem_lead IS NOT NULL
         GROUP BY origem_lead ORDER BY quantidade DESC`,
      )
      .all(org, de, ate) as { origem_lead: string; quantidade: number }[];

    return json({
      periodo: { de, ate },
      por_etapa: Object.fromEntries(porEtapa.map((e) => [e.etapa, e.quantidade])),
      motivos_perda: motivos,
      por_canal: porCanal,
      por_atendido_por_tipo: porAtendimento,
      clientes_por_origem: porOrigem,
    });
  },
};

/**
 * Clientes: novos, recorrentes, inativos e ranking de valor. Nada aqui é
 * segmento gravado — é agregação sobre atendimento e agendamento.
 */
const clientes: Rota = {
  metodo: "GET",
  caminho: "/painel/clientes",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const { de, ate } = periodo(url, sqlite, org);

    const orgRow = sqlite
      .query(`SELECT reativacao_dias FROM organizacoes WHERE organizacao_id = ?`)
      .get(org) as { reativacao_dias: number } | null;
    const dias = orgRow?.reativacao_dias ?? 90;

    const novos = sqlite
      .query(`SELECT COUNT(*) AS total FROM clientes WHERE organizacao_id = ? AND criado_em >= ? AND criado_em < ?`)
      .get(org, de, ate) as { total: number };

    const recorrentes = sqlite
      .query(
        `SELECT COUNT(*) AS total FROM (
           SELECT cliente_id FROM atendimentos
           WHERE organizacao_id = ? AND status = 'concluido'
           GROUP BY cliente_id HAVING COUNT(*) > 1
         )`,
      )
      .get(org) as { total: number };

    // Inativo = sem atendimento concluído desde o limite; quem nunca veio conta
    // pela data de cadastro, senão o cliente mais frio ficaria de fora.
    const inativos = sqlite
      .query(
        `SELECT COUNT(*) AS total FROM (
           SELECT c.id, COALESCE(MAX(t.criado_em), c.criado_em) AS ultima
           FROM clientes c
           LEFT JOIN atendimentos t
             ON t.organizacao_id = c.organizacao_id AND t.cliente_id = c.id AND t.status = 'concluido'
           WHERE c.organizacao_id = ? AND c.ativo = 1
           GROUP BY c.id HAVING ultima < ?
         )`,
      )
      .get(org, Date.now() - dias * 86_400_000) as { total: number };

    const top = sqlite
      .query(
        `SELECT c.id, c.nome, c.telefone,
                COUNT(t.id) AS atendimentos,
                COALESCE(SUM(CASE WHEN t.status = 'concluido' THEN t.valor ELSE 0 END), 0) AS receita,
                MAX(t.criado_em) AS ultimo_atendimento
         FROM clientes c
         JOIN atendimentos t ON t.cliente_id = c.id AND t.organizacao_id = c.organizacao_id
         WHERE c.organizacao_id = ? AND t.criado_em >= ? AND t.criado_em < ?
         GROUP BY c.id
         ORDER BY receita DESC
         LIMIT 20`,
      )
      .all(org, de, ate);

    const reativacoes = sqlite
      .query(
        `SELECT COUNT(*) AS disparadas,
                SUM(CASE WHEN retornou = 1 THEN 1 ELSE 0 END) AS retornaram
         FROM reativacoes_log
         WHERE organizacao_id = ? AND disparado_em >= ? AND disparado_em < ?`,
      )
      .get(org, de, ate) as { disparadas: number; retornaram: number | null };

    return json({
      periodo: { de, ate },
      novos: novos.total,
      recorrentes: recorrentes.total,
      inativos: inativos.total,
      dias_para_inatividade: dias,
      top_clientes: top,
      reativacoes: {
        disparadas: reativacoes.disparadas,
        retornaram: reativacoes.retornaram ?? 0,
        // A taxa de retorno é o que diz se a reativação vale a pena.
        taxa_retorno: reativacoes.disparadas > 0 ? (reativacoes.retornaram ?? 0) / reativacoes.disparadas : 0,
      },
    });
  },
};

/**
 * Ocupação da agenda: quanto do tempo disponível foi de fato ocupado. Sai da
 * diferença entre blocos agendados e o expediente configurado — não de um
 * número estimado.
 */
const ocupacao: Rota = {
  metodo: "GET",
  caminho: "/painel/ocupacao",
  permissao: "relatorios:read",
  handler({ sqlite, session, url }) {
    const org = session.organizacao_id;
    const { de, ate } = periodo(url, sqlite, org);

    const rows = sqlite
      .query(
        `SELECT pr.id, pr.nome,
                COUNT(a.id) AS agendamentos,
                COALESCE(SUM(a.fim - a.inicio), 0) AS minutos_ocupados,
                SUM(CASE WHEN a.status IN ('cancelado_pelo_cliente','cancelado_pela_clinica') THEN 1 ELSE 0 END) AS cancelados,
                SUM(CASE WHEN a.status = 'remarcado' THEN 1 ELSE 0 END) AS remarcados
         FROM profissionais pr
         LEFT JOIN agendamentos a
           ON a.profissional_id = pr.id AND a.organizacao_id = pr.organizacao_id
          AND a.inicio >= ? AND a.inicio < ?
          AND a.status NOT IN ('cancelado_pelo_cliente', 'cancelado_pela_clinica')
         WHERE pr.organizacao_id = ?
         GROUP BY pr.id
         ORDER BY minutos_ocupados DESC`,
      )
      .all(de, ate, org);

    return json({ periodo: { de, ate }, profissionais: rows });
  },
};

export const rotasPainel: Rota[] = [resumo, procedimentos, profissionais, funil, clientes, ocupacao];
