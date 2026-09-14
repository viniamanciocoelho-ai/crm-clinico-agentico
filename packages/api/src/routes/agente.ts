import { carregarOrg } from "../lib/org";
import {
  consultarProcedimentos,
  consultarPreco,
  consultarHorarios,
  criarAgendamento,
  remarcarAgendamento,
  cancelarAgendamento,
  cadastrarCliente,
  detectarEscalada,
  escalarHumano,
} from "../lib/agente";
import { registrarMensagem } from "./conversas";
import {
  json,
  lerCorpo,
  exigirTexto,
  opcionalTexto,
  exigirInstante,
  BadRequestError,
  NotFoundError,
} from "../http";
import type { Rota, ContextoRota } from "../router";

/**
 * Contexto do agente: organização + fuso. Deliberadamente NÃO carrega sessão
 * nem papel — a IA não é usuário e não tem linha em `usuarios`. Toda ação dela
 * é atribuída a `autor_tipo = 'ia'` no log.
 */
function contextoIa(sqlite: ContextoRota["sqlite"], organizacao_id: string) {
  const cfg = carregarOrg(sqlite, organizacao_id);
  return { organizacao_id, timezone: cfg.timezone };
}

/** Uma resposta da IA é uma mensagem da conversa — nunca um estado paralelo. */
function responderNaConversa(
  sqlite: ContextoRota["sqlite"],
  org: string,
  conversa_id: string | null,
  conteudo: string,
) {
  if (!conversa_id) return;
  registrarMensagem(sqlite, org, conversa_id, "ia", conteudo);
}

function exigirConversa(sqlite: ContextoRota["sqlite"], org: string, conversa_id: string) {
  const conversa = sqlite
    .query(`SELECT id, status, telefone, cliente_id FROM conversas WHERE organizacao_id = ? AND id = ?`)
    .get(org, conversa_id) as
    | { id: string; status: string; telefone: string; cliente_id: string | null }
    | null;
  if (!conversa) throw new NotFoundError("Conversa não encontrada nesta organização");
  return conversa;
}

/**
 * Executa uma ação do agente e grava a resposta no fio da conversa. Toda ação
 * passa por aqui para que nenhuma resposta da IA deixe de virar mensagem — o
 * histórico não pode ter buraco.
 */
function executarAcao<T extends { resposta: string }>(
  sqlite: ContextoRota["sqlite"],
  org: string,
  conversa_id: string | null,
  acao: () => T,
): T {
  const resultado = acao();
  responderNaConversa(sqlite, org, conversa_id, resultado.resposta);
  return resultado;
}

/** Catálogo que o agente PODE afirmar. É a fronteira contra invenção. */
const catalogoDoAgente: Rota = {
  metodo: "GET",
  caminho: "/agente/catalogo",
  permissao: "agente_ia:config",
  handler({ sqlite, session }) {
    const org = session.organizacao_id;
    return json({
      procedimentos: sqlite
        .query(
          `SELECT p.id, p.nome, p.duracao_min, p.preco,
                  (SELECT COUNT(*) FROM procedimento_profissionais pp
                    WHERE pp.organizacao_id = p.organizacao_id AND pp.procedimento_id = p.id) AS profissionais_habilitados
           FROM procedimentos p
           WHERE p.organizacao_id = ? AND p.ativo = 1
           ORDER BY p.nome`,
        )
        .all(org),
    });
  },
};

const acaoConsultarProcedimentos: Rota = {
  metodo: "POST",
  caminho: "/agente/consultar-procedimentos",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    if (conversa_id) exigirConversa(sqlite, org, conversa_id);

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        consultarProcedimentos(sqlite, contextoIa(sqlite, org), conversa_id),
      ),
    );
  },
};

