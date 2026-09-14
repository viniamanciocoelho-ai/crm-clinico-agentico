import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { DDL } from "@cav-crm/db";
import { createJWT } from "./lib/auth";
import { carregarOrg } from "./lib/org";
import { criarAgendamento } from "./lib/agente";
import { confirmarAtendimento } from "./lib/contabil";
import { respostaDeErro } from "./http";
import { exigirPermissao, permissaoConcedida } from "./middleware/permissoes";
import { criarHandler, type ContextoRota, type Rota } from "./router";
import { rotasAuth } from "./routes/auth";
import { rotasClientes } from "./routes/clientes";
import { rotasConversas } from "./routes/conversas";
import { rotasAtendimentos } from "./routes/atendimentos";
import { rotasDemoAtivas } from "./routes/demo";

const org = "org-teste";
let sqlite: Database | undefined;

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

function banco() {
  sqlite = new Database(":memory:");
  sqlite.exec(DDL);
  sqlite.run(
    `INSERT INTO organizacoes (id, organizacao_id, nome, timezone)
     VALUES (?, ?, ?, ?)`,
    crypto.randomUUID(),
    org,
    "Clínica de teste",
    "America/Cuiaba",
  );
  return sqlite;
}

function contexto(req: Request, params: Record<string, string>, organizacao_id = org): ContextoRota {
  return {
    req,
    url: new URL(req.url),
    urlBruta: new URL(req.url).pathname,
    sqlite: sqlite!,
    params,
    session: {
      usuario_id: "usuario-teste",
      organizacao_id,
      role: "proprietario",
      email: "teste@example.com",
    },
  };
}

function rota(rotas: Rota[], metodo: string, caminho: string): Rota {
  const encontrada = rotas.find((r) => r.metodo === metodo && r.caminho === caminho);
  if (!encontrada) throw new Error(`Rota não encontrada no teste: ${metodo} ${caminho}`);
  return encontrada;
}

async function executarRota(rota: Rota, ctx: ContextoRota): Promise<Response> {
  try {
    return await rota.handler(ctx);
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

describe("Regressões de roteamento e contratos", () => {
  it("não registra rotas públicas da demo quando o modo demo está desligado", () => {
    expect(rotasDemoAtivas(false)).toEqual([]);
    expect(rotasDemoAtivas(true).map((r) => `${r.metodo} ${r.caminho}`)).toContain("GET /demo");
    expect(rotasDemoAtivas(true).map((r) => `${r.metodo} ${r.caminho}`)).toContain("POST /demo/reset");
  });

  it("não deixa encoding inválido escapar como exceção não tratada", async () => {
    const db = banco();
    const handler = criarHandler(
      [{ metodo: "GET", caminho: "/recursos/:id", publica: true, handler: () => new Response("ok") }],
      db,
    );

    const resposta = await handler(new Request("http://teste/recursos/%"), "/recursos/%");

    expect(resposta.status).toBe(404);
  });

  it("limita tentativas públicas de login por IP", async () => {
    const db = banco();
    const handler = criarHandler(rotasAuth, db, () => "203.0.113.10");
    const req = () =>
      new Request("http://teste/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nao@example.com", password: "errada", organizacao_id: org }),
      });

    let ultima!: Response;
    for (let i = 0; i < 11; i++) ultima = await handler(req(), "/auth/login");

    expect(ultima.status).toBe(429);
  });

  it("aplica RBAC pelo middleware, não apenas pela constante de permissões", () => {
    expect(permissaoConcedida("profissional", "agenda:read")).toBeTrue();
    expect(permissaoConcedida("profissional", "financeiro:read")).toBeFalse();
    expect(() => exigirPermissao("profissional", "financeiro:read")).toThrow("não tem a permissão");
  });
});

