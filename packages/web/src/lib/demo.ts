/**
 * Modo demonstração.
 *
 * Liga com `DEMO_MODE=true` no `.env` da raiz do repositório (exposto ao bundle
 * por `envPrefix` no `vite.config.ts`). É decidido em tempo de build: um bundle
 * de produção não carrega nenhum dos atalhos abaixo.
 *
 * Com `DEMO_MODE=true`:
 *  - a tela de login lista os acessos de demonstração e preenche a senha, lendo
 *    tudo de `GET /demo` (rota pública real da API, `packages/api/src/routes/
 *    demo.ts`) — nada é hardcoded no front;
 *  - o cabeçalho permite trocar de perfil direto, o que dispara um login real
 *    em `POST /auth/login` com o usuário daquele papel (JWT real, RBAC real);
 *  - a interface identifica os dados como sintéticos.
 *
 * Sem `DEMO_MODE`:
 *  - nenhuma senha de demonstração é exibida ou preenchida;
 *  - não há troca de perfil: sair e entrar com credencial própria;
 *  - nenhum dado sintético é sugerido — a organização vem da credencial usada.
 */
import { api } from "./api";
import type { Role } from "./rbac";

export const MODO_DEMO = import.meta.env.DEMO_MODE === "true";

export interface AcessoDemo {
  email: string;
  role: Role;
}

export interface InfoDemo {
  pronta: boolean;
  organizacao?: string;
  nome?: string;
  acessos?: AcessoDemo[];
  senha?: string;
  contagem?: Record<string, number>;
  mensagem?: string;
}

/** Só chamada quando `MODO_DEMO` é verdadeiro. */
export function obterInfoDemo(): Promise<InfoDemo> {
  return api<InfoDemo>("/demo", { semAutenticacao: true });
}
