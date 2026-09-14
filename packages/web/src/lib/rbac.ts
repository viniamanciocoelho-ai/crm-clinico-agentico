/**
 * RBAC do front. A fonte de verdade das permissões é `@cav-crm/shared`
 * (`ROLE_PERMISSIONS`), o MESMO mapa que `packages/api/src/middleware/
 * permissoes.ts` aplica no servidor — aqui ele só decide o que a interface
 * mostra. Nenhuma decisão de acesso depende deste arquivo: toda rota é checada
 * de novo no backend.
 *
 * Importante: não existe permissão inventada nesta camada. Só entram strings
 * que aparecem em `ROLE_PERMISSIONS` ou em alguma rota real de
 * `packages/api/src/routes/*`.
 */
import { ROLE_PERMISSIONS, RoleType } from "@cav-crm/shared";

export const ROLES = [
  RoleType.PROPRIETARIO,
  RoleType.GERENTE,
  RoleType.PROFISSIONAL,
  RoleType.RECEPCAO,
] as const;

export type Role = `${RoleType}`;

/**
 * Espelho de `EQUIVALENTES` em `packages/api/src/middleware/permissoes.ts`.
 * Mantido em sincronia manualmente: se o backend ganhar uma equivalência nova,
 * ela precisa ser refletida aqui, senão a interface esconde algo que o servidor
 * autorizaria (falha segura, não insegura).
 */
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

function concedidas(role: Role): string[] {
  return (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [];
}

/** Mesma decisão de `permissaoConcedida` no servidor. */
export function temPermissao(role: Role, permissao: string): boolean {
  const permissoes = concedidas(role);
  if (permissoes.includes("*")) return true;
  const aceitas = EQUIVALENTES[permissao] ?? [permissao];
  return aceitas.some((p) => permissoes.includes(p));
}

/**
 * True quando o perfil só alcança os próprios registros daquele recurso —
 * equivale a `apenasPropriaAgenda` / `apenasPropriosAtendimentos` no servidor.
 */
export function apenasProprios(role: Role, recurso: string): boolean {
  const permissoes = concedidas(role);
  if (permissoes.includes("*")) return false;
  return permissoes.includes(`${recurso}:read_own`) && !permissoes.includes(`${recurso}:read`);
}

export const ROLE_ROTULO: Record<Role, string> = {
  proprietario: "Proprietário",
  gerente: "Gerente",
  profissional: "Profissional",
  recepcao: "Recepção",
};

export const ROLE_DESCRICAO: Record<Role, string> = {
  proprietario: "Acesso total, incluindo financeiro, equipe e configuração da IA.",
  gerente: "Operação completa e relatórios; não gerencia usuários nem a organização.",
  profissional: "Vê apenas a própria agenda e os próprios atendimentos.",
  recepcao: "Agenda, clientes, atendimentos e conversas; sem relatórios nem configuração.",
};
