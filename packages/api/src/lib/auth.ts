import { createHash } from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRY_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = process.env.PASSWORD_SALT || "dev-salt";
  return createHash("sha256").update(password + salt).digest("hex");
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
  const hmac = createHash("sha256").update(`${header}.${body}${JWT_SECRET}`).digest("base64url");

  return `${header}.${body}.${hmac}`;
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const hmac = createHash("sha256").update(`${header}.${body}${JWT_SECRET}`).digest("base64url");
    if (signature !== hmac) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload as JWTPayload;
  } catch {
    return null;
  }
}
