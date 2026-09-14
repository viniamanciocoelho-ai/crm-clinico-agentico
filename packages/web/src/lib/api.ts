/**
 * Cliente REST da API do CAV CRM (`packages/api`). Não há geração de tipos nem
 * RPC: cada chamada bate direto nas rotas registradas em
 * `packages/api/src/index.ts`, no mesmo contrato que o roteador expõe.
 *
 * Contrato de erro seguido aqui (ver `packages/api/src/http.ts`,
 * `respostaDeErro`): o corpo de falha é sempre `{ error, tipo }`, com `tipo` em
 * `tenant | permissao | requisicao | conflito | autenticacao | interno`.
 */

const BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

const CHAVE_TOKEN = "cav-crm-token";

/** Disparado quando a API recusa o token — a sessão escuta para deslogar. */
export const EVENTO_SESSAO_EXPIRADA = "cav-crm:sessao-expirada";

export type TipoErroApi =
  | "tenant"
  | "permissao"
  | "requisicao"
  | "conflito"
  | "autenticacao"
  | "interno"
  | "rede";

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly tipo: TipoErroApi,
    readonly regra?: string,
  ) {
    super(message);
    this.name = "ErroApi";
  }

  get negado(): boolean {
    return this.tipo === "permissao" || this.tipo === "tenant";
  }
}

export function lerToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CHAVE_TOKEN);
}

export function salvarToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(CHAVE_TOKEN, token);
  else window.localStorage.removeItem(CHAVE_TOKEN);
}

export type Parametros = Record<string, string | number | boolean | undefined | null>;

function comQuery(caminho: string, params?: Parametros): string {
  if (!params) return caminho;
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === null || valor === "") continue;
    busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `${caminho}?${texto}` : caminho;
}

interface OpcoesApi {
  metodo?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  corpo?: unknown;
  params?: Parametros;
  /** Rotas públicas (`/health`, `/demo`, `/auth/login`) não mandam token. */
  semAutenticacao?: boolean;
}

export async function api<T>(caminho: string, opcoes: OpcoesApi = {}): Promise<T> {
  const { metodo = "GET", corpo, params, semAutenticacao } = opcoes;
  const cabecalhos: Record<string, string> = {};
  if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";

  if (!semAutenticacao) {
    const token = lerToken();
    if (token) cabecalhos["Authorization"] = `Bearer ${token}`;
  }

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${comQuery(caminho, params)}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (e) {
    throw new ErroApi(0, e instanceof Error ? e.message : "Falha de rede", "rede");
  }

  const texto = await resposta.text();
  const dados = texto.trim() ? (JSON.parse(texto) as unknown) : null;

  if (!resposta.ok) {
    const info = (dados ?? {}) as { error?: string; tipo?: TipoErroApi; regra?: string };
    const tipo: TipoErroApi = info.tipo ?? (resposta.status === 401 ? "autenticacao" : "interno");

    if (resposta.status === 401 && !semAutenticacao) {
      salvarToken(null);
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    }

    throw new ErroApi(
      resposta.status,
      info.error ?? `Falha na requisição (${resposta.status})`,
      tipo,
      info.regra,
    );
  }

  return dados as T;
}

/** Instante ISO com offset local, formato aceito por `exigirInstante` na API. */
export function paraInstante(data: Date): string {
  return data.toISOString();
}
