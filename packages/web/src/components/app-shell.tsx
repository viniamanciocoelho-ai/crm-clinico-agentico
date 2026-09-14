/**
 * Casca da aplicação: navegação, cabeçalho e área de conteúdo.
 *
 * Diferenças em relação ao protótipo visual (deliberadas):
 *  - as permissões de cada item são as REAIS das rotas de
 *    `packages/api/src/routes/*` (não existem `catalogo:read` nem
 *    `configuracoes:read`);
 *  - a data do cabeçalho é a data corrente, não uma constante;
 *  - o seletor de perfil só troca de papel em `MODO_DEMO`, e a troca é um login
 *    real; fora da demonstração ele só mostra quem está logado e permite sair;
 *  - o selo "dados fictícios" aparece apenas em `MODO_DEMO`.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  BriefcaseMedical,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { ROLES, ROLE_DESCRICAO, ROLE_ROTULO, type Role } from "@/lib/rbac";
import { MODO_DEMO } from "@/lib/demo";
import { dataLonga, hojeNaClinica } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { useSessao } from "./sessao";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";

export interface ItemNav {
  href: string;
  rotulo: string;
  icone: React.ElementType;
  /** Permissão real exigida pela API das rotas que a tela consome. */
  permissao: string;
  grupo: "operacao" | "estrutura";
}

export const NAV: ItemNav[] = [
  // O painel consome `/painel/*`, todas com `relatorios:read`.
  { href: "/", rotulo: "Painel", icone: LayoutDashboard, permissao: "relatorios:read", grupo: "operacao" },
  { href: "/agenda", rotulo: "Agenda", icone: CalendarDays, permissao: "agenda:read", grupo: "operacao" },
  { href: "/clientes", rotulo: "Clientes & funil", icone: Users, permissao: "clientes:read", grupo: "operacao" },
  {
    href: "/atendimentos",
    rotulo: "Atendimentos",
    icone: BriefcaseMedical,
    permissao: "atendimentos:read",
    grupo: "operacao",
  },
  {
    href: "/conversas",
    rotulo: "Conversas",
    icone: MessagesSquare,
    permissao: "conversas:read",
    grupo: "operacao",
  },
  // Catálogo (procedimentos, profissionais, salas, insumos) roda sob agenda:read.
  { href: "/catalogo", rotulo: "Catálogo", icone: Sparkles, permissao: "agenda:read", grupo: "estrutura" },
  {
    href: "/configuracoes",
    rotulo: "Configurações",
    icone: Settings,
    permissao: "agente_ia:config",
    grupo: "estrutura",
  },
];

