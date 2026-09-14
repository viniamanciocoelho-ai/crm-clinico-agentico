import { createJWT, verifyPassword } from "../lib/auth";
import { json, lerCorpo, exigirTexto, BadRequestError } from "../http";
import type { Rota } from "../router";

/**
 * Login. É a ÚNICA rota que aceita `organizacao_id` no corpo — e isso é
 * legítimo: sem sessão ainda não existe tenant para forjar. A partir daqui,
 * o tenant vem exclusivamente do JWT emitido.
 */
const login: Rota = {
  metodo: "POST",
  caminho: "/auth/login",
  publica: true,
  limite: "login",
  async handler({ req, sqlite }) {
    const body = await lerCorpo(req, { permitirOrganizacaoNoCorpo: true });
    const email = exigirTexto(body, "email").toLowerCase();
    const senha = exigirTexto(body, "password");
    const organizacao = exigirTexto(body, "organizacao_id");

    const user = sqlite
      .query(
        `SELECT id, nome, email, role, senha_hash FROM usuarios
         WHERE email = ? AND organizacao_id = ? AND ativo = 1 LIMIT 1`,
      )
      .get(email, organizacao) as
      | { id: string; nome: string; email: string; role: string; senha_hash: string }
      | null;

    // Mesma resposta para usuário inexistente e senha errada: não vaza existência.
    if (!user || !verifyPassword(senha, user.senha_hash)) {
      return json({ error: "Credenciais inválidas" }, 401);
    }

    const token = createJWT({
      usuario_id: user.id,
      organizacao_id: organizacao,
      role: user.role,
      email: user.email,
    });

    return json({
      token,
      usuario: { id: user.id, nome: user.nome, email: user.email, role: user.role },
    });
  },
};

const eu: Rota = {
  metodo: "GET",
  caminho: "/auth/eu",
  handler({ session, sqlite }) {
    const row = sqlite
      .query(`SELECT id, nome, email, role FROM usuarios WHERE organizacao_id = ? AND id = ?`)
      .get(session.organizacao_id, session.usuario_id) as
      | { id: string; nome: string; email: string; role: string }
      | null;
    if (!row) throw new BadRequestError("Sessão aponta para usuário inexistente");
    return json({ usuario: row, organizacao_id: session.organizacao_id });
  },
};

export const rotasAuth: Rota[] = [login, eu];
