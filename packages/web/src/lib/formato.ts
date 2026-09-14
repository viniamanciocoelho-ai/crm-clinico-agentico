const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 2,
});

const moedaCurta = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export const brl = (valor: number) => moeda.format(valor);
export const brlCurto = (valor: number) => moedaCurta.format(valor);

export const numero = (valor: number, casas = 0) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(
    valor,
  );

/**
 * Percentual a partir de FRAÇÃO (0..1), que é como a API devolve toda taxa:
 * `taxa_cancelamento`, `taxa_no_show`, `taxa_retorno`, `taxa_ocupacao` em
 * `packages/api/src/routes/painel.ts` são razões, nunca valores já em
 * percentual. Formatar sem multiplicar mostra 10% como "0,1%".
 */
export const pct = (fracao: number, casas = 1) =>
  `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(fracao * 100)}%`;

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** "2026-09-14" → "14 set" */
export function dataCurta(iso: string) {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia} ${MESES[Number(mes) - 1]}`;
}

/** "2026-09-14" → "segunda, 14 de setembro" */
export function dataLonga(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00-03:00`);
  return `${DIAS[d.getDay()]}, ${iso.slice(8, 10)} de ${d.toLocaleString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" })}`;
}

/** ISO com offset → "08:30" (sem reinterpretar fuso). */
export const hora = (iso: string) => iso.slice(11, 16);

export function dataHoraCurta(iso: string) {
  return `${dataCurta(iso)} · ${hora(iso)}`;
}

/** Distância humana até agora. Aceita epoch em ms ou ISO. */
export function desde(instante: number | string, agora: number = Date.now()) {
  const alvo = typeof instante === "number" ? instante : new Date(instante).getTime();
  const diff = agora - alvo;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `${d} dias`;
}

/* ------------------------------------------------------------------------- *
 * Instantes vindos da API
 *
 * A API grava e devolve instante como epoch em MILISSEGUNDOS (`inicio`, `fim`,
 * `criado_em`, `ultima_mensagem_em`...), não como string ISO. O fuso de
 * apresentação é o da clínica, então tudo abaixo formata explicitamente em
 * `TZ_CLINICA` — nunca no fuso do navegador, que pode ser outro.
 * ------------------------------------------------------------------------- */

/** Fuso de apresentação. Igual ao padrão da API (`America/Sao_Paulo`). */
export const TZ_CLINICA = "America/Sao_Paulo";

const horaTz = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ_CLINICA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const diaTz = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_CLINICA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Epoch ms → "08:30" no fuso da clínica. */
export const horaDe = (ms: number) => horaTz.format(new Date(ms));

/** Epoch ms → "2026-09-14" (dia civil no fuso da clínica). */
export const diaDe = (ms: number) => diaTz.format(new Date(ms));

/** Epoch ms → "14 set". */
export const dataCurtaDe = (ms: number) => dataCurta(diaDe(ms));

/** Epoch ms → "14 set · 08:30". */
export const dataHoraDe = (ms: number) => `${dataCurtaDe(ms)} · ${horaDe(ms)}`;

/** Duração entre dois instantes, em minutos cheios. */
export const duracaoMin = (inicio: number, fim: number) => Math.round((fim - inicio) / 60000);

/**
 * Meia-noite local de um dia "YYYY-MM-DD" no fuso da clínica, em epoch ms.
 * Mesmo algoritmo de `zonedStartOfDay` na API: descobre o offset do fuso
 * naquele instante e corrige o chute em UTC.
 */
export function inicioDoDia(dia: string, timeZone = TZ_CLINICA): number {
  const chute = Date.parse(`${dia}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(chute)).map((x) => [x.type, x.value]));
  const comoLocal = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  return chute - (comoLocal - chute);
}

/** Dia civil de hoje no fuso da clínica, como "YYYY-MM-DD". */
export const hojeNaClinica = () => diaDe(Date.now());

/** Soma dias a um "YYYY-MM-DD" preservando o calendário civil. */
export function somarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Minutos desde a meia-noite do fuso da clínica — usado na régua da agenda. */
export const minutosNoDia = (ms: number) => {
  const [h, m] = horaDe(ms).split(":");
  return Number(h) * 60 + Number(m);
};

export const telefone = (valor: string) => valor.replace("+55 ", "");

export const iniciais = (nome: string) =>
  nome
    .replace(/^(Dra?\.|Sr\.?a?\.)\s*/i, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
