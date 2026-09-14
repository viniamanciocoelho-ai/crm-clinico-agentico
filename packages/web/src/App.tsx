/**
 * Roteamento da aplicação.
 *
 * Sem sessão válida (token confirmado em `GET /auth/eu`), qualquer rota cai no
 * login. Cada rota protegida é montada só se o perfil tiver a permissão real
 * daquela tela; sem ela, a página renderiza o bloqueio explícito em vez de
 * chamar a API e tomar 403.
 */
import { Redirect, Route, Switch } from "wouter";
import { Loader2 } from "lucide-react";
import { Provider } from "@/components/provider";
import { LimiteErro } from "@/components/limite-erro";
import { useSessao } from "@/components/sessao";
import { NAV } from "@/components/app-shell";
import LoginPage from "@/pages/login";
import PainelPage from "@/pages/painel";
import AgendaPage from "@/pages/agenda";
import ClientesPage from "@/pages/clientes";
import AtendimentosPage from "@/pages/atendimentos";
import ConversasPage from "@/pages/conversas";
import CatalogoPage from "@/pages/catalogo";
import ConfiguracoesPage from "@/pages/configuracoes";

function Carregando() {
  return (
    <div className="paper grid min-h-screen place-items-center">
      <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Validando sessão…
      </p>
    </div>
  );
}

function Rotas() {
  const { autenticado, carregando, pode } = useSessao();

  if (carregando) return <Carregando />;
  if (!autenticado) return <LoginPage />;

  // Perfis sem `relatorios:read` (profissional, recepção) não abrem o painel:
  // a raiz leva ao primeiro item de navegação que o perfil alcança.
  const inicial = NAV.find((item) => pode(item.permissao))?.href ?? "/agenda";

  return (
    <Switch>
      <Route path="/">{inicial === "/" ? <PainelPage /> : <Redirect to={inicial} />}</Route>
      <Route path="/agenda" component={AgendaPage} />
      <Route path="/clientes" component={ClientesPage} />
      <Route path="/atendimentos" component={AtendimentosPage} />
      <Route path="/conversas" component={ConversasPage} />
      <Route path="/catalogo" component={CatalogoPage} />
      <Route path="/configuracoes" component={ConfiguracoesPage} />
      <Route>
        <Redirect to={inicial} />
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <Provider>
      <LimiteErro>
        <Rotas />
      </LimiteErro>
    </Provider>
  );
}