/** Preço e duração. Recusa terminantemente o que não está no catálogo. */
const acaoConsultarPreco: Rota = {
  metodo: "POST",
  caminho: "/agente/consultar-preco",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const termo = exigirTexto(body, "termo");
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    if (conversa_id) exigirConversa(sqlite, org, conversa_id);

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        consultarPreco(sqlite, contextoIa(sqlite, org), conversa_id, termo),
      ),
    );
  },
};

/** Horários livres — o agente só enxerga o que `horariosLivres` devolve. */
const acaoConsultarHorarios: Rota = {
  metodo: "POST",
  caminho: "/agente/consultar-horarios",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    if (conversa_id) exigirConversa(sqlite, org, conversa_id);

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        consultarHorarios(
          sqlite,
          contextoIa(sqlite, org),
          conversa_id,
          exigirTexto(body, "termo_procedimento"),
          opcionalTexto(body, "profissional_id"),
        ),
      ),
    );
  },
};

/**
 * Cria o agendamento pela IA. O telefone identifica o cliente; se ainda não
 * houver, `criarAgendamento` cadastra com consentimento LGPD do canal WhatsApp
 * — foi a própria pessoa que iniciou a conversa pedindo o agendamento.
 */
const acaoCriarAgendamento: Rota = {
  metodo: "POST",
  caminho: "/agente/agendar",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    const conversa = conversa_id ? exigirConversa(sqlite, org, conversa_id) : null;

    const telefone = opcionalTexto(body, "telefone") ?? conversa?.telefone;
    if (!telefone) throw new BadRequestError("Informe telefone (ou passe uma conversa_id com telefone)");

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        criarAgendamento(sqlite, contextoIa(sqlite, org), conversa_id, {
          telefone,
          nome_cliente: opcionalTexto(body, "nome_cliente"),
          termo_procedimento: exigirTexto(body, "termo_procedimento"),
          inicio: exigirInstante(body, "inicio"),
          profissional_id: opcionalTexto(body, "profissional_id"),
        }),
      ),
    );
  },
};

/**
 * Remarcar e cancelar aceitam `agendamento_id` ou telefone. A busca por
 * telefone vive aqui e só aceita um único agendamento em aberto: com dois, a
 * IA não escolhe por conta própria — pergunta qual.
 */
const acaoRemarcarAgendamento: Rota = {
  metodo: "POST",
  caminho: "/agente/remarcar",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    const conversa = conversa_id ? exigirConversa(sqlite, org, conversa_id) : null;

    const agendamento_id = resolverAgendamento(sqlite, org, body, conversa);
    const novo_inicio = exigirInstante(body, "novo_inicio");

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        remarcarAgendamento(sqlite, contextoIa(sqlite, org), conversa_id, {
          agendamento_id,
          novo_inicio,
        }),
      ),
    );
  },
};

const acaoCancelarAgendamento: Rota = {
  metodo: "POST",
  caminho: "/agente/cancelar",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    const conversa = conversa_id ? exigirConversa(sqlite, org, conversa_id) : null;

    const agendamento_id = resolverAgendamento(sqlite, org, body, conversa);
    // Quem cancelou é dado distinto nos relatórios: cancelar a pedido do
    // cliente não é a clínica cancelando. O padrão é "cliente" — foi ele
    // quem escreveu; a IA nunca adivinha a clínica.
    const por = body.por === "clinica" ? ("clinica" as const) : ("cliente" as const);

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        cancelarAgendamento(sqlite, contextoIa(sqlite, org), conversa_id, {
          agendamento_id,
          por,
        }),
      ),
    );
  },
};

