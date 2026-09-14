import { Database } from "bun:sqlite";

/** Banco de dev. Turso entra no lugar em produção, sem tocar no resto do código. */
export const DB_PATH = (process.env.DATABASE_URL || "dev.db")
  .replace("file://", "")
  .replace("file:", "");

export const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const PORT = Number(process.env.PORT || 3001);
export const DEMO_MODE = process.env.DEMO_MODE === "true";

/**
 * Organização da demo pública. Fixa e isolada: nenhuma rota autenticada
 * alcança este tenant, e nenhuma rota pública alcança outro.
 */
export const DEMO_ORG_ID = "demo-org-001";
