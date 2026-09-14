/**
 * Sessão real: token JWT emitido por `POST /auth/login` e usuário confirmado em
 * `GET /auth/eu`. Não existe perfil local, mock nem papel escolhido no cliente
 * — o papel vem do JWT, e toda rota é reavaliada pelo RBAC do servidor.
 *
 * `trocarPerfil` existe apenas em `MODO_DEMO` e não é um atalho de cliente: ele
 * faz um login real com o usuário de demonstração daquele papel, usando as
 * credenciais que a própria API publica em `GET /demo`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EVENTO_SESSAO_EXPIRADA, ErroApi, api, lerToken, salvarToken } from "@/lib/api";
import { MODO_DEMO, obterInfoDemo } from "@/lib/demo";
import { apenasProprios, temPermissao, type Role } from "@/lib/rbac";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: Role;
}

interface RespostaLogin {
  token: string;
  usuario: Usuario;
}

interface RespostaEu {
  usuario: Usuario;
  organizacao_id: string;
}

export interface Credenciais {
  email: string;
  senha: string;
  organizacao_id: string;
}

interface SessaoValor {
  usuario: Usuario | null;
  organizacaoId: string | null;
  autenticado: boolean;
  /** True enquanto o token salvo ainda está sendo validado em `/auth/eu`. */
  carregando: boolean;
  entrar: (credenciais: Credenciais) => Promise<void>;
  sair: () => void;
  /** Só em modo demonstração; `null` em produção. */
  trocarPerfil: ((role: Role) => Promise<void>) | null;
  pode: (permissao: string) => boolean;
  soProprios: (recurso: string) => boolean;
}

const SessaoContext = createContext<SessaoValor | null>(null);

export function SessaoProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [organizacaoId, setOrganizacaoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState<boolean>(() => lerToken() !== null);

  const limpar = useCallback(() => {
    salvarToken(null);
    setUsuario(null);
    setOrganizacaoId(null);
  }, []);

  // Token salvo é revalidado no servidor antes de liberar a interface.
  useEffect(() => {
    if (lerToken() === null) return;
    let ativo = true;
    api<RespostaEu>("/auth/eu")
      .then((r) => {
        if (!ativo) return;
        setUsuario(r.usuario);
        setOrganizacaoId(r.organizacao_id);
      })
      .catch(() => {
        if (ativo) limpar();
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [limpar]);

  // 401 em qualquer chamada derruba a sessão (token expirado ou revogado).
  useEffect(() => {
    const aoExpirar = () => limpar();
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aoExpirar);
  }, [limpar]);

  const entrar = useCallback(async ({ email, senha, organizacao_id }: Credenciais) => {
    const r = await api<RespostaLogin>("/auth/login", {
      metodo: "POST",
      semAutenticacao: true,
      corpo: { email, password: senha, organizacao_id },
    });
    salvarToken(r.token);
    setUsuario(r.usuario);
    setOrganizacaoId(organizacao_id);
    setCarregando(false);
  }, []);

  const sair = useCallback(() => {
    limpar();
  }, [limpar]);

  const trocarPerfil = useCallback(
    async (role: Role) => {
      const info = await obterInfoDemo();
      const acesso = info.acessos?.find((a) => a.role === role);
      if (!acesso || !info.senha || !info.organizacao) {
        throw new ErroApi(
          0,
          "A demonstração não está semeada nesta API. Rode POST /demo/reset.",
          "requisicao",
        );
      }
      await entrar({ email: acesso.email, senha: info.senha, organizacao_id: info.organizacao });
    },
    [entrar],
  );

  const valor = useMemo<SessaoValor>(
    () => ({
      usuario,
      organizacaoId,
      autenticado: usuario !== null,
      carregando,
      entrar,
      sair,
      trocarPerfil: MODO_DEMO ? trocarPerfil : null,
      pode: (permissao) => (usuario ? temPermissao(usuario.role, permissao) : false),
      soProprios: (recurso) => (usuario ? apenasProprios(usuario.role, recurso) : false),
    }),
    [usuario, organizacaoId, carregando, entrar, sair, trocarPerfil],
  );

  return <SessaoContext.Provider value={valor}>{children}</SessaoContext.Provider>;
}

export function useSessao() {
  const ctx = useContext(SessaoContext);
  if (!ctx) throw new Error("useSessao precisa do SessaoProvider");
  return ctx;
}

/** Renderiza os filhos só quando o perfil atual tem a permissão. */
export function Guard({
  permissao,
  fallback = null,
  children,
}: {
  permissao: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pode } = useSessao();
  return <>{pode(permissao) ? children : fallback}</>;
}
