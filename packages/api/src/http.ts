import { PermissionDeniedError, TenantViolationError } from "@cav-crm/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Recurso não encontrado") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string) {
    super(400, message);
    this.name = "BadRequestError";
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * Lê e valida o corpo. `organizacao_id` no corpo é vetor de forja e é rejeitado
 * AQUI, no único ponto por onde todo corpo passa — assim nenhuma rota nova pode
 * esquecer de checar. `permitirOrganizacaoNoCorpo` existe apenas para o login,
 * que por definição ainda não tem sessão de onde tirar o tenant.
 */
export async function lerCorpo(
  req: Request,
  opcoes?: { permitirOrganizacaoNoCorpo?: boolean },
): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (!texto.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(texto);
  } catch {
    throw new BadRequestError("JSON inválido no corpo da requisição");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestError("O corpo da requisição deve ser um objeto JSON");
  }

  const corpo = parsed as Record<string, unknown>;
  if (!opcoes?.permitirOrganizacaoNoCorpo) {
    if ("organizacao_id" in corpo || "organizacaoId" in corpo) {
      throw new TenantViolationError("organizacao_id não pode vir do corpo da requisição");
    }
  }
  return corpo;
}

export function exigirTexto(body: Record<string, unknown>, campo: string): string {
  const valor = body[campo];
  if (typeof valor !== "string" || valor.trim() === "") {
    throw new BadRequestError(`Campo obrigatório ausente: ${campo}`);
  }
  return valor.trim();
}

export function opcionalTexto(body: Record<string, unknown>, campo: string): string | undefined {
  const valor = body[campo];
  if (valor === undefined || valor === null || valor === "") return undefined;
  if (typeof valor !== "string") throw new BadRequestError(`Campo ${campo} deve ser texto`);
  return valor.trim();
}

/** Converte ISO (string) ou epoch ms (number) em epoch ms. */
export function exigirInstante(body: Record<string, unknown>, campo: string): number {
  const valor = body[campo];
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string") {
    const ms = Date.parse(valor);
    if (!Number.isNaN(ms)) return ms;
  }
  throw new BadRequestError(`Campo ${campo} deve ser um instante ISO 8601 ou epoch em milissegundos`);
}

export function opcionalNumero(body: Record<string, unknown>, campo: string): number | undefined {
  const valor = body[campo];
  if (valor === undefined || valor === null || valor === "") return undefined;
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "" && Number.isFinite(Number(valor))) {
    return Number(valor);
  }
  throw new BadRequestError(`Campo ${campo} deve ser numérico`);
}

/**
 * Traduz exceções de domínio em resposta HTTP. Nenhum erro de negócio vira 500:
 * violação de tenant é 403, permissão negada é 403, conflito de agenda é 409.
 */
export function respostaDeErro(e: unknown): Response {
  if (e instanceof TenantViolationError) return json({ error: e.message, tipo: "tenant" }, 403);
  if (e instanceof PermissionDeniedError) return json({ error: e.message, tipo: "permissao" }, 403);
  if (e instanceof ApiError) return json({ error: e.message, tipo: "requisicao" }, e.status);
  if (e instanceof Error && e.name === "ConflitoError") {
    const regra = (e as Error & { regra?: string }).regra;
    return json({ error: e.message, tipo: "conflito", regra }, 409);
  }
  if (e instanceof Error && e.name === "UnauthorizedError") {
    return json({ error: e.message, tipo: "autenticacao" }, 401);
  }
  console.error("[erro não tratado]", e);
  return json({ error: "Erro interno do servidor", tipo: "interno" }, 500);
}
