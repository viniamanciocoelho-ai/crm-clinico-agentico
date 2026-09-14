import type { SessionData } from "@cav-crm/shared";
import { resolveContext } from "./middleware/tenant";
import { exigirPermissao } from "./middleware/permissoes";
import { ApiError, respostaDeErro } from "./http";

export interface ContextoRota {
  req: Request;
  url: URL;
  /** Target como veio no fio, antes do parser da URL. Só ele preserva traversal. */
  urlBruta: string;
  session: SessionData;
  sqlite: import("bun:sqlite").Database;
  /** Grupos de captura do padrão da rota. */
  params: Record<string, string>;
}

export interface Rota {
  metodo: string;
  /** Caminho relativo: `/agendamentos/:id/remarcar` */
  caminho: string;
  /** Permissão exigida. Ausente = qualquer sessão autenticada. */
  permissao?: string;
  /** `true` dispensa autenticação (login, health, demo pública). */
  publica?: boolean;
  handler: (ctx: ContextoRota) => Promise<Response> | Response;
}

interface Casada {
  rota: Rota;
  params: Record<string, string>;
}

function casar(padrao: string, caminho: string): Record<string, string> | null {
  const p = padrao.split("/").filter((s) => s !== "");
  const c = caminho.split("/").filter((s) => s !== "");
  if (p.length !== c.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.startsWith(":")) {
      params[seg.slice(1)] = decodeURIComponent(c[i]);
      continue;
    }
    if (seg !== c[i]) return null;
  }
  return params;
}

function buscar(rotas: Rota[], metodo: string, caminho: string): Casada | null {
  for (const rota of rotas) {
    if (rota.metodo !== metodo) continue;
    const params = casar(rota.caminho, caminho);
    if (params) return { rota, params };
  }
  return null;
}

/**
 * CORS. O front roda no Vite (outra porta) em desenvolvimento, então sem isto
 * o navegador bloqueia tudo. A autenticação é por `Authorization: Bearer`, não
 * por cookie — por isso não há `Allow-Credentials`, e o token NUNCA é aceito
 * de cookie: um cookie viajaria sozinho em requisição de outro site.
 */
function origemPermitida(origem: string | null): string | null {
  if (!origem) return null;
  const fixas = (process.env.APP_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fixas.includes(origem)) return origem;
  // Porta do Vite muda quando a 3000 está ocupada (3001, 3002...).
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origem)) return origem;
  return null;
}

function comCors(res: Response, req: Request): Response {
  const permitida = origemPermitida(req.headers.get("Origin"));
  if (!permitida) return res;

  const cabecalhos = new Headers(res.headers);
  cabecalhos.set("Access-Control-Allow-Origin", permitida);
  cabecalhos.set("Vary", "Origin");
  cabecalhos.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  cabecalhos.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  cabecalhos.set("Access-Control-Max-Age", "600");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: cabecalhos });
}

/**
 * Executa a rota: resolve o tenant a partir do JWT, checa permissão e delega.
 * `urlBruta` é obrigatório — sem ele o gate de traversal não vê nada, porque
 * `new URL()` já apagou o rastro antes de qualquer verificação.
 */
export function criarHandler(rotas: Rota[], sqlite: import("bun:sqlite").Database) {
  return async function fetch(req: Request, urlBruta: string): Promise<Response> {
    const url = new URL(req.url);
    const caminho = url.pathname;

    // Preflight: não carrega token nem tenant, então responde antes de tudo.
    if (req.method === "OPTIONS") {
      return comCors(new Response(null, { status: 204 }), req);
    }

    const casada = buscar(rotas, req.method, caminho);
    if (!casada) {
      // Distingue rota inexistente de método errado no mesmo caminho.
      const existeOutroMetodo = rotas.some((r) => casar(r.caminho, caminho));
      return comCors(
        respostaDeErro(
          existeOutroMetodo
            ? new ApiError(405, "Método não permitido para esta rota")
            : new ApiError(404, "Rota não encontrada"),
        ),
        req,
      );
    }

    try {
      const { rota, params } = casada;

      if (rota.publica) {
        const r = await rota.handler({
          req,
          url,
          urlBruta,
          sqlite,
          params,
          session: { usuario_id: "", organizacao_id: "", role: "" as never, email: "" },
        });
        return comCors(r, req);
      }

      const base = await resolveContext(req, url, urlBruta);
      if (rota.permissao) exigirPermissao(base.session.role, rota.permissao);

      const r = await rota.handler({ req, url, urlBruta, sqlite, params, session: base.session });
      return comCors(r, req);
    } catch (e) {
      return comCors(respostaDeErro(e), req);
    }
  };
}