describe("Regressões de isolamento e integridade", () => {
  it("rejeita lead de outra organização ao abrir conversa", async () => {
    const db = banco();
    db.run(
      `INSERT INTO leads (id, organizacao_id, telefone, etapa, canal_entrada, atendido_por_tipo)
       VALUES (?, ?, ?, 'novo', 'whatsapp', 'humano')`,
      "lead-de-outra-org",
      "org-outra",
      "+5565999990000",
    );

    const resposta = await executarRota(
      rota(rotasConversas, "POST", "/conversas"),
      contexto(
        new Request("http://teste/conversas", {
          method: "POST",
          body: JSON.stringify({ telefone: "+5565999990000", lead_id: "lead-de-outra-org" }),
        }),
        {},
      ),
    );

    expect(resposta.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS total FROM conversas").get()).toEqual({ total: 0 });
  });

  it("não permite forjar mensagem de IA na rota de mensagem do cliente", async () => {
    const db = banco();
    db.run(
      `INSERT INTO conversas (id, organizacao_id, telefone, status)
       VALUES (?, ?, ?, 'com_ia')`,
      "conversa-1",
      org,
      "+5565999990001",
    );

    const resposta = await executarRota(
      rota(rotasConversas, "POST", "/conversas/:id/mensagens"),
      contexto(
        new Request("http://teste/conversas/conversa-1/mensagens", {
          method: "POST",
          body: JSON.stringify({ remetente_tipo: "ia", conteudo: "mensagem forjada" }),
        }),
        { id: "conversa-1" },
      ),
    );

    expect(resposta.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS total FROM mensagens").get()).toEqual({ total: 0 });
  });

  it("limpa motivo e observação ao sair de perdido mesmo sem motivo no body", async () => {
    const db = banco();
    db.run(
      `INSERT INTO motivos_perda (id, organizacao_id, descricao) VALUES (?, ?, ?)`,
      "motivo-1",
      org,
      "Sem interesse",
    );
    db.run(
      `INSERT INTO leads
       (id, organizacao_id, telefone, etapa, canal_entrada, atendido_por_tipo, motivo_perda_id, observacao_perda)
       VALUES (?, ?, ?, 'perdido', 'whatsapp', 'humano', ?, ?)`,
      "lead-1",
      org,
      "+5565999990002",
      "motivo-1",
      "observação restrita",
    );

    const resposta = await executarRota(
      rota(rotasClientes, "PATCH", "/leads/:id/etapa"),
      contexto(
        new Request("http://teste/leads/lead-1/etapa", {
          method: "PATCH",
          body: JSON.stringify({ etapa: "novo" }),
        }),
        { id: "lead-1" },
      ),
    );

    expect(resposta.status).toBe(200);
    expect(db.query("SELECT motivo_perda_id, observacao_perda FROM leads WHERE id = 'lead-1'").get()).toEqual({
      motivo_perda_id: null,
      observacao_perda: null,
    });
  });
});

describe("Regressões do agente e financeiro", () => {
  it("não cria cliente quando o horário do agendamento entra em conflito", () => {
    const db = banco();
    db.run(
      `INSERT INTO procedimentos (id, organizacao_id, nome, duracao_min, preco)
       VALUES ('proc-1', ?, 'Consulta', 60, 100)`,
      org,
    );
    db.run(
      `INSERT INTO profissionais (id, organizacao_id, nome) VALUES ('prof-1', ?, 'Profissional')`,
      org,
    );
    db.run(
      `INSERT INTO procedimento_profissionais (id, organizacao_id, procedimento_id, profissional_id)
       VALUES ('pp-1', ?, 'proc-1', 'prof-1')`,
      org,
    );
    const inicio = Date.now() + 24 * 60 * 60 * 1000;
    db.run(
      `INSERT INTO clientes (id, organizacao_id, nome, telefone)
       VALUES ('cliente-1', ?, 'Cliente existente', '+5565999990003')`,
      org,
    );
    db.run(
      `INSERT INTO agendamentos
       (id, organizacao_id, cliente_id, profissional_id, procedimento_id, inicio, fim,
        inicio_bloqueio, fim_bloqueio, status, origem)
       VALUES ('ag-1', ?, 'cliente-1', 'prof-1', 'proc-1', ?, ?, ?, ?, 'agendado', 'manual')`,
      org,
      inicio,
      inicio + 60 * 60 * 1000,
      inicio,
      inicio + 60 * 60 * 1000,
    );

    const resultado = criarAgendamento(
      db,
      { organizacao_id: org, timezone: "America/Cuiaba" },
      null,
      {
        telefone: "+5565999990004",
        nome_cliente: "Novo cliente",
        termo_procedimento: "Consulta",
        inicio,
      },
    );

    expect(resultado.dados_decisao).toEqual({ erro: "profissional" });
    expect(db.query("SELECT COUNT(*) AS total FROM clientes WHERE telefone = '+5565999990004'").get()).toEqual({
      total: 0,
    });
  });

  it("rejeita configuração JSON inválida em vez de tratá-la como ausência", () => {
    const db = banco();
    db.run(`UPDATE organizacoes SET horario_funcionamento = ? WHERE organizacao_id = ?`, "{", org);

    expect(() => carregarOrg(db, org)).toThrow("horario_funcionamento");
  });

  it("reembolsa o atendimento original uma vez e devolve o movimento efetivo", async () => {
    const db = banco();
    db.run(
      `INSERT INTO procedimentos (id, organizacao_id, nome, duracao_min, preco)
       VALUES ('proc-2', ?, 'Procedimento', 30, 100)`,
      org,
    );
    db.run(`INSERT INTO profissionais (id, organizacao_id, nome) VALUES ('prof-2', ?, 'Profissional')`, org);
    db.run(`INSERT INTO clientes (id, organizacao_id, nome, telefone) VALUES ('cliente-2', ?, 'Cliente', '2')`, org);
    db.run(
      `INSERT INTO insumos (id, organizacao_id, nome, unidade, custo_unitario, estoque_atual)
       VALUES ('insumo-1', ?, 'Insumo', 'un', 5, 10)`,
      org,
    );
    db.run(
      `INSERT INTO ficha_tecnica_itens (id, organizacao_id, procedimento_id, insumo_id, quantidade)
       VALUES ('ficha-1', ?, 'proc-2', 'insumo-1', 2)`,
      org,
    );

    const criado = confirmarAtendimento(db, {
      organizacao_id: org,
      cliente_id: "cliente-2",
      profissional_id: "prof-2",
      procedimento_id: "proc-2",
      status: "concluido",
      valor: 100,
    });
    expect(db.query("SELECT estoque_atual FROM insumos WHERE id = 'insumo-1'").get()).toEqual({ estoque_atual: 8 });

    const endpoint = rota(rotasAtendimentos, "POST", "/atendimentos/:id/reembolsar");
    const resposta = await executarRota(
      endpoint,
      contexto(
        new Request("http://teste", {
          method: "POST",
          body: JSON.stringify({ observacoes: "Estorno confirmado" }),
        }),
        { id: criado.id },
      ),
    );
    expect(resposta.status).toBe(201);
    expect(db.query("SELECT status FROM atendimentos WHERE id = ?").get(criado.id)).toEqual({
      status: "reembolsado",
    });
    expect(db.query("SELECT observacoes FROM atendimentos WHERE id = ?").get(criado.id)).toEqual({
      observacoes: "Estorno confirmado",
    });
    expect(db.query("SELECT estoque_atual FROM insumos WHERE id = 'insumo-1'").get()).toEqual({ estoque_atual: 10 });
    expect(db.query("SELECT status FROM pagamentos WHERE atendimento_id = ?").get(criado.id)).toEqual({
      status: "estornado",
    });

    const segunda = await executarRota(endpoint, contexto(new Request("http://teste"), { id: criado.id }));
    expect(segunda.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS total FROM movimentacoes_estoque WHERE atendimento_id = ?").get(criado.id)).toEqual({
      total: 2,
    });
  });
});
