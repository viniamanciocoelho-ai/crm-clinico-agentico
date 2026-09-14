import { ROLE_PERMISSIONS, PermissionDeniedError, type RoleType } from "@cav-crm/shared";

/** Permissões alternativas aceitas para a mesma ação (ex.: ver agenda própria OU geral). */
const EQUIVALENTES: Record<string, string[]> = {
  "agenda:read": ["agenda:read", "agenda:read_own"],
  "agenda:write": ["agenda:write"],
  "atendimentos:read": ["atendimentos:read", "atendimentos:read_own"],
  "atendimentos:write": ["atendimentos:write"],
  "clientes:read": ["clientes:read"],
  "clientes:write": ["clientes:write"],
  "relatorios:read": ["relatorios:read"],
  "usuarios:write": ["usuarios:write"],
  "financeiro:read": ["financeiro:read"],
  "agente_ia:config": ["agente_ia:config"],
  "conversas:read": ["conversas:read"],
  "conversas:write": ["conversas:write"],
};

export function permissaoConcedida(role: RoleType, permissao: string): boolean {
  const concedidas = (ROLE_PERMISSIONS as Record<string, string[]>)[role];
  if (!concedidas) return false;
  if (concedidas.includes("*")) return true;

  const aceitas = EQUIVALENTES[permissao] ?? [permissao];
  return aceitas.some((p) => concedidas.includes(p));
}

/**
 * Uma ação de leitura restrita (`*:read_own`) nunca é concedida por permissão
 * genérica — o handler precisa filtrar por profissional. Aqui só barramos quem
 * não tem nenhuma das formas.
 */
export function exigirPermissao(role: RoleType, permissao: string): void {
  if (!permissaoConcedida(role, permissao)) {
    throw new PermissionDeniedError(`O papel "${role}" não tem a permissão "${permissao}"`);
  }
}

/** Só enxerga a própria agenda quem tem `read_own` e não a leitura geral. */
export function apenasPropriaAgenda(role: RoleType): boolean {
  const concedidas = (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [];
  if (concedidas.includes("*")) return false;
  return concedidas.includes("agenda:read_own") && !concedidas.includes("agenda:read");
}

/** Idem para registros de atendimento. */
export function apenasPropriosAtendimentos(role: RoleType): boolean {
  const concedidas = (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [];
  if (concedidas.includes("*")) return false;
  return concedidas.includes("atendimentos:read_own") && !concedidas.includes("atendimentos:read");
}
