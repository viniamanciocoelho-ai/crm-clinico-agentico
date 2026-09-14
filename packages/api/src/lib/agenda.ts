import type { Database } from "bun:sqlite";

export class ConflitoError extends Error {
  constructor(
    message: string,
    public readonly regra: "profissional" | "recurso" | "expediente",
  ) {
    super(message);
    this.name = "ConflitoError";
  }
}

export interface Janela {
  inicio: number; // epoch ms
  fim: number;
}

type HorarioSemana = Record<string, [string, string][]>;

const STATUS_OCUPAM = ["agendado", "confirmado"];

const min = 60_000;

/** Expande "08:00" para minutos desde a meia-noite. */
function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Início do dia local (evita depender de UTC). */
export function inicioDoDia(ts: number, timezone = "America/Sao_Paulo"): number {
  const d = new Date(ts);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, dia] = fmt.format(d).split("-").map(Number);
  // offset real do fuso naquele instante
  const utcMeiaNoite = Date.UTC(y, m - 1, dia);
  const offset = offsetMinutos(ts, timezone);
  return utcMeiaNoite - offset * min;
}

function offsetMinutos(ts: number, timezone: string): number {
  const d = new Date(ts);
  const local = new Date(d.toLocaleString("en-US", { timeZone: timezone }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return (local.getTime() - utc.getTime()) / min;
}

/** Dia da semana 0=domingo … 6=sábado, no fuso da organização. */
export function diaDaSemana(ts: number, timezone = "America/Sao_Paulo"): number {
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(ts));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nome);
}

/** Blocos ocupados do profissional, já considerando preparo e limpeza. */
function ocupados(
  sqlite: Database,
  organizacao_id: string,
  campo: "profissional_id" | "sala_id",
  valor: string,
  janela: Janela,
  ignorarId?: string,
): Janela[] {
  const sql = `
    SELECT inicio_bloqueio AS inicio, fim_bloqueio AS fim
    FROM agendamentos
    WHERE organizacao_id = ?
      AND ${campo} = ?
      AND status IN (${STATUS_OCUPAM.map(() => "?").join(",")})
      AND inicio_bloqueio < ?
      AND fim_bloqueio > ?
      ${ignorarId ? "AND id != ?" : ""}
  `;
  const params = [organizacao_id, valor, ...STATUS_OCUPAM, janela.fim, janela.inicio];
  if (ignorarId) params.push(ignorarId);
  return sqlite.query(sql).all(...params) as Janela[];
}

function sobrepoe(a: Janela, b: Janela): boolean {
  return a.inicio < b.fim && a.fim > b.inicio;
}

export interface ValidarParams {
  organizacao_id: string;
  profissional_id: string;
  sala_id?: string | null;
  procedimento_id: string;
  inicio: number; // epoch ms do procedimento (sem preparo)
  duracao_min: number;
  tempo_preparo_min?: number;
  tempo_limpeza_min?: number;
  ignorarAgendamentoId?: string;
}

/**
 * Aplica as TRÊS regras anti-conflito, nesta ordem:
 *  1. nenhum agendamento no mesmo slot do profissional
 *  2. nenhum agendamento no mesmo slot da sala/recurso
 *  3. nunca fora do expediente (respeitando bloqueios de agenda e preparo/limpeza)
 * Lança ConflitoError na primeira violação.
 */
