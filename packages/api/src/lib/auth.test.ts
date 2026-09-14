import { describe, it, expect, spyOn } from "bun:test";
import { createJWT, verifyJWT, hashPassword, verifyPassword } from "./auth";
import { RoleType, ROLE_PERMISSIONS } from "@cav-crm/shared";

describe("Authentication", () => {
  it("should hash and verify passwords", () => {
    const password = "test123";
    const hash = hashPassword(password);

    expect(hash).not.toBe(password);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword("wrongpassword", hash)).toBe(false);
  });

  it("should create and verify JWT", () => {
    const payload = {
      usuario_id: "user-123",
      organizacao_id: "org-123",
      role: "proprietario" as RoleType,
      email: "test@test.com",
    };

    const token = createJWT(payload);
    const verified = verifyJWT(token);

    expect(verified).not.toBeNull();
    expect(verified?.usuario_id).toBe(payload.usuario_id);
    expect(verified?.organizacao_id).toBe(payload.organizacao_id);
    expect(verified?.role).toBe(payload.role);
    expect(verified?.email).toBe(payload.email);
  });

  it("should reject expired JWT", () => {
    const payload = {
      usuario_id: "user-123",
      organizacao_id: "org-123",
      role: "proprietario" as RoleType,
      email: "test@test.com",
    };

    const token = createJWT(payload);
    const agora = Date.now();
    const relogio = spyOn(Date, "now").mockReturnValue(agora + 8 * 24 * 60 * 60 * 1000);
    try {
      expect(verifyJWT(token)).toBeNull();
    } finally {
      relogio.mockRestore();
    }
  });

  it("should reject invalid JWT signature", () => {
    const validToken = createJWT({
      usuario_id: "user-123",
      organizacao_id: "org-123",
      role: "proprietario" as RoleType,
      email: "test@test.com",
    });

    // Tamper with signature
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.tamperedsignature`;

    expect(verifyJWT(tamperedToken)).toBeNull();
  });
});

describe("RBAC", () => {
  it("should identify proprietario permissions", () => {
    const perms = ROLE_PERMISSIONS["proprietario"];
    expect(perms).toContain("*");
  });

  it("should identify gerente permissions", () => {
    const perms = ROLE_PERMISSIONS["gerente"];
    expect(perms).toContain("agenda:read");
    expect(perms).toContain("agenda:write");
    expect(perms).not.toContain("*");
  });

  it("should identify profissional permissions", () => {
    const perms = ROLE_PERMISSIONS["profissional"];
    expect(perms).toContain("agenda:read_own");
    expect(perms).not.toContain("agenda:read");
  });

  it("should identify recepcao permissions", () => {
    const perms = ROLE_PERMISSIONS["recepcao"];
    expect(perms).toContain("agenda:read");
    expect(perms).toContain("clientes:write");
    expect(perms).not.toContain("relatorios:read");
  });
});
