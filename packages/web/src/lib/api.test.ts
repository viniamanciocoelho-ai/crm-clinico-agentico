import { afterEach, describe, expect, it } from "bun:test";
import { api, ErroApi } from "./api";

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("cliente REST", () => {
  it("normaliza resposta não JSON de erro como ErroApi", async () => {
    globalThis.fetch = async () =>
      new Response("<html>gateway failure</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      });

    try {
      await api("/falha", { semAutenticacao: true });
      throw new Error("A chamada deveria falhar");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroApi);
      expect(erro).toMatchObject({
        status: 502,
        tipo: "interno",
        message: "Falha na requisição (502)",
      });
    }
  });

  it("rejeita resposta de sucesso que não seja JSON", async () => {
    globalThis.fetch = async () => new Response("ok", { status: 200 });

    expect(api("/invalida", { semAutenticacao: true })).rejects.toMatchObject({
      status: 200,
      tipo: "interno",
      message: "A API devolveu uma resposta inválida",
    });
  });
});