const acaoCadastrarCliente: Rota = {
  metodo: "POST",
  caminho: "/agente/cadastrar-cliente",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = opcionalTexto(body, "conversa_id") ?? null;
    const conversa = conversa_id ? exigirConversa(sqlite, org, conversa_id) : null;

    const telefone = opcionalTexto(body, "telefone") ?? conversa?.telefone;
    if (!telefone) throw new BadRequestError("Informe telefone (ou passe uma conversa_id com telefone)");

    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        cadastrarCliente(sqlite, contextoIa(sqlite, org), conversa_id, {
          telefone,
          nome: exigirTexto(body, "nome"),
          email: opcionalTexto(body, "email"),
          data_nascimento: opcionalTexto(body, "data_nascimento"),
          origem_lead: opcionalTexto(body, "origem_lead") ?? "whatsapp",
          observacoes: opcionalTexto(body, "observacoes"),
        }),
      ),
    );
  },
};

/**
 * Escalada manual pela equipe. A automática acontece ao receber a mensagem do
 * cliente (ver `routes/conversas.ts`); esta serve para quando o atendente vê
 * algo que o detector de texto não pegaria.
 */
const acaoEscalar: Rota = {
  metodo: "POST",
  caminho: "/agente/escalar",
  permissao: "conversas:write",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;
    const conversa_id = exigirTexto(body, "conversa_id");
    exigirConversa(sqlite, org, conversa_id);

    const motivo = exigirTexto(body, "motivo");
    return json(
      executarAcao(sqlite, org, conversa_id, () =>
        escalarHumano(sqlite, contextoIa(sqlite, org), conversa_id, motivo),
      ),
    );
  },
};

/**
 * Classifica um texto sem gravar nada: diz se escala e por quê. Serve para a
 * equipe calibrar o detector antes de confiar nele em produção.
 */
const classificarEscalada: Rota = {
  metodo: "POST",
  caminho: "/agente/detectar-escalada",
  permissao: "conversas:read",
  async handler({ req }) {
    const body = await lerCorpo(req);
    const motivo = detectarEscalada(exigirTexto(body, "texto"));
    return json({ escalar: motivo !== null, motivo });
  },
};

const lerConfigAgente: Rota = {
  metodo: "GET",
  caminho: "/agente/config",
  permissao: "agente_ia:config",
  handler({ sqlite, session }) {
    const cfg = carregarOrg(sqlite, session.organizacao_id);
    return json({
      organizacao_id: cfg.organizacao_id,
      nome: cfg.nome,
      timezone: cfg.timezone,
      reativacao_dias: cfg.reativacao_dias,
      config_agente_ia: cfg.config_agente_ia,
      horario_funcionamento: cfg.horario_funcionamento,
    });
  },
};

