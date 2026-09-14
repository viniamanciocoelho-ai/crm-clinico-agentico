/**
 * Login real: `POST /auth/login` com e-mail, senha e `organizacao_id`.
 *
 * Em `MODO_DEMO` a tela lê `GET /demo` (rota pública real) e oferece os acessos
 * semeados — o clique faz um login de verdade, com JWT e RBAC do servidor.
 * Fora da demonstração nenhuma senha é exibida ou preenchida, e a organização
 * tem de ser informada por quem entra.
 */
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useSessao } from "@/components/sessao";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { MODO_DEMO, obterInfoDemo, type InfoDemo } from "@/lib/demo";
import { ROLE_DESCRICAO, ROLE_ROTULO } from "@/lib/rbac";

export default function LoginPage() {
  const { entrar } = useSessao();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [organizacao, setOrganizacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [demo, setDemo] = useState<InfoDemo | null>(null);
  const [erroDemo, setErroDemo] = useState<string | null>(null);

  // Só em modo demonstração: descobre organização, acessos e senha na própria API.
  useEffect(() => {
    if (!MODO_DEMO) return;
    let ativo = true;
    obterInfoDemo()
      .then((info) => {
        if (!ativo) return;
        setDemo(info);
        if (info.organizacao) setOrganizacao(info.organizacao);
        if (info.senha) setSenha(info.senha);
        if (info.acessos?.length) setEmail(info.acessos[0]!.email);
      })
      .catch(() => {
        if (ativo) setErroDemo("A API não respondeu em GET /demo. Suba a API e rode POST /demo/reset.");
      });
    return () => {
      ativo = false;
    };
  }, []);

  const submeter = async (credenciais: { email: string; senha: string; organizacao_id: string }) => {
    setErro(null);
    setEnviando(true);
    try {
      await entrar(credenciais);
      // O roteador troca de tela sozinho quando a sessão passa a existir.
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível entrar. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    void submeter({ email, senha, organizacao_id: organizacao.trim() });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Painel de identidade */}
      <section className="bg-sidebar relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #E8EFEA 1px, transparent 0), radial-gradient(700px 420px at 85% 10%, rgba(188,97,54,0.45), transparent 70%)",
            backgroundSize: "22px 22px, 100% 100%",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="bg-accent text-accent-foreground font-display grid size-9 place-items-center rounded-[10px] text-base leading-none font-semibold">
            C
          </span>
          <span>
            <span className="font-display text-sidebar-foreground block text-base leading-tight">
              CAV CRM
            </span>
            <span className="text-sidebar-muted block text-[11px] tracking-wide">
              Gestão clínica com atendimento agêntico
            </span>
          </span>
        </div>

        <div className="relative max-w-lg">
          <h1 className="font-display text-sidebar-foreground mt-4 text-[40px] leading-[1.08] tracking-[-0.02em]">
            A clínica inteira em uma tela — e uma IA atendendo o WhatsApp.
          </h1>
          <p className="text-sidebar-muted mt-5 text-sm leading-relaxed">
            Agenda com bloqueio de preparo e limpeza, funil de leads, atendimentos com custo de
            insumo e a fila de conversas que a IA escala para humano.
          </p>
          <ul className="text-sidebar-muted mt-8 space-y-2.5 text-[13px]">
            {[
              "Multi-tenant: tudo escopado por organização",
              "RBAC por cargo — proprietário, gerente, profissional, recepção",
              "Log auditável de cada ação tomada pela IA",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <ShieldCheck className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sidebar-muted/70 relative text-[11px]">
          O acesso é validado no servidor a cada requisição.
        </p>
      </section>

      {/* Formulário */}
      <section className="paper flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-7 lg:hidden">
            <span className="bg-accent text-accent-foreground font-display grid size-9 place-items-center rounded-[10px] text-base leading-none font-semibold">
              C
            </span>
            <h1 className="font-display mt-4 text-2xl leading-tight">CAV CRM</h1>
          </div>

          <h2 className="font-display text-xl leading-tight">Entrar</h2>
          {MODO_DEMO ? (
            <p className="text-muted-foreground mt-1 text-[13px]">
              Modo demonstração: os acessos abaixo vêm da própria API e usam dados sintéticos.
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-[13px]">
              Use a credencial da sua clínica e o identificador da organização.
            </p>
          )}

          <form onSubmit={enviar} className="mt-6 space-y-4" noValidate>
            <Field label="E-mail">
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@clinica.com.br"
                />
              )}
            </Field>

            <Field label="Senha">
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  required
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Organização"
              hint={MODO_DEMO ? undefined : "Identificador da clínica, fornecido na implantação."}
            >
              {(props) => (
                <Input
                  {...props}
                  required
                  autoComplete="organization"
                  value={organizacao}
                  onChange={(e) => setOrganizacao(e.target.value)}
                  placeholder="minha-clinica"
                />
              )}
            </Field>

            {erro && (
              <p role="alert" className="text-destructive text-[12px] font-medium">
                {erro}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Entrando…
                </>
              ) : (
                <>
                  <KeyRound className="size-4" aria-hidden />
                  Entrar
                </>
              )}
            </Button>
          </form>

          {MODO_DEMO && (
            <div className="border-border mt-8 border-t pt-6">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                Acessos de demonstração
              </p>
              {erroDemo && (
                <p role="alert" className="text-destructive mt-3 text-[12px]">
                  {erroDemo}
                </p>
              )}
              {demo && !demo.pronta && (
                <p className="text-muted-foreground mt-3 text-[12px]">
                  {demo.mensagem ?? "A demonstração ainda não foi semeada. Rode POST /demo/reset."}
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {(demo?.acessos ?? []).map((acesso) => (
                  <li key={acesso.email}>
                    <button
                      type="button"
                      disabled={enviando || !demo?.senha || !demo?.organizacao}
                      onClick={() =>
                        void submeter({
                          email: acesso.email,
                          senha: demo!.senha!,
                          organizacao_id: demo!.organizacao!,
                        })
                      }
                      className="group border-border bg-card hover:border-primary/40 hover:bg-secondary/60 flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block text-[13px] font-medium">
                          {ROLE_ROTULO[acesso.role]}
                          <span className="text-muted-foreground ml-1.5 font-normal">
                            · {acesso.email}
                          </span>
                        </span>
                        <span className="text-muted-foreground block text-[12px] leading-snug">
                          {ROLE_DESCRICAO[acesso.role]}
                        </span>
                      </span>
                      <ArrowRight
                        className="text-muted-foreground group-hover:text-primary mt-0.5 size-4 shrink-0"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
