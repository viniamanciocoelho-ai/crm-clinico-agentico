import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_URL || "dev.db";
const dbFile = dbPath.replace("file://", "").replace("file:", "");

const sqlite = new Database(dbFile);
sqlite.exec("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });

export default db;
