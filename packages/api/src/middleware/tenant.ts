import type { SessionData } from "../../../shared";
import { RoleType, TenantViolationError } from "../../../shared";
import { verifyJWT } from "../lib/auth";

export interface RequestContext {
  req: Request;
  session: SessionData;
  params: Record<string, string>;
}

/**
 * Extrai o tenant EXCLUSIVAMENTE do JWT autenticado.
 * Qualquer tentativa de fornecer organizacao_id por query string, header,
 * corpo ou path é rejeitada antes de tocar no banco.
 *
 * `urlBruta` é o target como veio no fio, antes do parser da URL. É necessário
 * porque `new URL()` colapsa `..` sozinho: quando o pedido chega normalizado,
 * o traversal já não existe mais para ser visto. O valor cru é o único lugar
 * onde ele ainda está visível.
 */
export async function resolveContext(req: Request, url: URL, urlBruta?: string): Promise<RequestContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Token ausente");
  }

  const payload = verifyJWT(authHeader.slice(7));
  if (!payload) throw new UnauthorizedError("Token inválido ou expirado");

  // Vetores de forja de tenant — nenhum pode passar
  if (url.searchParams.has("organizacao_id")) {
    throw new TenantViolationError("organizacao_id não pode vir da query string");
  }
  if (req.headers.get("X-Organizacao-Id")) {
    throw new TenantViolationError("organizacao_id não pode vir de header");
  }
  if (url.pathname.includes("organizacao_id=")) {
    throw new TenantViolationError("organizacao_id não pode vir do path");
  }
  assertSemTraversal(urlBruta ?? req.url);
  assertSemTraversal(url.pathname + url.search);

  const session: SessionData = {
    usuario_id: payload.usuario_id,
    organizacao_id: payload.organizacao_id,
    role: payload.role as RoleType,
    email: payload.email,
  };

  return { req, session, params: {} };
}

/**
 * Path traversal. Precisa olhar a URL CRUA: `new URL()` já normaliza `/../`
 * antes de qualquer checagem, então quem decide é o segmento decodificado.
 * Comparar segmento inteiro (e não substring) evita falso positivo em rotas
 * legítimas como `/medicoes..x`, e `.` isolado resolve para o próprio diretório.
 */
function assertSemTraversal(raw: string): void {
  for (const seg of raw.split("/")) {
    const niveis = [decodificar(seg)];
    // segunda passada pega `%252e%252e` (duplo-encoded), que o servidor
    // decodifica de novo antes de resolver o caminho
    if (niveis[0] !== undefined) niveis.push(decodificar(niveis[0]));
    for (const d of niveis) {
      if (d === undefined) continue;
      if (d === ".." || d === ".") throw new TenantViolationError("path traversal detectado");
      // `..` colado em separador dentro do mesmo segmento (ex.: path com
      // backslash, ou duplo-encoded que ainda resolve para traversal)
      if (/\.\.[\\/]/.test(d)) {
        throw new TenantViolationError("path traversal detectado");
      }
    }
  }
}

function decodificar(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined; // encoding inválido não forma traversal — deixa o router decidir
  }
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export { TenantViolationError };
