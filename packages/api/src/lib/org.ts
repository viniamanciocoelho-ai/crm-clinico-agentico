import type { Database } from "bun:sqlite";

export type HorarioSemana = Record<string, [string, string][]>;

export interface OrgConfig {
  organizacao_id: string;
  nome: string;
  timezone: string;
  horario_funcionamento: HorarioSemana | null;
  config_agente_ia: Record<string, unknown> | null;
  reativacao_dias: number;
}

function json<T>(valor: string | null, campo: string): T | null {
  if (!valor) return null;
  try {
    return JSON.parse(valor) as T;
  } catch {
    throw new Error(`Configuração inválida em ${campo}`);
  }
}

export function carregarOrg(sqlite: Database, organizacao_id: string): OrgConfig {
  const row = sqlite
    .query(
      `SELECT organizacao_id, nome, timezone, horario_funcionamento, config_agente_ia, reativacao_dias
       FROM organizacoes WHERE organizacao_id = ?`,
    )
    .get(organizacao_id) as {
    organizacao_id: string;
    nome: string;
    timezone: string;
    horario_funcionamento: string | null;
    config_agente_ia: string | null;
    reativacao_dias: number;
  } | null;

  if (!row) throw new Error(`Organização não encontrada: ${organizacao_id}`);

  return {
    organizacao_id: row.organizacao_id,
    nome: row.nome,
    timezone: row.timezone,
    horario_funcionamento: json<HorarioSemana>(row.horario_funcionamento, "horario_funcionamento"),
    config_agente_ia: json<Record<string, unknown>>(row.config_agente_ia, "config_agente_ia"),
    reativacao_dias: row.reativacao_dias,
  };
}

/**
 * Profissional vinculado ao usuário logado. Usado para restringir quem só
 * enxerga a própria agenda — o vínculo é dado do banco, nunca do pedido.
 */
export function profissionalDoUsuario(
  sqlite: Database,
  organizacao_id: string,
  usuario_id: string,
): string | null {
  const row = sqlite
    .query(`SELECT id FROM profissionais WHERE organizacao_id = ? AND usuario_id = ? LIMIT 1`)
    .get(organizacao_id, usuario_id) as { id: string } | null;
  return row?.id ?? null;
}