function Marca({ compacto, organizacao }: { compacto: boolean; organizacao: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-accent text-accent-foreground font-display grid size-8 shrink-0 place-items-center rounded-[9px] text-[15px] leading-none font-semibold">
        C
      </span>
      {!compacto && (
        <span className="min-w-0">
          <span className="font-display text-sidebar-foreground block text-[15px] leading-tight">
            CAV CRM
          </span>
          {organizacao && (
            <span className="text-sidebar-muted block truncate text-[11px] tracking-wide">
              {organizacao}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function Navegacao({ compacto, onNavegar }: { compacto: boolean; onNavegar?: () => void }) {
  const [local] = useLocation();
  const { pode } = useSessao();

  const grupos: { chave: ItemNav["grupo"]; rotulo: string }[] = [
    { chave: "operacao", rotulo: "Operação" },
    { chave: "estrutura", rotulo: "Estrutura" },
  ];

  return (
    <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto px-2.5 py-3">
      {grupos.map((grupo) => (
        <div key={grupo.chave} className="mb-4 last:mb-0">
          {!compacto && (
            <p className="text-sidebar-muted px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase">
              {grupo.rotulo}
            </p>
          )}
          <ul className="space-y-0.5">
            {NAV.filter((item) => item.grupo === grupo.chave).map((item) => {
              const Icone = item.icone;
              const liberado = pode(item.permissao);
              const ativo = local === item.href;
              const base =
                "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors";

              if (!liberado) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled="true"
                      title={`Sem permissão (${item.permissao})`}
                      className={cn(base, "text-sidebar-muted/60 cursor-not-allowed")}
                    >
                      <Icone className="size-4 shrink-0" aria-hidden />
                      {!compacto && (
                        <>
                          <span className="flex-1 truncate">{item.rotulo}</span>
                          <Lock className="size-3 shrink-0" aria-hidden />
                        </>
                      )}
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={onNavegar}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      base,
                      ativo
                        ? "bg-sidebar-active text-sidebar-foreground font-medium"
                        : "text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-foreground",
                    )}
                  >
                    {ativo && (
                      <span
                        className="bg-accent absolute top-1.5 bottom-1.5 -left-2.5 w-[3px] rounded-r"
                        aria-hidden
                      />
                    )}
                    <Icone className="size-4 shrink-0" aria-hidden />
                    {!compacto && <span className="flex-1 truncate">{item.rotulo}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function MenuUsuario() {
  const { usuario, trocarPerfil, sair } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState<Role | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  if (!usuario) return null;

  const trocar = async (role: Role) => {
    if (!trocarPerfil) return;
    setTrocando(role);
    setErro(null);
    try {
      await trocarPerfil(role);
      setAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível trocar de perfil.");
    } finally {
      setTrocando(null);
    }
  };

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        className="border-border bg-card hover:bg-muted flex items-center gap-2.5 rounded-md border py-1.5 pr-2 pl-1.5 text-left transition-colors"
      >
        <Avatar nome={usuario.nome} tamanho="sm" />
        <span className="hidden min-w-0 sm:block">
          <span className="text-foreground block max-w-[140px] truncate text-[13px] font-medium">
            {usuario.nome}
          </span>
          <span className="text-muted-foreground block text-[11px]">{ROLE_ROTULO[usuario.role]}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
      </button>

      {aberto && (
        <div
          role="menu"
          className="border-border bg-card rise absolute right-0 z-50 mt-2 w-[320px] rounded-lg border p-2 shadow-[0_20px_50px_-18px_rgba(18,48,42,0.4)]"
        >
          <div className="border-border mb-1 border-b px-2 pt-1 pb-2">
            <p className="text-foreground text-[13px] font-medium">{usuario.nome}</p>
            <p className="text-muted-foreground truncate text-[12px]">{usuario.email}</p>
          </div>

          {trocarPerfil && (
            <>
              <div className="px-2 pt-1 pb-1.5">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                  Perfil de demonstração
                </p>
                <p className="text-muted-foreground mt-1 text-[12px]">
                  Trocar de perfil faz um login real com o usuário daquele cargo. O RBAC continua
                  sendo avaliado pelo servidor.
                </p>
              </div>
              {ROLES.map((role) => {
                const atual = role === usuario.role;
                return (
                  <button
                    key={role}
                    type="button"
                    role="menuitemradio"
                    aria-checked={atual}
                    aria-label={`Entrar como ${ROLE_ROTULO[role]}`}
                    disabled={trocando !== null}
                    onClick={() => void trocar(role)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors disabled:opacity-60",
                      atual ? "bg-secondary" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        atual ? "bg-primary" : "bg-border-strong",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="text-foreground block text-[13px] font-medium">
                        {ROLE_ROTULO[role]}
                        {trocando === role && " — entrando…"}
                      </span>
                      <span className="text-muted-foreground block text-[12px] leading-snug">
                        {ROLE_DESCRICAO[role]}
                      </span>
                    </span>
                  </button>
                );
              })}
              {erro && (
                <p role="alert" className="text-destructive px-2 py-1 text-[12px]">
                  {erro}
                </p>
              )}
            </>
          )}

          <div className="border-border mt-1 border-t pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={sair}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px]"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AppShellProps {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
  children: React.ReactNode;
}

const CHAVE_COMPACTO = "cav-crm-sidebar-compacta";

export function AppShell({ titulo, descricao, acoes, children }: AppShellProps) {
  const { organizacaoId } = useSessao();
  const [compacto, setCompacto] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(CHAVE_COMPACTO) === "1",
  );
  const [drawer, setDrawer] = useState(false);
  const hoje = hojeNaClinica();

  const alternar = () => {
    setCompacto((v) => {
      window.localStorage.setItem(CHAVE_COMPACTO, v ? "0" : "1");
      return !v;
    });
  };

  // Escape fecha o drawer mobile.
  useEffect(() => {
    if (!drawer) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [drawer]);

  return (
    <div className="paper min-h-screen">
      <a
        href="#conteudo"
        className="bg-primary text-primary-foreground sr-only rounded-md px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[70]"
      >
        Ir para o conteúdo
      </a>

      {/* Sidebar desktop */}
      <aside
        className={cn(
          "bg-sidebar border-sidebar-border fixed inset-y-0 left-0 z-40 hidden flex-col border-r md:flex",
          compacto ? "w-[72px]" : "w-[248px]",
        )}
      >
        <div
          className={cn(
            "border-sidebar-border flex h-14 items-center border-b",
            compacto ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          <Marca compacto={compacto} organizacao={organizacaoId} />
        </div>
        <Navegacao compacto={compacto} />
        <div className="border-sidebar-border border-t p-2.5">
          <button
            type="button"
            onClick={alternar}
            aria-label={compacto ? "Expandir navegação" : "Recolher navegação"}
            className="text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-foreground flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] transition-colors"
          >
            {compacto ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden />
                <span>Recolher</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Drawer mobile */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar navegação"
            className="absolute inset-0 bg-[#12302A]/50"
            onClick={() => setDrawer(false)}
          />
          <aside className="bg-sidebar border-sidebar-border absolute inset-y-0 left-0 flex w-[260px] flex-col border-r">
            <div className="border-sidebar-border flex h-14 items-center justify-between border-b px-4">
              <Marca compacto={false} organizacao={organizacaoId} />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Fechar navegação"
                className="text-sidebar-muted hover:text-sidebar-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <Navegacao compacto={false} onNavegar={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className={cn("min-h-screen", compacto ? "md:pl-[72px]" : "md:pl-[248px]")}>
        <header className="border-border bg-background/85 sticky top-0 z-30 border-b backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 lg:px-6">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Abrir navegação"
              className="border-border bg-card hover:bg-muted grid size-9 place-items-center rounded-md border md:hidden"
            >
              <Menu className="size-4" aria-hidden />
            </button>
            <div className="hidden items-center gap-2 sm:flex">
              {MODO_DEMO && (
                <Badge tom="primary" ponto>
                  Demonstração — dados sintéticos
                </Badge>
              )}
              <span className="text-muted-foreground text-[12px] capitalize">{dataLonga(hoje)}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <MenuUsuario />
            </div>
          </div>
        </header>

        <main id="conteudo" className="mx-auto max-w-[1440px] px-4 pt-6 pb-16 lg:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-[26px] leading-tight">{titulo}</h1>
              {descricao && (
                <p className="text-muted-foreground mt-1 max-w-2xl text-[13px]">{descricao}</p>
              )}
            </div>
            {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