const salvarConfigAgente: Rota = {
  metodo: "PUT",
  caminho: "/agente/config",
  permissao: "agente_ia:config",
  async handler({ req, sqlite, session }) {
    const body = await lerCorpo(req);
    const org = session.organizacao_id;

    const campos: string[] = [];
    const valores: unknown[] = [];

    if (body.config_agente_ia !== undefined) {
      const config = body.config_agente_ia;
      if (config !== null && (typeof config !== "object" || Array.isArray(config))) {
        throw new BadRequestError("config_agente_ia deve ser um objeto JSON ou null");
      }
      campos.push("config_agente_ia = ?");
      valores.push(config === null ? null : JSON.stringify(config));
    }

    if (body.horario_funcionamento !== undefined) {
      const horario = body.horario_funcionamento;
      // `null` é válido e significa "sem restrição de expediente": a regra 3
      // deixa de se aplicar. Ausente é diferente de nulo.
      if (horario !== null) {
        if (typeof horario !== "object" || Array.isArray(horario)) {
          throw new BadRequestError(
            'horario_funcionamento deve ser um objeto { "1": [["08:00","18:00"]] } ou null',
          );
        }
        for (const [dia, faixas] of Object.entries(horario as Record<string, unknown>)) {
          const dow = Number(dia);
          if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
            throw new BadRequestError(
              `Dia inválido em horario_funcionamento: "${dia}" (use 0=domingo … 6=sábado)`,
            );
          }
          if (!Array.isArray(faixas)) {
            throw new BadRequestError(`As faixas do dia ${dia} devem ser uma lista de ["HH:MM","HH:MM"]`);
          }
          for (const faixa of faixas) {
            if (
              !Array.isArray(faixa) ||
              faixa.length !== 2 ||
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(faixa[0])) ||
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(faixa[1]))
            ) {
              throw new BadRequestError(`Faixa inválida no dia ${dia}: esperado ["HH:MM","HH:MM"]`);
            }
            if (String(faixa[0]) >= String(faixa[1])) {
              throw new BadRequestError(
                `Faixa inválida no dia ${dia}: início ${faixa[0]} não é antes de ${faixa[1]}`,
              );
            }
          }
        }
      }
      campos.push("horario_funcionamento = ?");
      valores.push(horario === null ? null : JSON.stringify(horario));
    }

    if (body.timezone !== undefined) {
      const timezone = exigirTexto(body, "timezone");
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        throw new BadRequestError(`Fuso horário inválido: "${timezone}"`);
      }
      campos.push("timezone = ?");
      valores.push(timezone);
    }

    if (body.reativacao_dias !== undefined) {
      const dias = body.reativacao_dias;
      if (typeof dias !== "number" || !Number.isInteger(dias) || dias <= 0) {
        throw new BadRequestError("reativacao_dias deve ser um inteiro positivo");
      }
      campos.push("reativacao_dias = ?");
      valores.push(dias);
    }

    if (campos.length === 0) throw new BadRequestError("Nenhum campo válido para atualizar");

    valores.push(org);
    sqlite
      .query(`UPDATE organizacoes SET ${campos.join(", ")} WHERE organizacao_id = ?`)
      .run(...(valores as never[]));

    const cfg = carregarOrg(sqlite, org);
    return json({
      config_agente_ia: cfg.config_agente_ia,
      horario_funcionamento: cfg.horario_funcionamento,
      timezone: cfg.timezone,
      reativacao_dias: cfg.reativacao_dias,
    });
  },
};

/**
 * Descobre sobre qual agendamento a IA está falando: pelo id informado, ou pelo
 * telefone (da conversa ou do corpo). Ambiguidade vira erro explícito — a IA
 * não pode escolher um em aberto no lugar do outro.
 */
function resolverAgendamento(
  sqlite: ContextoRota["sqlite"],
  org: string,
  body: Record<string, unknown>,
  conversa: { telefone: string; cliente_id: string | null } | null,
): string {
  const explicito = opcionalTexto(body, "agendamento_id");
  if (explicito) return explicito;

  const telefone = opcionalTexto(body, "telefone") ?? conversa?.telefone;
  if (!telefone) {
    throw new BadRequestError("Informe agendamento_id, ou telefone, ou uma conversa_id com telefone");
  }

  const abertos = sqlite
    .query(
      `SELECT a.id FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id AND c.organizacao_id = a.organizacao_id
       WHERE a.organizacao_id = ? AND c.telefone = ?
         AND a.status IN ('agendado', 'confirmado') AND a.inicio >= ?
       ORDER BY a.inicio`,
    )
    .all(org, telefone, Date.now()) as { id: string }[];

  if (abertos.length === 0) {
    throw new NotFoundError("Não há agendamento em aberto para este telefone nesta organização");
  }
  if (abertos.length > 1) {
    throw new BadRequestError(
      `Há ${abertos.length} agendamentos em aberto para este telefone — informe qual pelo campo agendamento_id`,
    );
  }
  return abertos[0].id;
}

export const rotasAgente: Rota[] = [
  catalogoDoAgente,
  lerConfigAgente,
  salvarConfigAgente,
  classificarEscalada,
  acaoConsultarProcedimentos,
  acaoConsultarPreco,
  acaoConsultarHorarios,
  acaoCriarAgendamento,
  acaoRemarcarAgendamento,
  acaoCancelarAgendamento,
  acaoCadastrarCliente,
  acaoEscalar,
];
