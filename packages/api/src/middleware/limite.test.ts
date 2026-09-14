import { describe, it, expect, beforeEach } from "bun:test";
import { BALDES, consumir, ipDoCliente, resetarLimites } from "./limite";

const AGORA = 1_000_000;

describe("Limite de taxa por IP", () => {
  beforeEach(resetarLimites);

  it("libera até o teto e bloqueia a partir daí", () => {
    const { max } = BALDES["demo-reset"];
    for (let i = 0; i < max; i++) {
      expect(consumir("demo-reset", "1.2.3.4", AGORA)).toBeNull();
    }
    const esperar = consumir("demo-reset", "1.2.3.4", AGORA);
    expect(esperar).not.toBeNull();
    // Ainda dentro da janela: deve apontar o que falta, em segundos.
    expect(esperar).toBeGreaterThan(0);
    expect(esperar).toBeLessThanOrEqual(BALDES["demo-reset"].janelaMs / 1000);
  });

  it("não conta um IP contra o outro", () => {
    const { max } = BALDES["demo-reset"];
    for (let i = 0; i < max; i++) consumir("demo-reset", "10.0.0.1", AGORA);

    expect(consumir("demo-reset", "10.0.0.1", AGORA)).not.toBeNull();
    expect(consumir("demo-reset", "10.0.0.2", AGORA)).toBeNull();
  });

  it("não conta um balde contra o outro", () => {
    const { max } = BALDES["demo-reset"];
    for (let i = 0; i < max; i++) consumir("demo-reset", "9.9.9.9", AGORA);

    expect(consumir("demo-reset", "9.9.9.9", AGORA)).not.toBeNull();
    expect(consumir("demo", "9.9.9.9", AGORA)).toBeNull();
  });

  it("libera de novo quando a janela expira", () => {
    const { max, janelaMs } = BALDES["demo-reset"];
    for (let i = 0; i < max + 1; i++) consumir("demo-reset", "5.5.5.5", AGORA);

    expect(consumir("demo-reset", "5.5.5.5", AGORA + janelaMs - 1)).not.toBeNull();
    expect(consumir("demo-reset", "5.5.5.5", AGORA + janelaMs)).toBeNull();
  });

  it("não permite referenciar balde inexistente", () => {
    expect(() => consumir("nao-existe" as never, "1.1.1.1", AGORA)).toThrow();
  });
});

describe("IP do cliente", () => {
  it("usa o IP do socket quando disponível", () => {
    const ip = ipDoCliente({ address: "203.0.113.7", family: "IPv4", port: 5000 }, new Headers());
    expect(ip).toBe("203.0.113.7");
  });

  it("ignora X-Forwarded-For sem proxy confiável", () => {
    // Aberto por padrão: qualquer cliente forjaria o header e trocaria de
    // balde a cada request, escapando do limite.
    const h = new Headers({ "X-Forwarded-For": "203.0.113.9" });
    expect(ipDoCliente(undefined, h)).toBe("desconhecido");
  });

  it("honra X-Forwarded-For com proxy confiável, pegando o primeiro IP", () => {
    const h = new Headers({ "X-Forwarded-For": "203.0.113.9, 10.0.0.1, 10.0.0.2" });
    expect(ipDoCliente(undefined, h, true)).toBe("203.0.113.9");
  });

  it("cai em 'desconhecido' quando não há IP nem proxy confiável", () => {
    expect(ipDoCliente(undefined, new Headers())).toBe("desconhecido");
    expect(ipDoCliente(undefined, new Headers(), true)).toBe("desconhecido");
  });
});
