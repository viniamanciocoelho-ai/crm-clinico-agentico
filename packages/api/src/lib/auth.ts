import { createHash, createHmac, timingSafeEqual } from "crypto";

function segredo(nome: "JWT_SECRET" | "PASSWORD_SALT", valorDev: string): string {
  const valor = process.env[nome];
  if (valor) return valor;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${nome} é obrigatório em produção`);
  }
  return valorDev;
}

const JWT_SECRET = segredo("JWT_SECRET", "dev-secret");
const PASSWORD_SALT = segredo("PASSWORD_SALT", "dev-salt");
const JWT_EXPIRY_DAYS = 7;

export function hashPassword(password: string): string {
  return createHash("sha256").update(password + PASSWORD_SALT).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export interface JWTPayload {
  usuario_id: string;
  organizacao_id: string;
  role: string;
  email: string;
  iat: number;
  exp: number;
}

export function createJWT(payload: Omit<JWTPayload, "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + JWT_EXPIRY_DAYS * 24 * 60 * 60;

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp })).toString("base64url");
  const hmac = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");

  return `${header}.${body}.${hmac}`;
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const esperado = Buffer.from(
      createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url"),
      "base64url",
    );
    const recebido = Buffer.from(signature, "base64url");
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload as JWTPayload;
  } catch {
    return null;
  }
}
