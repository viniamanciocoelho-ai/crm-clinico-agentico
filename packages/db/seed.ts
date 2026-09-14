import { Database } from "bun:sqlite";
import { garantirSchema } from "./ddl";
import { semearDemo, limparDemo } from "../api/src/routes/demo";

const DB_PATH = (process.env.DATABASE_URL || "dev.db").replace("file://", "").replace("file:", "");
const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

/**
 * Seed de linha de comando. Não reimplementa nada: chama exatamente o mesmo
 * `semearDemo` que a rota pública `POST /demo/reset` usa. Duas rotinas de seed
 * divergiriam com o tempo e a demo deixaria de representar o sistema real —
 * que é justamente o que ela existe para provar.
 *
 * A versão anterior deste arquivo usava `require("bun:sqlite")` dentro de um
 * pacote `"type": "module"` e criava só 4 usuários, sem clínica nenhuma.
 */
function main(): void {
  garantirSchema(sqlite);
  const recriar = process.argv.includes("--recriar");

  if (recriar) {
    limparDemo(sqlite);
    console.log("🗑️  Organização da demo removida.");
  }

  semearDemo(sqlite);

  const contar = (tabela: string) =>
    (
      sqlite
        .query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE organizacao_id = ?`)
        .get("demo-org-001") as { n: number }
    ).n;

  console.log("✅ Demo semeada — organização demo-org-001 (Clínica Aurora Estética)");
  console.log(`   profissionais: ${contar("profissionais")}`);
  console.log(`   procedimentos: ${contar("procedimentos")}`);
  console.log(`   clientes:      ${contar("clientes")}`);
  console.log(`   agendamentos:  ${contar("agendamentos")}`);
  console.log(`   atendimentos:  ${contar("atendimentos")}`);
  console.log(`   conversas:     ${contar("conversas")}`);
  console.log("");
  console.log("   Acessos (senha demo123456, organizacao_id demo-org-001):");
  for (const email of [
    "proprietaria@demo.cav",
    "gerente@demo.cav",
    "profissional@demo.cav",
    "recepcao@demo.cav",
  ]) {
    console.log(`     ${email}`);
  }
}

main();
sqlite.close();