export function validarAgendamento(
  sqlite: Database,
  horarioFuncionamento: HorarioSemana | null,
  timezone: string,
  p: ValidarParams,
): Janela {
  const preparo = p.tempo_preparo_min ?? 0;
  const limpeza = p.tempo_limpeza_min ?? 0;
  const bloco: Janela = {
    inicio: p.inicio - preparo * min,
    fim: p.inicio + (p.duracao_min + limpeza) * min,
  };
  const procedimento: Janela = { inicio: p.inicio, fim: p.inicio + p.duracao_min * min };

  // REGRA 3 — expediente
  if (horarioFuncionamento) {
    const dow = diaDaSemana(p.inicio, timezone);
    const faixas = horarioFuncionamento[String(dow)];
    if (!faixas || faixas.length === 0) {
      throw new ConflitoError(
        `Dia ${dow} não há expediente configurado para esta organização`,
        "expediente",
      );
    }
    const base = inicioDoDia(p.inicio, timezone);
    const dentro = faixas.some(([ini, fim]) => {
      const abre = base + paraMinutos(ini) * min;
      const fecha = base + paraMinutos(fim) * min;
      return bloco.inicio >= abre && bloco.fim <= fecha;
    });
    if (!dentro) {
      const legiveis = faixas.map(([a, b]) => `${a}–${b}`).join(", ");
      throw new ConflitoError(
        `Fora do expediente (${legiveis}). O bloco reservado inclui preparo e limpeza.`,
        "expediente",
      );
    }
  }

  // Bloqueios de agenda do profissional e do recurso
  for (const [tabela, id, rotulo] of [
    ["profissionais", p.profissional_id, "profissional"],
    ["salas", p.sala_id, "recurso"],
  ] as const) {
    if (!id) continue;
    const row = sqlite
      .query(`SELECT bloqueios_agenda FROM ${tabela} WHERE organizacao_id = ? AND id = ?`)
      .get(p.organizacao_id, id) as { bloqueios_agenda: string | null } | null;
    if (!row?.bloqueios_agenda) continue;
    const bloqueios = JSON.parse(row.bloqueios_agenda) as { inicio: number; fim: number; motivo?: string }[];
    for (const b of bloqueios) {
      if (sobrepoe(bloco, { inicio: b.inicio, fim: b.fim })) {
        throw new ConflitoError(
          `Indisponível: ${rotulo} bloqueado (${b.motivo || "sem motivo informado"})`,
          "expediente",
        );
      }
    }
  }

  // REGRA 1 — slot do profissional
  for (const o of ocupados(sqlite, p.organizacao_id, "profissional_id", p.profissional_id, bloco, p.ignorarAgendamentoId)) {
    if (sobrepoe(bloco, o)) {
      throw new ConflitoError("Profissional já possui agendamento neste horário", "profissional");
    }
  }

  // REGRA 2 — slot do recurso
  if (p.sala_id) {
    for (const o of ocupados(sqlite, p.organizacao_id, "sala_id", p.sala_id, bloco, p.ignorarAgendamentoId)) {
      if (sobrepoe(bloco, o)) {
        throw new ConflitoError("Sala/recurso já ocupado neste horário", "recurso");
      }
    }
  }

  void procedimento;
  return bloco;
}

/** Horários livres reais para um procedimento — base das respostas da IA. */
export function horariosLivres(
  sqlite: Database,
  horarioFuncionamento: HorarioSemana | null,
  timezone: string,
  opts: {
    organizacao_id: string;
    profissional_id: string;
    sala_id?: string | null;
    procedimento_id: string;
    duracao_min: number;
    tempo_preparo_min?: number;
    tempo_limpeza_min?: number;
    de: number;
    ate: number;
    passo_min?: number;
  },
): number[] {
  if (!horarioFuncionamento) return [];
  const passo = (opts.passo_min ?? 30) * min;
  const livres: number[] = [];
  const preparo = (opts.tempo_preparo_min ?? 0) * min;
  const total = opts.duracao_min * min + (opts.tempo_limpeza_min ?? 0) * min;

  for (let dia = inicioDoDia(opts.de, timezone); dia <= opts.ate; dia += 24 * 60 * min) {
    const dow = diaDaSemana(dia, timezone);
    const faixas = horarioFuncionamento[String(dow)];
    if (!faixas) continue;
    for (const [ini, fim] of faixas) {
      const abre = dia + paraMinutos(ini) * min;
      const fecha = dia + paraMinutos(fim) * min;
      for (let t = abre; t + total <= fecha; t += passo) {
        if (t < opts.de) continue;
        if (t + preparo < abre) continue;
        if (t > opts.ate) continue;
        try {
          validarAgendamento(sqlite, horarioFuncionamento, timezone, {
            organizacao_id: opts.organizacao_id,
            profissional_id: opts.profissional_id,
            sala_id: opts.sala_id,
            procedimento_id: opts.procedimento_id,
            inicio: t,
            duracao_min: opts.duracao_min,
            tempo_preparo_min: opts.tempo_preparo_min,
            tempo_limpeza_min: opts.tempo_limpeza_min,
          });
          livres.push(t);
        } catch {
          // slot ocupado — segue para o próximo
        }
      }
    }
  }
  return livres;
}
