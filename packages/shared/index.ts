// Roles
export enum RoleType {
  PROPRIETARIO = "proprietario",
  GERENTE = "gerente",
  PROFISSIONAL = "profissional",
  RECEPCAO = "recepcao",
}

/**
 * Permissões por papel. A IA NÃO é um papel: não tem linha aqui e não tem
 * registro em `usuarios` — suas ações são gravadas com `autor_tipo = 'ia'`.
 *
 * Recorte conforme a spec:
 * - Proprietário: tudo, inclusive cobrança e usuários.
 * - Gerente: agenda, clientes, relatórios e config da IA. Sem cobrança.
 * - Profissional: apenas a própria agenda e os próprios registros.
 * - Recepção: todas as agendas, cadastro de cliente e a fila de atendimento
 *   humano do WhatsApp. Sem relatório financeiro.
 */
export const ROLE_PERMISSIONS = {
  [RoleType.PROPRIETARIO]: ["*"],
  [RoleType.GERENTE]: [
    "agenda:read",
    "agenda:write",
    "clientes:read",
    "clientes:write",
    "relatorios:read",
    "agente_ia:config",
    "atendimentos:read",
    "atendimentos:write",
    "conversas:read",
    "conversas:write",
  ],
  [RoleType.PROFISSIONAL]: ["agenda:read_own", "atendimentos:read_own"],
  [RoleType.RECEPCAO]: [
    "agenda:read",
    "agenda:write",
    "clientes:read",
    "clientes:write",
    "atendimentos:read",
    "atendimentos:write",
    "conversas:read",
    "conversas:write",
  ],
};

// Session context
export interface SessionData {
  usuario_id: string;
  organizacao_id: string;
  role: RoleType;
  email: string;
}

// Error types
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolationError";
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}
