import { sqlite, PORT, DEMO_MODE, DEMO_ORG_ID } from "./config";
import { criarHandler, type Rota } from "./router";
import { ipDoCliente } from "./middleware/limite";
import { garantirSchema } from "@cav-crm/db";
import { json } from "./http";
import { iniciarJobs } from "./jobs";

import { rotasAuth } from "./routes/auth";
import { rotasCatalogo } from "./routes/catalogo";
import { rotasAgenda } from "./routes/agenda";
import { rotasAtendimentos } from "./routes/atendimentos";
import { rotasClientes } from "./routes/clientes";
import { rotasConversas } from "./routes/conversas";
import { rotasAgente } from "./routes/agente";
import { rotasPainel } from "./routes/painel";
import { rotasDemoAtivas } from "./routes/demo";

garantirSchema(sqlite);

/**
 * `/health` fica fora do roteador de propósito: precisa responder mesmo com o
 * banco indisponível, senão não serve como health check.
 */
const saude: Rota = {
  metodo: "GET",
  caminho: "/health",
  publica: true,
  handler() {
    let banco = "ok";
    try {
      sqlite.query("SELECT 1").get();
    } catch (e) {
      banco = e instanceof Error ? e.message : "indisponível";
    }
    return json({
      status: banco === "ok" ? "ok" : "degradado",
      banco,
      ...(DEMO_MODE ? { organizacao_demo: DEMO_ORG_ID } : {}),
    });
  },
};

const rotas: Rota[] = [
  saude,
  ...rotasAuth,
  ...rotasCatalogo,
  ...rotasAgenda,
  ...rotasAtendimentos,
  ...rotasClientes,
  ...rotasConversas,
  ...rotasAgente,
  ...rotasPainel,
  ...rotasDemoAtivas(),
];

/**
 * O IP do socket só existe no `fetch` do servidor, que é quem tem o `server`.
 * O `Request` não carrega essa informação, então ela é posta aqui na chegada e
 * lida pelo router ao limitar as rotas públicas.
 */
const ipPorRequisicao = new WeakMap<Request, string>();

const fetch = criarHandler(rotas, sqlite, (req) => ipPorRequisicao.get(req) ?? "desconhecido");

/**
 * Extrai o target cru SEM passar por `new URL()`. Qualquer `new URL()` aqui
 * apagaria o rastro de traversal — que é justamente o que o gate precisa ver —
 * e o furo não daria sintoma nenhum: tudo continuaria respondendo 200.
 */
function targetCru(url: string): string {
  const esquema = url.indexOf("://");
  if (esquema === -1) return url;
  const barra = url.indexOf("/", esquema + 3);
  return barra === -1 ? "/" : url.slice(barra);
}

export default {
  port: PORT,
  /**
   * O segundo argumento é o target cru do HTTP, ANTES de qualquer
   * normalização. É a única fonte onde `..` e `%2e%2e` ainda existem.
   */
  fetch(req: Request, server: { requestIP?: (req: Request) => unknown }) {
    const ip = ipDoCliente(
      typeof server.requestIP === "function" ? server.requestIP(req) : undefined,
      req.headers,
    );
    ipPorRequisicao.set(req, ip);
    return fetch(req, targetCru(req.url));
  },
};

const pararJobs = iniciarJobs(sqlite);
process.on("SIGINT", () => {
  pararJobs();
  sqlite.close();
  process.exit(0);
});

console.log(`🚀 CAV CRM API — http://localhost:${PORT}`);
