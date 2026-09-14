import { describe, it, expect } from "bun:test";
import { resolveContext, UnauthorizedError, TenantViolationError } from "./tenant";
import { lerCorpo } from "../http";
import { createJWT } from "../lib/auth";

const token = createJWT({
  usuario_id: "u1",
  organizacao_id: "org-real",
  role: "proprietario",
  email: "a@b.c",
});

const ok = (url: string, init?: RequestInit) => new Request(url, { headers: { Authorization: `Bearer ${token}` }, ...init });

describe("Isolamento multi-tenant — vetores obrigatórios", () => {
  it("injeta a sessão a partir do Bearer válido", async () => {
    const req = ok("http://x/health");
    const ctx = await resolveContext(req, new URL(req.url));
    expect(ctx.session.organizacao_id).toBe("org-real");
    expect(ctx.session.role).toBe("proprietario");
  });

  it("rejeita header Authorization ausente", async () => {
    const req = new Request("http://x/health");
    await expect(resolveContext(req, new URL(req.url))).rejects.toThrow(UnauthorizedError);
  });

  it("rejeita token adulterado", async () => {
    const req = new Request("http://x/health", { headers: { Authorization: `Bearer ${token}x` } });
    await expect(resolveContext(req, new URL(req.url))).rejects.toThrow(UnauthorizedError);
  });

  it("VETOR 1 — rejeita organizacao_id na query string", async () => {
    const url = new URL("http://x/agenda?organizacao_id=org-invasora");
    await expect(resolveContext(ok(url.toString()), url)).rejects.toThrow(TenantViolationError);
  });

  // O guard de corpo mora em `lerCorpo` (http.ts), que é o único caminho por
  // onde um corpo entra no sistema — centralizar ali é o que garante que
  // nenhuma rota nova esqueça a checagem.
  const comCorpo = (corpo: unknown) =>
    new Request("http://x/agenda", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  it("VETOR 2 — rejeita organizacao_id no corpo", async () => {
    await expect(lerCorpo(comCorpo({ organizacao_id: "org-invasora" }))).rejects.toThrow(TenantViolationError);
    await expect(lerCorpo(comCorpo({ organizacaoId: "org-invasora" }))).rejects.toThrow(TenantViolationError);
    await expect(lerCorpo(comCorpo({ nome: "ok" }))).resolves.toEqual({ nome: "ok" });
  });

  it("VETOR 3 — rejeita organizacao_id em header customizado", async () => {
    const url = new URL("http://x/agenda");
    const req = new Request(url, {
      headers: { Authorization: `Bearer ${token}`, "X-Organizacao-Id": "org-invasora" },
    });
    await expect(resolveContext(req, url)).rejects.toThrow(TenantViolationError);
  });

  // O vetor é o target como vem no fio. `new URL("http://x/org/../../etc")` e
  // `new URL("http://x/org/%2e%2e")` chegam já colapsados em `/` ou `/etc` pelo
  // parser — não são traversal na altura do gate, são caminhos limpos. Por isso
  // o terceiro argumento: o valor cru preserva o que o parser destruiu.
  const TRAVERSAL = [
    ["literal", "http://x/org/../../etc/passwd"],
    ["literal no fim", "http://x/org/.."],
    ["percent-encoded", "http://x/org/%2e%2e/%2e%2e/etc"],
    ["duplo-encoded", "http://x/org/%252e%252e/segredo"],
    ["backslash", "http://x/org/..%5C..%5Csegredo"],
    ["backslash cru", "http://x/org/..\\..\\segredo"],
    ["na query string", "http://x/agenda?volta=../../etc/passwd"],
    ["na query string encoded", "http://x/agenda?volta=..%2F..%2Fetc"],
  ];

  for (const [rotulo, cru] of TRAVERSAL) {
    it(`VETOR 4 — rejeita path traversal (${rotulo})`, async () => {
      const url = new URL(cru, "http://x");
      await expect(resolveContext(ok(cru), url, cru)).rejects.toThrow(TenantViolationError);
    });
  }

  it("VETOR 4b — pega o traversal mesmo com a URL já normalizada pelo runtime", async () => {
    const cru = "http://x/org/../../etc/passwd";
    const url = new URL(cru);
    expect(url.pathname).toBe("/etc/passwd"); // o parser já apagou o rastro
    await expect(resolveContext(ok(url.toString()), url, cru)).rejects.toThrow(TenantViolationError);
  });

  it("não rejeita rota legítima que apenas contém pontos", async () => {
    const url = new URL("http://x/api/v1.2/medicoes.relatorio");
    const ctx = await resolveContext(ok(url.toString()), url);
    expect(ctx.session.organizacao_id).toBe("org-real");
  });

  it("VETOR 5 — rejeita organizacao_id embutido no path", async () => {
    const url = new URL("http://x/api/organizacao_id=org-invasora/agenda");
    await expect(resolveContext(ok(url.toString()), url)).rejects.toThrow(TenantViolationError);
  });
});
