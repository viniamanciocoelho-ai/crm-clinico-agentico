import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { cadastrarCliente } from "./agente";

let sqlite: Database | undefined;

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

describe("Agente audit log", () => {
  it("redacts personal data before persisting action inputs", () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE clientes (
        id TEXT PRIMARY KEY,
        organizacao_id TEXT NOT NULL,
        nome TEXT NOT NULL,
        telefone TEXT NOT NULL,
        email TEXT,
        data_nascimento TEXT,
        origem_lead TEXT,
        observacoes TEXT,
        lgpd_consentimento INTEGER,
        lgpd_data INTEGER,
        lgpd_canal TEXT
      );
      CREATE TABLE ia_acoes_log (
        id TEXT PRIMARY KEY,
        organizacao_id TEXT NOT NULL,
        autor_tipo TEXT NOT NULL,
        tipo_acao TEXT NOT NULL,
        conversa_id TEXT,
        dados_entrada TEXT,
        dados_decisao TEXT,
        sucesso INTEGER NOT NULL,
        erro TEXT
      );
    `);

    cadastrarCliente(
      sqlite,
      { organizacao_id: "org-teste", timezone: "America/Cuiaba" },
      null,
      {
        telefone: "+55 65 99999-1234",
        nome: "Paciente Teste",
        email: "paciente@example.com",
        data_nascimento: "1990-01-02",
        observacoes: "Informacao clinica privada",
      },
    );

    const registro = sqlite
      .query("SELECT dados_entrada FROM ia_acoes_log WHERE organizacao_id = ?")
      .get("org-teste") as { dados_entrada: string };

    expect(registro.dados_entrada).not.toContain("Paciente Teste");
    expect(registro.dados_entrada).not.toContain("99999-1234");
    expect(registro.dados_entrada).not.toContain("paciente@example.com");
    expect(registro.dados_entrada).not.toContain("1990-01-02");
    expect(registro.dados_entrada).not.toContain("Informacao clinica privada");
    expect(registro.dados_entrada).toContain("[REDACTED]");
  });
});
