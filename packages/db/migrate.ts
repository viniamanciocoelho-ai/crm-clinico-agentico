import { Database } from "bun:sqlite";
import { garantirSchema } from "./ddl";

const dbPath = (process.env.DATABASE_URL || "dev.db").replace("file://", "").replace("file:", "");
const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

garantirSchema(sqlite);

const tables = sqlite
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all() as { name: string }[];

console.log(`✅ Migração aplicada — ${tables.length} tabelas:`);
console.log(tables.map((t) => `   ${t.name}`).join("\n"));
sqlite.close();
